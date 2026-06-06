import { Injectable } from '@nestjs/common';
import { StepInstanceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionUser } from '../auth/auth.service';
import { AccessScopeService } from '../rbac/access-scope.service';
import { CalendarService } from '../calendar/calendar.service';
import {
  businessDaysBetween,
  calendarDaysBetween as calDaysBetween,
  deferToWorkday,
  isNonWorkday,
} from '../calendar/calendar-engine';
import { HolidayCalendarInput } from '../calendar/calendar-engine';
import {
  KanbanBoard,
  KanbanFilter,
  KanbanTaskInput,
  KanbanViewer,
  buildBoard,
} from './kanban-engine';

/**
 * 任務看板服務（NestJS）。對應 issue 6.1 / 需求規格 §8（任務看板與待辦）。
 *
 * 將 kanban-engine 的純分類 / 標示 / 統計邏輯套在既有 Case / StepInstance / StepDefinition 資料上：
 * - 以 AccessScopeService 收斂「可見案件範圍」（§8.5：主管緸覽全部、其餘看自己經手＋負責流程型別）。
 * - 一張任務卡＝一筆 actionable（待辦 / 進行中）或已完成的步驟實例。
 * - 「即將到期」視窗以工作日衡量（注入 calendar-engine businessDaysBetween）。
 * - 「受連假 / 假日遞延」標示：到期日落在非工作日→遞延，天數＝到下一工作日的曆日差（沿用 4.1）。
 *
 * 假日來源（§12-5）：自 7.1 起改由 `CalendarService.loadCalendar()` 讀 `Holiday` 資料表驅動，
 * 故主管於 Holiday 表維護的國定假日 / 連假 / 補班會同步反映在看板的到期 / 遞延標示。
 *
 * 不在此處理（屬後續任務 / 已知相依）：
 * - 「待填表單」數（pendingRequiredForms）：引擎已預留欄位，待接上 FormsModule 統計後填入（本輪預設 0）。
 */
@Injectable()
export class KanbanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
    private readonly calendar: CalendarService,
  ) {}

  /**
   * 取得某使用者（依角色可見範圍）的任務看板。
   * @param user 目前登入者（SessionUser）。
   * @param filter 檢視層過濾（角色 / 承辦人 / 流程型別 / 僅與我相關）。
   * @param options now（評估基準）/ upcomingWithinDays（即將到期視窗，工作日）/ holiday（自訂假日行事曆，與 DB 假日合併）。
   */
  async getBoard(
    user: SessionUser,
    filter?: KanbanFilter,
    options?: { now?: Date; upcomingWithinDays?: number; holiday?: HolidayCalendarInput },
  ): Promise<KanbanBoard> {
    const caseWhere = this.accessScope.caseWhere(user);

    const rows = await this.prisma.stepInstance.findMany({
      where: {
        status: { in: [StepInstanceStatus.PENDING, StepInstanceStatus.IN_PROGRESS, StepInstanceStatus.COMPLETED] },
        case: caseWhere,
      },
      include: {
        case: {
          select: { id: true, code: true, title: true, clientName: true, flowType: true },
        },
        stepDefinition: {
          select: { id: true, name: true, order: true, responsibleRole: { select: { id: true, code: true } } },
        },
      },
    });

    const tasks: KanbanTaskInput[] = rows.map((r) => ({
      stepInstanceId: r.id,
      caseId: r.caseId,
      caseCode: r.case?.code ?? null,
      caseTitle: r.case?.title ?? null,
      clientName: r.case?.clientName ?? null,
      flowType: r.case?.flowType ?? null,
      stepDefinitionId: r.stepDefinitionId,
      stepName: r.stepDefinition?.name ?? null,
      stepOrder: r.stepDefinition?.order ?? r.order,
      status: r.status,
      responsibleRoleId: r.stepDefinition?.responsibleRole?.id ?? null,
      responsibleRoleCode: r.stepDefinition?.responsibleRole?.code ?? null,
      assigneeId: r.assigneeId ?? null,
      dueDate: r.dueDate ?? null,
    }));

    const viewer: KanbanViewer = {
      userId: user.sub,
      roleCodes: user.roles,
      isManager: this.accessScope.isManager(user),
    };

    // 以同一份「DB 假日驅動」的行事曆同時驅動「工作日視窗」與「遞延標示」。
    const cal = await this.calendar.loadCalendar(options?.holiday ?? {});

    return buildBoard(tasks, {
      viewer,
      filter,
      options: {
        now: options?.now,
        upcomingWithinDays: options?.upcomingWithinDays,
        workdayCounter: (from: Date, to: Date) => businessDaysBetween(from, to, cal),
        deferralResolver: (dueDate: Date) => {
          if (!isNonWorkday(dueDate, cal)) return { deferred: false };
          const moved = deferToWorkday(dueDate, cal);
          return { deferred: true, deferredDays: calDaysBetween(dueDate, moved) };
        },
      },
    });
  }
}
