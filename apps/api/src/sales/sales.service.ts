import { Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus, FlowType, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  FailureInput,
  HandoffPayload,
  NormalizedOpportunity,
  OpportunityInput,
  SALES_RECORD_FORM_CODE,
  SalesDoc,
  SalesDocKind,
  SalesRecord,
  SalesRecordInput,
  SalesRecordKind,
  assertValidFailure,
  deserializeSalesRecord,
  filterRecordsByKind,
  materializeSalesRecord,
  normalizeOpportunity,
  planLoss,
  planWin,
  serializeSalesRecord,
  sortRecordsChronological,
  summarizeFailureReasons,
} from './sales-engine';

/**
 * 銷售流程服務（NestJS）。將 sales-engine 的純決策落實到 Prisma。
 *
 * 落實範圍（依現有 schema）：
 * - createOpportunity：建立 SALES 案件（Case）。對應 §4.5 步驟1「建立商機」。
 * - addSalesRecord / listSalesRecords：拜訪 / 會議紀錄之新增與調閱（append-only，永久留存）。
 *   對應 §4.5 步驟2 / §4.6。
 * - markWon：成案——以 planWin 算出移交藍圖、Case 轉 COMPLETED。對應 §4.5 步驟5a / §4.6。
 * - markLost：失敗結案——Case 轉 FAILED 並留存結構化失敗原因。對應 §4.5 步驟5b / §4.6。
 * - failureStatistics：失敗原因分類統計（§4.6）。
 *
 * 注意（待後續 / 人類 review，見 issue handoff）：
 * - 拜訪 / 會議紀錄之「永久留存」沿用 forms（FormSubmission）既有持久化機制：
 *   每筆紀錄存為一筆 FormSubmission（append-only，本服務不提供刪改）。
 * - 失敗「分類代碼」目前以 Case.failureReason 文字欄位編碼承載（`category|reason`），
 *   待 §12-2 確認失敗分類 Enum 後，建議新增獨立欄位 / 資料表收斂。
 */
