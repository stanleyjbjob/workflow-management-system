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
import { HolidayCalendarInput } from '../calendar/calendar-engine';
import { ReminderChannel, ReminderMessage } from './reminder-engine';
import { ReminderService } from './reminder.service';
import { ReminderSchedulerService, SweepSummary } from './reminder-scheduler.service';

/**
 * 提醒與通知 REST 端點（issue 8.1 #33 第 3 批 / 需求規格 §8.3、§12-7）。
 *
 * 沿用 KanbanController / ProjectsController 風格；與 ReminderService /
 * ReminderSchedulerService 方法一一對應。
 *
 * 權限對應（RBAC 既有矩陣 permissions.ts）：
 * - 收件匣查閱／已讀（僅限本人）、提醒預覽（純讀取）→ `case:read`。
 * - 單一案件手動派送（會寫入通知與去重日誌）→ `case:update`。
 * - 全系統手動掃描派送（等同每日 cron 之一輪，跨所有案件）→ `admin:manage`（僅 MANAGER）。
 *
 * 路由一覽：
 * - GET  /reminders/inbox?unreadOnly=&take=            我的系統內(IN_APP)通知（最新在前）
 * - POST /reminders/inbox/:notificationId/read         將我的通知標為已讀
 * - GET  /reminders/cases/:caseId/preview?now=         預覽某案件應派送提醒（不派送、不落地）
 * - POST /reminders/cases/:caseId/dispatch             手動觸發某案件 dispatchDueReminders
 * - POST /reminders/sweep                              手動觸發一輪全系統掃描（同每日 cron）
 *
 * 註：派送具 dedupKey 跨輪去重（NOTIFICATION_DISPATCH_LOG），手動觸發不會重複寄送。
 */
@Controller('reminders')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class RemindersController {
  constructor(
    private readonly reminders: ReminderService,
    private readonly scheduler: ReminderSchedulerService,
  ) {}

  // ---- 解析（非法輸入一律 400 + code，沿用既有慣例）----

  private parseOptionalDate(value: string | undefined, field: string, code: string): Date | undefined {
    if (value == null || value === '') return undefined;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException({ code, message: `${field} 不是合法日期：${value}` });
    }
    return d;
  }

  private parseChannels(values: readonly string[] | undefined): ReminderChannel[] | undefined {
    if (values == null) return undefined;
    if (!Array.isArray(values) || values.length === 0) {
      throw new BadRequestException({ code: 'invalid_body', message: 'channels 需為非空陣列' });
    }
    const all = Object.values(ReminderChannel) as string[];
    return values.map((v) => {
      if (!all.includes(v)) {
        throw new BadRequestException({ code: 'invalid_body', message: `channels 必須為 ${all.join(' / ')}：${v}` });
      }
      return v as ReminderChannel;
    });
  }

  // ---- 收件匣（本人）----

  /** 我的系統內通知（最新在前）。unreadOnly=true/1 僅未讀；take 上限筆數（預設 100）。 */
  @Get('inbox')
  @Permissions('case:read')
  listInbox(
    @CurrentUser() user: SessionUser,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('take') take?: string,
  ) {
    let takeN: number | undefined;
    if (take != null && take !== '') {
      const n = Number(take);
      if (!Number.isInteger(n) || n <= 0) {
        throw new BadRequestException({ code: 'invalid_query', message: `take 必須為正整數：${take}` });
      }
      takeN = n;
    }
    return this.reminders.listInAppNotifications(user.sub, {
      unreadOnly: unreadOnly === 'true' || unreadOnly === '1',
      take: takeN,
    });
  }

  /** 將我的一筆通知標為已讀（僅限收件人本人；查無或非本人→404）。 */
  @Post('inbox/:notificationId/read')
  @Permissions('case:read')
  async markRead(
    @CurrentUser() user: SessionUser,
    @Param('notificationId') notificationId: string,
  ): Promise<{ id: string; read: true }> {
    await this.reminders.markNotificationRead(notificationId, { recipientId: user.sub });
    return { id: notificationId, read: true };
  }

  // ---- 提醒預覽／手動派送 ----

  /** 預覽某案件目前「應派送」的提醒訊息（不派送、不落地；供 UI／排程稽核）。 */
  @Get('cases/:caseId/preview')
  @Permissions('case:read')
  preview(
    @Param('caseId') caseId: string,
    @Query('now') now?: string,
    @Query('projectId') projectId?: string,
  ): Promise<ReminderMessage[]> {
    return guardEngine(() =>
      this.reminders.previewReminderMessages(caseId, {
        now: this.parseOptionalDate(now, 'now', 'invalid_query'),
        projectId: projectId || undefined,
      }),
    );
  }

  /**
   * 手動觸發某案件的到期提醒派送（已到 fireDate、未派送、未完成者）。
   * dedupKey 去重生效：重複觸發不會重複寄送。channels 可限定管道（預設依已註冊 dispatcher）。
   */
  @Post('cases/:caseId/dispatch')
  @Permissions('case:update')
  dispatch(
    @Param('caseId') caseId: string,
    @Body()
    body: {
      now?: string;
      projectId?: string;
      channels?: readonly string[];
      custom?: HolidayCalendarInput;
    } = {},
  ) {
    return guardEngine(() =>
      this.reminders.dispatchDueReminders(caseId, {
        now: this.parseOptionalDate(body.now, 'now', 'invalid_body'),
        projectId: body.projectId || undefined,
        channels: this.parseChannels(body.channels),
        custom: body.custom,
      }),
    );
  }

  /** 手動觸發一輪全系統掃描派送（等同每日 cron；回傳掃描摘要）。 */
  @Post('sweep')
  @Permissions('admin:manage')
  sweep(@Body() body: { now?: string } = {}): Promise<SweepSummary> {
    const now = this.parseOptionalDate(body.now, 'now', 'invalid_body');
    return this.scheduler.runDailySweep(now ?? new Date());
  }
}
