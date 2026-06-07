/**
 * email-dispatcher 純邏輯單元測試（issue #32 / 7.2）。
 * 不需 nodemailer / DB：傳輸以假物件注入（MailTransport 介面）。
 */

import {
  MailTransport,
  OutgoingMail,
  createEmailDispatcher,
  renderReminderEmail,
  smtpConfigFromEnv,
} from './email-dispatcher';
import { ReminderChannel, ReminderKind, ReminderMessage } from './reminder-engine';

function sampleMessage(overrides: Partial<ReminderMessage> = {}): ReminderMessage {
  return {
    dedupKey: 'case1:s1|u1|DUE-0c|EMAIL|2026-06-08',
    channel: ReminderChannel.EMAIL,
    recipientId: 'u1',
    targetKey: 'case1:s1',
    kind: ReminderKind.DUE,
    title: '【今日到期】啟動會議',
    body: '任務「啟動會議」今日（2026-06-08）到期，請完成應辦事項。',
    dueDate: new Date('2026-06-08'),
    fireDate: new Date('2026-06-08'),
    formCodes: ['KICKOFF_FORM'],
    ...overrides,
  };
}

function fakeTransport(behavior?: (mail: OutgoingMail) => void): MailTransport & { sent: OutgoingMail[] } {
  const sent: OutgoingMail[] = [];
  return {
    sent,
    async sendMail(mail: OutgoingMail): Promise<void> {
      if (behavior) behavior(mail);
      sent.push(mail);
    },
  };
}

describe('smtpConfigFromEnv', () => {
  it('未設定 SMTP_HOST 回傳 null（Email 管道未啟用）', () => {
    expect(smtpConfigFromEnv({})).toBeNull();
    expect(smtpConfigFromEnv({ SMTP_HOST: '   ' })).toBeNull();
  });

  it('僅設定 SMTP_HOST 時套用預設：port 587、不加密、from 回退 noreply', () => {
    const cfg = smtpConfigFromEnv({ SMTP_HOST: 'mail.example.com' });
    expect(cfg).not.toBeNull();
    expect(cfg!.port).toBe(587);
    expect(cfg!.secure).toBe(false);
    expect(cfg!.from).toBe('wfms-noreply@mail.example.com');
    expect(cfg!.user).toBeUndefined();
  });

  it('port 465 未指明 SMTP_SECURE 時推定加密', () => {
    const cfg = smtpConfigFromEnv({ SMTP_HOST: 'mail.example.com', SMTP_PORT: '465' });
    expect(cfg!.port).toBe(465);
    expect(cfg!.secure).toBe(true);
  });

  it('SMTP_SECURE 明示 false 時即使 465 也不加密（尊重明示設定）', () => {
    const cfg = smtpConfigFromEnv({ SMTP_HOST: 'h', SMTP_PORT: '465', SMTP_SECURE: 'false' });
    expect(cfg!.secure).toBe(false);
  });

  it('SMTP_SECURE 支援 true / 1', () => {
    expect(smtpConfigFromEnv({ SMTP_HOST: 'h', SMTP_SECURE: 'true' })!.secure).toBe(true);
    expect(smtpConfigFromEnv({ SMTP_HOST: 'h', SMTP_SECURE: '1' })!.secure).toBe(true);
  });

  it('非法 SMTP_PORT 回退預設 587', () => {
    expect(smtpConfigFromEnv({ SMTP_HOST: 'h', SMTP_PORT: 'abc' })!.port).toBe(587);
    expect(smtpConfigFromEnv({ SMTP_HOST: 'h', SMTP_PORT: '-1' })!.port).toBe(587);
  });

  it('from 回退順序：SMTP_FROM → SMTP_USER → noreply', () => {
    expect(
      smtpConfigFromEnv({ SMTP_HOST: 'h', SMTP_USER: 'bot@example.com', SMTP_FROM: 'wfms@example.com' })!.from,
    ).toBe('wfms@example.com');
    expect(smtpConfigFromEnv({ SMTP_HOST: 'h', SMTP_USER: 'bot@example.com' })!.from).toBe('bot@example.com');
  });

  it('完整設定全數帶出', () => {
    const cfg = smtpConfigFromEnv({
      SMTP_HOST: 'smtp.office365.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USER: 'noreply@corp.com',
      SMTP_PASS: 's3cret',
      SMTP_FROM: '工作流程系統 <noreply@corp.com>',
    });
    expect(cfg).toEqual({
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      user: 'noreply@corp.com',
      pass: 's3cret',
      from: '工作流程系統 <noreply@corp.com>',
    });
  });
});

describe('renderReminderEmail', () => {
  it('主旨取通知標題、內文含原文與到期日', () => {
    const { subject, text } = renderReminderEmail(sampleMessage());
    expect(subject).toBe('【今日到期】啟動會議');
    expect(text).toContain('任務「啟動會議」今日（2026-06-08）到期');
    expect(text).toContain('到期日：2026-06-08');
    expect(text).toContain('應完成表單：KICKOFF_FORM');
    expect(text).toContain('自動寄送');
  });

  it('無表單代碼時不出現表單列', () => {
    const { text } = renderReminderEmail(sampleMessage({ formCodes: [] }));
    expect(text).not.toContain('應完成表單');
  });
});

describe('createEmailDispatcher', () => {
  it('管道為 EMAIL', () => {
    const d = createEmailDispatcher({
      transport: fakeTransport(),
      from: 'wfms@example.com',
      resolveEmail: async () => 'a@example.com',
    });
    expect(d.channel).toBe(ReminderChannel.EMAIL);
  });

  it('成功寄出：解析收件人、寄信、回 ok:true', async () => {
    const transport = fakeTransport();
    const d = createEmailDispatcher({
      transport,
      from: 'wfms@example.com',
      resolveEmail: async (id) => (id === 'u1' ? 'user1@corp.com' : null),
    });
    const result = await d.send(sampleMessage());
    expect(result.ok).toBe(true);
    expect(result.channel).toBe(ReminderChannel.EMAIL);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].to).toBe('user1@corp.com');
    expect(transport.sent[0].from).toBe('wfms@example.com');
    expect(transport.sent[0].subject).toBe('【今日到期】啟動會議');
  });

  it('查無收件人 email → ok:false recipient_email_missing、不寄信', async () => {
    const transport = fakeTransport();
    const d = createEmailDispatcher({
      transport,
      from: 'wfms@example.com',
      resolveEmail: async () => null,
    });
    const result = await d.send(sampleMessage());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('recipient_email_missing');
    expect(transport.sent).toHaveLength(0);
  });

  it('傳輸丟錯 → 捕捉為 ok:false 帶錯誤訊息（不外拋）', async () => {
    const transport = fakeTransport(() => {
      throw new Error('smtp_connection_refused');
    });
    const d = createEmailDispatcher({
      transport,
      from: 'wfms@example.com',
      resolveEmail: async () => 'user1@corp.com',
    });
    const result = await d.send(sampleMessage());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('smtp_connection_refused');
  });

  it('resolveEmail 丟錯亦捕捉為 ok:false', async () => {
    const d = createEmailDispatcher({
      transport: fakeTransport(),
      from: 'wfms@example.com',
      resolveEmail: async () => {
        throw new Error('db_unavailable');
      },
    });
    const result = await d.send(sampleMessage());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('db_unavailable');
  });
});
