/**
 * 提醒每日定時排程（issue #32 / 7.2，需求規格 §8.3、§12-7）。
 *
 * 主管已定案「先以每日定時寄送 Email(SMTP)」：
 * - 啟動時（onModuleInit）讀 env 解析 SMTP 設定；有設定 → 建立 nodemailer 傳輸並把
 *   EMAIL dispatcher 註冊進 ReminderService（與既有 IN_APP 並存）；未設定 → 記 log
 *   並優雅降級（僅 IN_APP，部署不被 SMTP 綁死）。
 * - 每日 cron（@nestjs/schedule；REMINDER_CRON 可覆寫，預設 08:00）掃描「仍有未完成且
 *   有到期日步驟」的案件，逐案呼叫 ReminderService.dispatchDueReminders。
 * - 去重沿用既有 append-only NOTIFICATION_DISPATCH_LOG（dedupKey 含 fireIsoDate），
 *   跨日不重複寄送；寄送失敗 ok:false 不落地日誌 → 下一輪 cron 自動重試（issue 要求
 *   「失敗需記錄、可重試或留待下一輪」）。
 * - 失敗一律以 Logger 記錄（管道 / dedupKey / 原因），整批掃描不因單一案件失敗中斷。
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StepInstanceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  EmailRecipientResolver,
  MailTransport,
  SmtpConfig,
  createEmailDispatcher,
  smtpConfigFromEnv,
} from './email-dispatcher';
import { ReminderChannel } from './reminder-engine';
import { ReminderService } from './reminder.service';
import { createSmtpTransport } from './smtp-transport';

/** 每日掃描 cron（預設每天 08:00；以 REMINDER_CRON 覆寫，標準 5 欄 cron 格式）。 */
export const REMINDER_CRON_DEFAULT = '0 8 * * *';

/**
 * cron 表達式於模組載入時讀取 env（@Cron 裝飾器求值時機）；
 * 部署時調整 REMINDER_CRON 後重啟生效。
 */
export const REMINDER_CRON = process.env.REMINDER_CRON?.trim() || REMINDER_CRON_DEFAULT;

/** SMTP 傳輸工廠（測試可注入假傳輸；正式預設 nodemailer）。 */
export type TransportFactory = (config: SmtpConfig) => MailTransport;

/** 單筆派送失敗紀錄（log 與回傳摘要共用）。 */
export interface SweepFailure {
  caseId: string;
  dedupKey?: string;
  channel?: string;
  error: string;
}

/** 一輪掃描摘要。 */
export interface SweepSummary {
  startedAt: Date;
  finishedAt: Date;
  /** 掃描的案件數（有未完成且有到期日步驟者）。 */
  casesScanned: number;
  /** 本輪「應派送」筆數（已到 fireDate、未派送、未完成）。 */
  dueCount: number;
  /** 成功派送（已落地去重日誌）筆數。 */
  sentCount: number;
  /** 失敗筆數（含查無收件人 email / 傳輸失敗 / 整案讀取失敗）。 */
  failedCount: number;
  failures: SweepFailure[];
  /** 本輪是否啟用 EMAIL 管道。 */
  emailEnabled: boolean;
}