@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  /** 失敗原因在 Case.failureReason 的編碼分隔符（暫行；待 §12-2 收斂為欄位）。 */
  private static readonly FAILURE_SEP = '|';

  /** 建立商機（SALES 案件）。 */
  async createOpportunity(params: {
    code: string;
    workflowId: string;
    input: OpportunityInput;
    createdById?: string;
    assigneeId?: string;
  }) {
    const normalized: NormalizedOpportunity = normalizeOpportunity(params.input);
    return this.prisma.case.create({
      data: {
        code: params.code,
        workflowId: params.workflowId,
        flowType: FlowType.SALES,
        title: normalized.title,
        clientName: normalized.clientName,
        saleMode: normalized.saleMode,
        status: CaseStatus.IN_PROGRESS,
        createdById: params.createdById,
        assigneeId: params.assigneeId,
      },
    });
  }

  /**
   * 解析（或首次初始化）承載拜訪 / 會議紀錄的專用表單定義。
   * 紀錄以 append-only 的 FormSubmission 落地，故需要一個 code 固定的
   * FormDefinition 作為容器；第一次使用時自動建立（無欄位，data 以引擎序列化承載）。
   */
  private async resolveSalesRecordForm(): Promise<{ id: string }> {
    const existing = await this.prisma.formDefinition.findFirst({
      where: { code: SALES_RECORD_FORM_CODE },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (existing) return existing;
    return this.prisma.formDefinition.create({
      data: {
        code: SALES_RECORD_FORM_CODE,
        name: '銷售拜訪／會議紀錄',
        description: '銷售流程拜訪 / Demo / 會議紀錄（append-only，永久留存，§4.6）',
        isSignable: false,
      },
      select: { id: true },
    });
  }

  /**
   * 新增一筆拜訪 / 會議紀錄（§4.5 步驟2 / §4.6）。
   * 每次新增都建立一筆 FormSubmission；本服務不提供刪除 / 修改，以滿足「永久留存」。
   * 非法輸入（缺摘要 / 類型錯誤）會由引擎丟出 SalesEngineError。
   */
  async addSalesRecord(
    caseId: string,
    input: SalesRecordInput,
    submittedById?: string | null,
  ): Promise<{ id: string; record: SalesRecord }> {
    const record = materializeSalesRecord(input);
    const existing = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!existing) throw new NotFoundException(`Case ${caseId} not found`);
    const form = await this.resolveSalesRecordForm();
    const created = await this.prisma.formSubmission.create({
      data: {
        formDefinitionId: form.id,
        caseId,
        status: SubmissionStatus.SUBMITTED,
        data: serializeSalesRecord(record) as object,
        submittedById: submittedById ?? null,
        submittedAt: record.occurredAt,
      },
      select: { id: true },
    });
    return { id: created.id, record };
  }

  /**
   * 調閱某案件的拜訪 / 會議紀錄（自 append-only 的 FormSubmission 還原）。
   * 預設依發生時間由舊到新排序；可選擇依類型篩選（§4.6 永久可調閱）。
   */
  async listSalesRecords(
    caseId: string,
    kind?: SalesRecordKind,
  ): Promise<SalesRecord[]> {
    const form = await this.prisma.formDefinition.findFirst({
      where: { code: SALES_RECORD_FORM_CODE },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!form) return [];
    const subs = await this.prisma.formSubmission.findMany({
      where: { caseId, formDefinitionId: form.id },
      select: { data: true },
    });
    const records = subs.map((s) => deserializeSalesRecord(s.data));
    const sorted = sortRecordsChronological(records);
    return kind ? filterRecordsByKind(sorted, kind) : sorted;
  }

  /** 蒐集案件下可作為「銷售產出」的引用（報價單 / 客製需求文件）。 */
  private collectSalesDocs(
    attachments: { id: string; name: string; version: number }[],
    classify: (name: string) => SalesDocKind | null,
    finalRefIds: ReadonlySet<string>,
  ): SalesDoc[] {
    const docs: SalesDoc[] = [];
    for (const a of attachments) {
      const kind = classify(a.name);
      if (!kind) continue;
      docs.push({
        kind,
        refId: a.id,
        name: a.name,
        version: a.version,
        isFinal: finalRefIds.has(a.id),
      });
    }
    return docs;
  }

  /**
   * 成案。docs 由上層（或 collectSalesDocs）提供，需含定版報價單。
   * 回傳移交藍圖並把 Case 轉為 COMPLETED。
   */
  async markWon(caseId: string, docs: readonly SalesDoc[]): Promise<HandoffPayload> {
    const handoff = planWin(docs); // 無定版報價單會丟 SalesEngineError
    const existing = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!existing) throw new NotFoundException(`Case ${caseId} not found`);
    await this.prisma.case.update({
      where: { id: caseId },
      data: { status: CaseStatus.COMPLETED, failureReason: null },
    });
    return handoff;
  }

  /** 失敗結案：Case 轉 FAILED，留存結構化失敗原因（category|reason）。 */
  async markLost(caseId: string, input: FailureInput) {
    assertValidFailure(input);
    const record = planLoss(input);
    const existing = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!existing) throw new NotFoundException(`Case ${caseId} not found`);
    return this.prisma.case.update({
      where: { id: caseId },
      data: {
        status: CaseStatus.FAILED,
        failureReason: `${record.category}${SalesService.FAILURE_SEP}${record.reason}`,
      },
    });
  }

  /** 解碼 Case.failureReason → { category, reason }。 */
  static decodeFailure(failureReason: string | null): { category: string; reason: string } | null {
    if (!failureReason) return null;
    const idx = failureReason.indexOf(SalesService.FAILURE_SEP);
    if (idx < 0) return { category: 'UNCLASSIFIED', reason: failureReason };
    return {
      category: failureReason.slice(0, idx),
      reason: failureReason.slice(idx + 1),
    };
  }

  /** 失敗原因分類統計（§4.6）：彙總所有 FAILED 的 SALES 案件。 */
  async failureStatistics(): Promise<Record<string, number>> {
    const failed = await this.prisma.case.findMany({
      where: { flowType: FlowType.SALES, status: CaseStatus.FAILED },
      select: { failureReason: true },
    });
    const categories = failed
      .map((c) => SalesService.decodeFailure(c.failureReason))
      .filter((d): d is { category: string; reason: string } => d !== null)
      .map((d) => ({ category: d.category }));
    return summarizeFailureReasons(categories);
  }
}
