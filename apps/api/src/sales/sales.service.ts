import { Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus, FlowType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  FailureInput,
  HandoffPayload,
  NormalizedOpportunity,
  OpportunityInput,
  SalesDoc,
  SalesDocKind,
  assertValidFailure,
  normalizeOpportunity,
  planLoss,
  planWin,
  summarizeFailureReasons,
} from './sales-engine';

/**
 * 銷售流程服務（NestJS）。將 sales-engine 的純決策落實到 Prisma。
 *
 * 落實範圍（本輪，依現有 schema）：
 * - createOpportunity：建立 SALES 案件（Case）。對應 §4.5 步驟1「建立商機」。
 * - markWon：成案——以 planWin 算出移交藍圖、Case 轉 COMPLETED。對應 §4.5 步驟5a / §4.6。
 * - markLost：失敗結案——Case 轉 FAILED 並留存結構化失敗原因。對應 §4.5 步驟5b / §4.6。
 * - failureStatistics：失敗原因分類統計（§4.6）。
 *
 * 注意（待後續/人類 review，見 issue handoff）：
 * - 拜訪 / 會議紀錄之「永久留存」沿用 forms（FormSubmission）與 attachments（Attachment）
 *   既有持久化機制；本服務的成案移交以「案件下既有產出引用」組裝 SalesDoc。
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