@Injectable()
export class ReminderSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ReminderSchedulerService.name);

  /** EMAIL 管道是否已啟用（SMTP env 齊備且 dispatcher 已註冊）。 */
  private emailEnabled = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reminders: ReminderService,
  ) {}

  onModuleInit(): void {
    this.setupEmailDispatcher(process.env);
  }

  /** EMAIL 管道是否啟用（供測試 / 健康檢查）。 */
  isEmailEnabled(): boolean {
    return this.emailEnabled;
  }

  /**
   * 依 env 設定註冊 EMAIL dispatcher。回傳是否啟用。
   * - SMTP_HOST 未設定 → 不註冊、僅 IN_APP（優雅降級，記 log 提示）。
   * - transportFactory 預設 nodemailer（createSmtpTransport）；測試可注入假傳輸。
   */
  setupEmailDispatcher(
    env: Record<string, string | undefined>,
    transportFactory: TransportFactory = createSmtpTransport,
  ): boolean {
    const config = smtpConfigFromEnv(env);
    if (!config) {
      this.emailEnabled = false;
      this.logger.log('SMTP 未設定（缺 SMTP_HOST），EMAIL 提醒管道停用，僅派送系統內(IN_APP)通知。');
      return false;
    }
    const transport = transportFactory(config);
    const resolveEmail: EmailRecipientResolver = (userId) => this.resolveUserEmail(userId);
    this.reminders.registerDispatcher(
      createEmailDispatcher({ transport, from: config.from, resolveEmail }),
    );
    this.emailEnabled = true;
    this.logger.log(
      `EMAIL 提醒管道已啟用（SMTP ${config.host}:${config.port}，寄件人 ${config.from}，排程 ${REMINDER_CRON}）。`,
    );
    return true;
  }

  /** 以 Prisma 解析收件人 email（查無 / 已停用帳號回 null → dispatcher 回報 recipient_email_missing）。 */
  async resolveUserEmail(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, isActive: true },
    });
    if (!user || !user.isActive || !user.email) return null;
    return user.email;
  }

  /** 每日定時掃描（cron 觸發；錯誤不外拋，避免破壞排程器）。 */
  @Cron(REMINDER_CRON)
  async handleDailyCron(): Promise<void> {
    try {
      const summary = await this.runDailySweep();
      this.logger.log(
        `每日提醒掃描完成：案件 ${summary.casesScanned}、應派送 ${summary.dueCount}、成功 ${summary.sentCount}、失敗 ${summary.failedCount}（EMAIL ${summary.emailEnabled ? '啟用' : '停用'}）。`,
      );
    } catch (err) {
      this.logger.error(`每日提醒掃描失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 執行一輪掃描：找出「仍有未完成且有到期日步驟」的案件，逐案派送到期提醒。
   * - EMAIL 啟用時 channels=[IN_APP, EMAIL]（兩管道並存）；停用時用引擎預設（IN_APP）。
   * - 單一案件失敗（讀取 / 派送丟錯）記錄後續掃其餘案件，不中斷整輪。
   */
  async runDailySweep(now: Date = new Date()): Promise<SweepSummary> {
    const startedAt = new Date();
    const rows = await this.prisma.stepInstance.findMany({
      where: {
        dueDate: { not: null },
        status: { notIn: [StepInstanceStatus.COMPLETED, StepInstanceStatus.SKIPPED] },
      },
      select: { caseId: true },
      distinct: ['caseId'],
    });
    const channels = this.emailEnabled
      ? ([ReminderChannel.IN_APP, ReminderChannel.EMAIL] as const)
      : undefined;

    let dueCount = 0;
    let sentCount = 0;
    const failures: SweepFailure[] = [];

    for (const row of rows) {
      try {
        const { dispatched, due } = await this.reminders.dispatchDueReminders(row.caseId, {
          now,
          channels,
        });
        dueCount += due.length;
        for (const result of dispatched) {
          if (result.ok) {
            sentCount += 1;
          } else {
            failures.push({
              caseId: row.caseId,
              dedupKey: result.dedupKey,
              channel: result.channel,
              error: result.error ?? 'unknown_error',
            });
            this.logger.warn(
              `提醒派送失敗 case=${row.caseId} channel=${result.channel} dedupKey=${result.dedupKey}：${result.error ?? 'unknown_error'}（未落地去重日誌，下一輪自動重試）`,
            );
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ caseId: row.caseId, error: message });
        this.logger.warn(`案件提醒掃描失敗 case=${row.caseId}：${message}（跳過，下一輪重試）`);
      }
    }

    return {
      startedAt,
      finishedAt: new Date(),
      casesScanned: rows.length,
      dueCount,
      sentCount,
      failedCount: failures.length,
      failures,
      emailEnabled: this.emailEnabled,
    };
  }
}
