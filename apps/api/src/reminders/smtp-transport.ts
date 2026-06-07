/**
 * nodemailer SMTP 傳輸包裝（issue #32 / 7.2）。
 *
 * 僅此檔依賴 nodemailer；email-dispatcher.ts 透過 `MailTransport` 介面與之解耦，
 * 使派送邏輯可純函式測試（測試注入假傳輸即可，不需真的連 SMTP）。
 */

import { createTransport } from 'nodemailer';
import { MailTransport, OutgoingMail, SmtpConfig } from './email-dispatcher';

/** 由 SMTP 設定建立 nodemailer 傳輸（帳密由 env 提供，見 smtpConfigFromEnv）。 */
export function createSmtpTransport(config: SmtpConfig): MailTransport {
  const transporter = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass ?? '' } : undefined,
  });
  return {
    async sendMail(mail: OutgoingMail): Promise<void> {
      await transporter.sendMail({
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      });
    },
  };
}
