import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionUser } from '../auth/auth.service';
import { AccessScopeService } from '../rbac/access-scope.service';
import {
  AuditExport,
  BuildRecordOptions,
  FormSubmissionTraceInput,
  IsoRetentionPolicy,
  TraceabilityRecord,
  TrailFilter,
  TrailSummary,
  buildAuditExport,
  buildTrail,
  filterTrail,
  summarizeTrail,
  toCsv,
} from './iso-trail-engine';

/**
 * ISO 27001 文件化軌跡服務（issue 6.2 / 需求規格 §11）。
 *
 * 將 iso-trail-engine 的純彙整 / 對應 / 簽核軌跡 / 留存 / 匯出邏輯套在既有資料上：
 * - 表單填寫（FormSubmission + FormDefinition）：版本控管（FormDefinition.version）、
 *   簽核軌跡（送出 / 核可 / 退回之誰與何時）、§11.2 ISO 面向對應、可追溯（caseId）。
 * - 附件 / 連結（Attachment）：上傳者 / 時間 / 版本（§8.6）。
 * - Microsoft 365 登入紀錄（LoginAudit）：A.5 存取控制 / 稽核軌跡（§9.4）。
 * - 專案進度 / 排除日（ProjectFlow / Exclusion）：營運規劃與管控（§10）。
 *
 * 可見範圍（§8.5）：
 * - 案件相關（表單 / 附件）以 AccessScopeService.caseWhere 收斂（主管綽覽全部、其餘看自己經手）。
 * - 登入紀錄與專案紀錄屬稽核 / 跨案資料：主管可查全部；非主管僅能查自己的登入紀錄、不含專案層紀錄。
 *
 * 待釐清（§11.3，留 issue comment）：現行 ISO 文件清單與 Annex A 對應、留存期限、簽核層級。
 * 本服務以「可注入的留存政策（retentionPolicy）」承接——主管定案後注入即生效；
 * 未提供時 retentionUntil 一律為 null（不臆測業務規則）。
 */
@Injectable()
export class IsoTrailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
  ) {}

  /** 取得可追溯軌跡（依角色可見範圍 + 查閱過濾）。 */
  async getTrail(
    user: SessionUser,
    filter?: TrailFilter,
    options?: { retentionPolicy?: IsoRetentionPolicy },
  ): Promise<TraceabilityRecord[]> {
    const isManager = this.accessScope.isManager(user);
    const caseWhere = this.accessScope.caseWhere(user);

    const [submissions, attachments, logins, flows, exclusions] = await Promise.all([
      this.prisma.formSubmission.findMany({
        where: { case: caseWhere },
        include: { form: { select: { code: true, name: true, version: true, isSignable: true } } },
      }),
      this.prisma.attachment.findMany({ where: { case: caseWhere } }),
      isManager
        ? this.prisma.loginAudit.findMany({})
        : this.prisma.loginAudit.findMany({ where: { userId: user.sub } }),
      isManager ? this.prisma.projectFlow.findMany({}) : Promise.resolve([]),
      isManager ? this.prisma.exclusion.findMany({}) : Promise.resolve([]),
    ]);

    const opts: BuildRecordOptions = { retentionPolicy: options?.retentionPolicy };

    const formInputs: FormSubmissionTraceInput[] = submissions.map((s) => ({
      id: s.id,
      formCode: s.form?.code ?? '',
      formName: s.form?.name ?? '',
      version: s.form?.version ?? 1,
      isSignable: s.form?.isSignable ?? false,
      status: s.status,
      createdAt: s.createdAt,
      submittedById: s.submittedById,
      submittedAt: s.submittedAt,
      approvedById: s.approvedById,
      approvedAt: s.approvedAt,
      caseId: s.caseId,
    }));

    const records = buildTrail(
      {
        formSubmissions: formInputs,
        attachments: attachments.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          version: a.version,
          uploadedById: a.uploadedById,
          createdAt: a.createdAt,
          caseId: a.caseId,
        })),
        logins: logins.map((l) => ({
          id: l.id,
          userId: l.userId,
          email: l.email,
          eventType: l.eventType,
          success: l.success,
          at: l.createdAt,
          reason: l.reason,
        })),
        projectRecords: [
          ...flows.map((f) => ({
            id: f.id,
            projectId: f.projectId,
            subtype: 'PROGRESS' as const,
            title: f.name + '（進度 ' + f.progress + '%）',
            at: f.updatedAt,
          })),
          ...exclusions.map((e) => ({
            id: e.id,
            projectId: e.projectId,
            subtype: 'EXCLUSION' as const,
            title: e.reason,
            at: e.createdAt,
          })),
        ],
      },
      opts,
    );

    return filter ? filterTrail(records, filter) : records;
  }

  /** 軌跡彙總統計（簽核缺口、留存到期等）。 */
  async getSummary(
    user: SessionUser,
    filter?: TrailFilter,
    options?: { now?: Date; retentionPolicy?: IsoRetentionPolicy },
  ): Promise<TrailSummary> {
    const records = await this.getTrail(user, filter, options);
    return summarizeTrail(records, options?.now);
  }

  /** 完整稽核匯出包（彙總 + 缺口 + 扁平列），供查閱 / 下載。 */
  async exportAudit(
    user: SessionUser,
    filter?: TrailFilter,
    options?: { now?: Date; retentionPolicy?: IsoRetentionPolicy },
  ): Promise<AuditExport> {
    const records = await this.getTrail(user, filter, options);
    return buildAuditExport(records, options?.now);
  }

  /** 稽核紀錄匯出為 CSV 字串。 */
  async exportCsv(
    user: SessionUser,
    filter?: TrailFilter,
    options?: { retentionPolicy?: IsoRetentionPolicy },
  ): Promise<string> {
    const exp = await this.exportAudit(user, filter, options);
    return toCsv(exp.rows);
  }
}
