import { Injectable, NotFoundException } from '@nestjs/common';
import { StepInstanceStatus, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../calendar/calendar.service';
import { HolidayCalendarInput } from '../calendar/calendar-engine';
import {
  DEFAULT_REMINDER_POLICY,
  DispatchResult,
  DueReminder,
  ReminderChannel,
  ReminderDispatcher,
  ReminderMessage,
  ReminderOccurrence,
  ReminderPolicy,
  ReminderTarget,
  buildReminderMessage,
  computeReminderOccurrences,
  dispatchReminders,
  fromDispatchLog,
  selectDueReminders,
  toDispatchLog,
} from './reminder-engine';

/**
 * 提醒與通知服務（NestJS）。將 reminder-engine 的純決策落實到 Prisma + CalendarService。
 *
 * 對應需求規格 §8.3 與 issue #22（4.2「提醒與通知」）：
 * - buildCaseReminderTargets：由某案件的 StepInstance（dueDate + assignee）組出提醒對象；
 *   到期日先經 CalendarService 行事曆遞延（連假/週末/專案排除日），故「遞延後提醒時間同步調整」。
 * - dispatchDueReminders：挑出已到期且未派送過的提醒，派送至已註冊的 dispatcher（預設 IN_APP），
 *   並 append-only 落地派送日誌（NOTIFICATION_DISPATCH_LOG）達成跨輪去重。
 * - listInAppNotifications：讀某使用者的系統內通知（由 IN_APP 派送落地者）。
 *
 * 落地策略（沿用既有模組「不新增 migration、以 FormSubmission append-only 落地」風格，見 customization/
 * environment）：
 * - 派送日誌：FormSubmission(code=NOTIFICATION_DISPATCH_LOG)，data 帶 dedupKey/管道/種類/日期，
 *   供 selectDueReminders 的 alreadySent 去重。
 * - 系統內通知：FormSubmission(code=NOTIFICATION_INBOX)，data 帶收件者/標題/內文/已讀旗標。
 *
 * 通知管道（§12-7 待釐清）：本服務內建並註冊「系統內(IN_APP)」dispatcher（DbInAppDispatcher，
 * 落地到 NOTIFICATION_INBOX）。Email / 其他管道之 dispatcher 介面已備妥（ReminderDispatcher），
 * 待主管確認管道與外部服務後，於 registerDispatcher 注入即可，無需改引擎。
 */
@Injectable()
export class ReminderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: CalendarService,
  ) {}

  private static readonly DISPATCH_LOG_FORM_CODE = 'NOTIFICATION_DISPATCH_LOG';
  private static readonly INBOX_FORM_CODE = 'NOTIFICATION_INBOX';

  /** 已註冊的派送器（依管道）。預設含 IN_APP（落地系統內通知）。 */
  private readonly dispatchers = new Map<ReminderChannel, ReminderDispatcher>();

  /** 註冊 / 覆寫某管道的派送器（Email / 其他管道由此注入，§12-7）。 */
  registerDispatcher(dispatcher: ReminderDispatcher): void {
    this.dispatchers.set(dispatcher.channel, dispatcher);
  }

  /** 系統內(IN_APP)派送器：把通知 append-only 落地到 NOTIFICATION_INBOX。 */
  private dbInAppDispatcher(): ReminderDispatcher {
    return {
      channel: ReminderChannel.IN_APP,
      send: async (message: ReminderMessage): Promise<DispatchResult> => {
        try {
          await this.persistInboxNotification(message);
          return { dedupKey: message.dedupKey, channel: ReminderChannel.IN_APP, recipientId: message.recipientId, ok: true };
        } catch (err) {
          return {
            dedupKey: message.dedupKey,
            channel: ReminderChannel.IN_APP,
            recipientId: message.recipientId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    };
  }

  private activeDispatchers(): ReminderDispatcher[] {
    const list = [...this.dispatchers.values()];
    if (!this.dispatchers.has(ReminderChannel.IN_APP)) list.push(this.dbInAppDispatcher());
    return list;
  }

  /** 解析（或首次建立）某 code 的表單定義容器。 */
  private async resolveForm(code: string, name: string, description: string): Promise<{ id: string }> {
    const existing = await this.prisma.formDefinition.findFirst({
      where: { code },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (existing) return existing;
    return this.prisma.formDefinition.create({ data: { code, name, description }, select: { id: true } });
  }

  /**
   * 由某案件的步驟實例組出提醒對象：每個有到期日(dueDate)且未完成的 StepInstance → 一個 ReminderTarget。
   * 到期日先經行事曆遞延（避免落在連假/週末/專案排除日）；負責人取 StepInstance.assignee → Case.assignee。
   */
  async buildCaseReminderTargets(
    caseId: string,
    opts: { projectId?: string; custom?: HolidayCalendarInput; channels?: readonly ReminderChannel[] } = {},
  ): Promise<ReminderTarget[]> {
    const kase = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true, assigneeId: true },
    });
    if (!kase) throw new NotFoundException(`Case ${caseId} not found`);

    const steps = await this.prisma.stepInstance.findMany({
      where: { caseId, dueDate: { not: null } },
      select: {
        id: true,
        order: true,
        status: true,
        dueDate: true,
        assigneeId: true,
        stepDefinition: { select: { name: true } },
      },
      orderBy: { order: 'asc' },
    });

    const targets: ReminderTarget[] = [];
    for (const s of steps) {
      if (!s.dueDate) continue;
      const completed = s.status === StepInstanceStatus.COMPLETED || s.status === StepInstanceStatus.SKIPPED;
      const recipientId = s.assigneeId ?? kase.assigneeId;
      if (!recipientId) continue; // 無負責人則無從提醒（留待指派後再排）
      const dueDate = await this.calendar.deferToWorkday(s.dueDate, {
        projectId: opts.projectId,
        custom: opts.custom,
      });
      targets.push({
        key: `${caseId}:${s.id}`,
        label: s.stepDefinition.name,
        dueDate,
        recipientId,
        channels: opts.channels,
        step: String(s.order),
        completed,
      });
    }
    return targets;
  }

  /** 取某案件已派送過的 dedupKey 集合（跨輪去重）。 */
  async getSentDedupKeys(caseId: string): Promise<Set<string>> {
    const form = await this.prisma.formDefinition.findFirst({
      where: { code: ReminderService.DISPATCH_LOG_FORM_CODE },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!form) return new Set<string>();
    const subs = await this.prisma.formSubmission.findMany({
      where: { caseId, formDefinitionId: form.id },
      select: { data: true },
    });
    const keys = new Set<string>();
    for (const s of subs) {
      try {
        keys.add(fromDispatchLog(s.data).dedupKey);
      } catch {
        // 毀損的舊紀錄略過，不影響去重主流程。
      }
    }
    return keys;
  }

  /** append-only 落地一筆派送日誌（供去重）。 */
  private async recordDispatchLog(caseId: string, occurrence: ReminderOccurrence): Promise<void> {
    const form = await this.resolveForm(
      ReminderService.DISPATCH_LOG_FORM_CODE,
      '通知派送日誌',
      '提醒派送去重日誌（append-only，記錄 dedupKey/管道/種類/日期）',
    );
    await this.prisma.formSubmission.create({
      data: {
        formDefinitionId: form.id,
        caseId,
        status: SubmissionStatus.SUBMITTED,
        data: toDispatchLog(occurrence) as never,
        submittedAt: new Date(),
      },
      select: { id: true },
    });
  }

  /** append-only 落地一筆系統內通知（IN_APP）。 */
  private async persistInboxNotification(message: ReminderMessage): Promise<void> {
    const form = await this.resolveForm(
      ReminderService.INBOX_FORM_CODE,
      '系統內通知',
      '系統內(IN_APP)通知收件匣（append-only）',
    );
    await this.prisma.formSubmission.create({
      data: {
        formDefinitionId: form.id,
        caseId: message.targetKey.split(':')[0],
        status: SubmissionStatus.SUBMITTED,
        data: {
          recipientId: message.recipientId,
          title: message.title,
          body: message.body,
          kind: message.kind,
          dedupKey: message.dedupKey,
          read: false,
        } as never,
        submittedById: message.recipientId,
        submittedAt: new Date(),
      },
      select: { id: true },
    });
  }

  /**
   * 計算某案件目前「應派送」的提醒（已到 fireDate、未派送、未完成），派送並落地日誌。
   * - policy：可覆寫預設規則（提前/到期/逾期時點與管道）。
   * - 回傳每筆派送結果；成功者落地派送日誌避免下輪重送。
   */
  async dispatchDueReminders(
    caseId: string,
    opts: {
      now?: Date;
      policy?: ReminderPolicy;
      projectId?: string;
      custom?: HolidayCalendarInput;
      channels?: readonly ReminderChannel[];
    } = {},
  ): Promise<{ dispatched: DispatchResult[]; due: DueReminder[] }> {
    const targets = await this.buildCaseReminderTargets(caseId, {
      projectId: opts.projectId,
      custom: opts.custom,
      channels: opts.channels,
    });
    const cal = this.calendar.buildCalendar(opts.custom);
    const occurrences = computeReminderOccurrences(targets, opts.policy ?? DEFAULT_REMINDER_POLICY, cal);
    const alreadySent = await this.getSentDedupKeys(caseId);
    const due = selectDueReminders(occurrences, { now: opts.now, alreadySent });

    const results = await dispatchReminders(due, this.activeDispatchers());
    // 對成功派送者落地去重日誌（以 dedupKey 對回 occurrence）。
    const byKey = new Map(due.map((o) => [o.dedupKey, o] as const));
    for (const r of results) {
      if (r.ok) {
        const occ = byKey.get(r.dedupKey);
        if (occ) await this.recordDispatchLog(caseId, occ);
      }
    }
    return { dispatched: results, due };
  }

  /** 預覽某案件的提醒訊息（不派送、不落地），供 UI / 排程稽核。 */
  async previewReminderMessages(
    caseId: string,
    opts: { now?: Date; policy?: ReminderPolicy; projectId?: string; custom?: HolidayCalendarInput } = {},
  ): Promise<ReminderMessage[]> {
    const targets = await this.buildCaseReminderTargets(caseId, {
      projectId: opts.projectId,
      custom: opts.custom,
    });
    const cal = this.calendar.buildCalendar(opts.custom);
    const occurrences = computeReminderOccurrences(targets, opts.policy ?? DEFAULT_REMINDER_POLICY, cal);
    const due = selectDueReminders(occurrences, { now: opts.now });
    return due.map((o) => buildReminderMessage(o));
  }

  /** 讀某使用者的系統內通知（最新在前）。 */
  async listInAppNotifications(
    recipientId: string,
    opts: { unreadOnly?: boolean; take?: number } = {},
  ): Promise<Array<{ id: string; title: string; body: string; kind: string; read: boolean; createdAt: Date }>> {
    const form = await this.prisma.formDefinition.findFirst({
      where: { code: ReminderService.INBOX_FORM_CODE },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!form) return [];
    const subs = await this.prisma.formSubmission.findMany({
      where: { formDefinitionId: form.id, submittedById: recipientId },
      orderBy: { createdAt: 'desc' },
      take: opts.take ?? 100,
      select: { id: true, data: true, createdAt: true },
    });
    const out: Array<{ id: string; title: string; body: string; kind: string; read: boolean; createdAt: Date }> = [];
    for (const s of subs) {
      const d = (s.data ?? {}) as { title?: unknown; body?: unknown; kind?: unknown; read?: unknown };
      const read = d.read === true;
      if (opts.unreadOnly && read) continue;
      out.push({
        id: s.id,
        title: typeof d.title === 'string' ? d.title : '',
        body: typeof d.body === 'string' ? d.body : '',
        kind: typeof d.kind === 'string' ? d.kind : '',
        read,
        createdAt: s.createdAt,
      });
    }
    return out;
  }

  /**
   * 將一筆系統內通知標記為已讀。
   * opts.recipientId（8.1 REST 起）：限定僅收件人本人可標已讀；非本人視同查無（404，不洩漏存在性）。
   */
  async markNotificationRead(notificationId: string, opts: { recipientId?: string } = {}): Promise<void> {
    const sub = await this.prisma.formSubmission.findUnique({
      where: { id: notificationId },
      select: { id: true, data: true },
    });
    if (!sub) throw new NotFoundException(`Notification ${notificationId} not found`);
    if (opts.recipientId != null) {
      const rid = ((sub.data ?? {}) as { recipientId?: unknown }).recipientId;
      if (rid !== opts.recipientId) throw new NotFoundException(`Notification ${notificationId} not found`);
    }
    const data = { ...((sub.data ?? {}) as Record<string, unknown>), read: true };
    await this.prisma.formSubmission.update({
      where: { id: notificationId },
      data: { data: data as never },
      select: { id: true },
    });
  }
}
