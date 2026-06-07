/**
 * Email(SMTP) 提醒派送（issue #32 / 7.2，需求規格 §8.3、§12-7）。
 *
 * 純邏輯層：本檔不依賴 nodemailer / Nest / Prisma，可被純函式單元測試完整覆蓋
 * （沿用 reminders 模組「純引擎 + Service」風格）。實際 SMTP 傳輸由
 * smtp-transport.ts（nodemailer 包裝）提供，本檔僅依 `MailTransport` 介面解耦。
 *
 * - `SmtpConfig` / `smtpConfigFromEnv`：由環境變數解析 SMTP 設定。
 *   認證資訊一律走 env / secret（SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER /
 *   SMTP_PASS / SMTP_FROM），不寫入 repo（issue #32 補充）。未設定 SMTP_HOST 視為
 *   「未啟用 Email 管道」回傳 null，呼叫端應優雅降級（僅 IN_APP）。
 * - `renderReminderEmail`：由管道無關的 `ReminderMessage` 組出 Email 主旨 / 純文字內文（繁中）。
 * - `createEmailDispatcher`：實作 `ReminderChannel.EMAIL` 的 `ReminderDispatcher`。
 *   收件人 email 由注入的 `resolveEmail(userId)` 查得（服務層接 Prisma User.email），
 *   引擎與資料層解耦；查無 email / 寄送失敗回 ok:false（不丟錯），由呼叫端記錄。
 *   失敗者不會被 ReminderService 落地去重日誌，下一輪 cron 自動重試。
 */

import { toIsoDate } from '../calendar/calendar-engine';
import {
  DispatchResult,
  ReminderChannel,
  ReminderDispatcher,
  ReminderMessage,
} from './reminder-engine';

/* ────────────────────────── 傳輸介面（與 nodemailer 解耦） ────────────────────────── */

/** 一封待寄出的 Email（純文字；HTML 留待 UI 需求明確後擴充）。 */
export interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** 寄信傳輸介面。正式環境由 smtp-transport.ts 以 nodemailer 實作；測試注入假傳輸。 */
export interface MailTransport {
  sendMail(mail: OutgoingMail): Promise<void>;
}

/* ────────────────────────── SMTP 設定（env 驅動） ────────────────────────── */

/** SMTP 連線設定（由 env 解析；帳密不寫入 repo）。 */
export interface SmtpConfig {
  host: string;
  port: number;
  /** true＝TLS（通常 465）；false＝STARTTLS / 明文（通常 587 / 25）。 */
  secure: boolean;
  user?: string;
  pass?: string;
  /** 寄件人（From 標頭）。 */
  from: string;
}

/** smtpConfigFromEnv 讀取的環境變數鍵名（部署文件 / .env 對照用）。 */
export const SMTP_ENV_KEYS = Object.freeze([
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
] as const);

/**
 * 由環境變數解析 SMTP 設定。
 * - SMTP_HOST 未設定（或空白）→ 回傳 null（Email 管道未啟用，呼叫端優雅降級）。
 * - SMTP_PORT 預設 587；非法數值視同未設定。
 * - SMTP_SECURE：'true'/'1' 為真；未設定時 port 465 推定為真（慣例）。
 * - SMTP_FROM 預設依序回退：SMTP_USER → `wfms-noreply@<host>`。
 */
export function smtpConfigFromEnv(env: Record<string, string | undefined>): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const rawPort = Number.parseInt(env.SMTP_PORT ?? '', 10);
  const port = Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : 587;
  const secureEnv = env.SMTP_SECURE?.trim().toLowerCase();
  const secure = secureEnv === 'true' || secureEnv === '1' || (secureEnv === undefined && port === 465);
  const user = env.SMTP_USER?.trim() || undefined;
  const pass = env.SMTP_PASS ?? undefined;
  const from = env.SMTP_FROM?.trim() || user || `wfms-noreply@${host}`;
  return { host, port, secure, user, pass, from };
}

/* ────────────────────────── Email 內容組裝 ────────────────────────── */

/** 由 ReminderMessage（管道無關）組 Email 主旨與純文字內文（繁中）。 */
export function renderReminderEmail(message: ReminderMessage): { subject: string; text: string } {
  const dueIso = toIsoDate(message.dueDate);
  const lines: string[] = [
    message.body,
    '',
    `到期日：${dueIso}`,
  ];
  if (message.formCodes.length > 0) {
    lines.push(`應完成表單：${message.formCodes.join('、')}`);
  }
  lines.push('', '— 此信件由工作流程管理系統自動寄送，請勿直接回覆。');
  return { subject: message.title, text: lines.join('\n') };
}

/* ────────────────────────── EMAIL dispatcher ────────────────────────── */

/** 收件人 email 解析器（服務層以 Prisma User.email 實作；查無 / 停用回 null）。 */
export type EmailRecipientResolver = (userId: string) => Promise<string | null>;

export interface EmailDispatcherOptions {
  transport: MailTransport;
  /** 寄件人（From）。通常取 SmtpConfig.from。 */
  from: string;
  resolveEmail: EmailRecipientResolver;
}

/**
 * 建立 EMAIL 管道的 ReminderDispatcher（經 ReminderService.registerDispatcher 注入）。
 * - 查無收件人 email → ok:false, error:'recipient_email_missing'（不丟錯）。
 * - 傳輸失敗 → ok:false, error:<message>。
 * 失敗結果不會被落地去重日誌（ReminderService 僅記錄 ok:true 者），故下一輪自動重試。
 */
export function createEmailDispatcher(opts: EmailDispatcherOptions): ReminderDispatcher {
  return {
    channel: ReminderChannel.EMAIL,
    send: async (message: ReminderMessage): Promise<DispatchResult> => {
      const base = {
        dedupKey: message.dedupKey,
        channel: ReminderChannel.EMAIL,
        recipientId: message.recipientId,
      };
      try {
        const to = await opts.resolveEmail(message.recipientId);
        if (!to) return { ...base, ok: false, error: 'recipient_email_missing' };
        const { subject, text } = renderReminderEmail(message);
        await opts.transport.sendMail({ from: opts.from, to, subject, text });
        return { ...base, ok: true };
      } catch (err) {
        return { ...base, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
