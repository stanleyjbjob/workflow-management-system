import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionUser } from '../auth/auth.service';
import { Permissions } from '../rbac/permissions.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { guardEngine } from '../common/engine-http';
import {
  FailureInput,
  HandoffPayload,
  OpportunityInput,
  SalesDoc,
  SalesRecord,
  SalesRecordInput,
  SalesRecordKind,
} from './sales-engine';
import { HandoffData } from './sales-handoff';
import { SalesService } from './sales.service';

/**
 * 銷售流程 REST 端點（issue 8.1 #33 第 2 批 / 需求規格 §4）。
 *
 * 沿用 KanbanController / ProjectsController 風格：
 * @UseGuards(SessionAuthGuard, PermissionsGuard) + @Permissions + @CurrentUser；
 * 與 SalesService 方法一一對應，引擎錯誤經 guardEngine 轉 400（保留 code）。
 *
 * 權限對應（RBAC 既有矩陣 permissions.ts）：
 * - 建立商機 → `case:create`（SALES / CONSULTANT / MANAGER）。
 * - 拜訪紀錄新增 → `form:fill`；調閱 → `form:read`。
 * - 成案 / 失敗結案（狀態推進）→ `case:advance`。
 * - 移交藍圖 / 失敗統計查詢 → `case:read`。
 *
 * 路由一覽：
 * - POST /sales/opportunities                建立商機（SALES 案件；§4.5 步驟1）
 * - POST /sales/cases/:caseId/records        新增拜訪／會議紀錄（append-only；§4.5 步驟2）
 * - GET  /sales/cases/:caseId/records?kind=  調閱紀錄（§4.6 永久可調閱）
 * - POST /sales/cases/:caseId/win            成案（需定版報價單；§4.5 步驟5a）
 * - POST /sales/cases/:caseId/loss           失敗結案（結構化失敗原因；§4.5 步驟5b）
 * - GET  /sales/cases/:caseId/handoff        取回成案移交藍圖（§4.6）
 * - GET  /sales/failure-statistics           失敗原因分類統計（§4.6）
 */
@Controller('sales')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  /** body 日期欄位解析；非法值一律 400 + invalid_body（與 query 慣例一致）。 */
  private parseDateBody(value: string | undefined, field: string): Date | undefined {
    if (value == null || value === '') return undefined;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException({ code: 'invalid_body', message: `${field} 不是合法日期：${value}` });
    }
    return d;
  }

  /** 建立商機（§4.2~§4.4：客戶來源多選／產品項目／銷售模式）。createdById＝目前登入者。 */
  @Post('opportunities')
  @Permissions('case:create')
  createOpportunity(
    @CurrentUser() user: SessionUser,
    @Body()
    body: { code?: string; workflowId?: string; assigneeId?: string } & Partial<OpportunityInput>,
  ): Promise<unknown> {
    const code = (body?.code ?? '').trim();
    const workflowId = (body?.workflowId ?? '').trim();
    if (!code) throw new BadRequestException({ code: 'code_required', message: '案件代碼 code 必填' });
    if (!workflowId) {
      throw new BadRequestException({ code: 'workflow_required', message: 'workflowId 必填' });
    }
    const input: OpportunityInput = {
      title: body?.title ?? '',
      clientName: body?.clientName ?? '',
      leadSources: body?.leadSources ?? [],
      products: body?.products ?? [],
      // 銷售模式由引擎驗證（缺漏／非法 → sale_mode_required）。
      saleMode: body?.saleMode as OpportunityInput['saleMode'],
    };
    return guardEngine(() =>
      this.sales.createOpportunity({
        code,
        workflowId,
        input,
        createdById: user.sub,
        assigneeId: body?.assigneeId,
      }),
    );
  }

  /** 新增拜訪／Demo／會議紀錄（append-only，永久留存；§4.5 步驟2、§4.6）。 */
  @Post('cases/:caseId/records')
  @Permissions('form:fill')
  addRecord(
    @CurrentUser() user: SessionUser,
    @Param('caseId') caseId: string,
    @Body()
    body: { kind?: string; summary?: string; occurredAt?: string; attendees?: string[]; detail?: string },
  ): Promise<{ id: string; record: SalesRecord }> {
    const input: SalesRecordInput = {
      // 類型由引擎驗證（非法 → record_invalid_kind）。
      kind: body?.kind as SalesRecordKind,
      summary: body?.summary ?? '',
      occurredAt: this.parseDateBody(body?.occurredAt, 'occurredAt'),
      attendees: body?.attendees,
      detail: body?.detail,
    };
    return guardEngine(() => this.sales.addSalesRecord(caseId, input, user.sub));
  }

  /** 調閱拜訪／會議紀錄（依發生時間排序；可選 kind 過濾；§4.6）。 */
  @Get('cases/:caseId/records')
  @Permissions('form:read')
  listRecords(
    @Param('caseId') caseId: string,
    @Query('kind') kind?: string,
  ): Promise<SalesRecord[]> {
    let kindValue: SalesRecordKind | undefined;
    if (kind != null && kind !== '') {
      const all = Object.values(SalesRecordKind) as string[];
      if (!all.includes(kind)) {
        throw new BadRequestException({ code: 'invalid_query', message: `kind 必須為 ${all.join(' / ')}：${kind}` });
      }
      kindValue = kind as SalesRecordKind;
    }
    return guardEngine(() => this.sales.listSalesRecords(caseId, kindValue));
  }

  /** 成案（§4.5 步驟5a）：docs 需含定版報價單，否則 400 no_final_quote；回傳移交藍圖。 */
  @Post('cases/:caseId/win')
  @Permissions('case:advance')
  markWon(
    @Param('caseId') caseId: string,
    @Body() body: { docs?: SalesDoc[] },
  ): Promise<HandoffPayload> {
    return guardEngine(() => this.sales.markWon(caseId, body?.docs ?? []));
  }

  /** 失敗結案（§4.5 步驟5b）：留存結構化失敗分類與原因（§12-2 分類待定案，目前自由字串）。 */
  @Post('cases/:caseId/loss')
  @Permissions('case:advance')
  markLost(
    @Param('caseId') caseId: string,
    @Body() body: { category?: string; reason?: string; occurredAt?: string },
  ): Promise<unknown> {
    const input: FailureInput = {
      category: body?.category ?? '',
      reason: body?.reason ?? '',
      occurredAt: this.parseDateBody(body?.occurredAt, 'occurredAt'),
    };
    return guardEngine(() => this.sales.markLost(caseId, input));
  }

  /** 取回最近一次成案移交藍圖（供導入／客製化引用；§4.6）。尚未成案回傳 null。 */
  @Get('cases/:caseId/handoff')
  @Permissions('case:read')
  getHandoff(@Param('caseId') caseId: string): Promise<HandoffData | null> {
    return guardEngine(() => this.sales.getHandoff(caseId));
  }

  /** 失敗原因分類統計（§4.6 供改善分析）。 */
  @Get('failure-statistics')
  @Permissions('case:read')
  failureStatistics(): Promise<Record<string, number>> {
    return this.sales.failureStatistics();
  }
}
