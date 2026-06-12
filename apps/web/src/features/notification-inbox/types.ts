/**
 * 通知收件匣 型別鏡像（issue 8.13 #48）。
 *
 * 對應後端 `GET /reminders/inbox`（reminders.controller.ts → ReminderService.listInAppNotifications）：
 * 後端回傳 { id, title, body, kind, read, createdAt, caseId }；日期經 JSON 序列化為 ISO 字串。
 */

/** 一筆系統內(IN_APP)通知。 */
export interface InboxNotification {
  id: string;
  title: string;
  body: string;
  /** 提醒種類（reminder-engine ReminderKind：LEAD / DUE / OVERDUE；其他值容忍）。 */
  kind: string;
  read: boolean;
  /** ISO 字串（後端 Date 經 JSON 序列化）。 */
  createdAt: string;
  /** 來源案件（落地時由 targetKey 解析）；舊資料或無案件來源時為 null。 */
  caseId?: string | null;
}
