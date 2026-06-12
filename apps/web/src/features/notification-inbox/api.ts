/**
 * 通知收件匣 REST 串接（issue 8.13 #48；後端 8.1 第 3 批 reminders.controller.ts）。
 *
 * 路由：
 * - GET  /reminders/inbox?unreadOnly=&take=        我的系統內通知（最新在前，收件人固定＝登入者）
 * - POST /reminders/inbox/:notificationId/read     將我的通知標為已讀（非本人視同 404）
 *
 * 查詢參數組裝（inboxQuery）為純函式，可被 vitest 直接測試。
 */
import { apiGet, apiPost, buildQuery } from '../../lib/api';
import type { InboxNotification } from './types';

/** `GET /reminders/inbox` 查詢參數。 */
export interface InboxQuery {
  /** 僅未讀（後端僅認 true/1；false 不送）。 */
  unreadOnly?: boolean;
  /** 上限筆數（後端預設 100）。 */
  take?: number | null;
}

/** 組 /reminders/inbox query string（純函式）。 */
export function inboxQuery(q: InboxQuery = {}): string {
  return buildQuery({
    unreadOnly: q.unreadOnly ? true : undefined,
    take: q.take,
  });
}

/** 取得我的通知（最新在前；後端以 session 使用者為收件人）。 */
export function fetchInbox(q: InboxQuery = {}): Promise<InboxNotification[]> {
  return apiGet<InboxNotification[]>(`/reminders/inbox${inboxQuery(q)}`);
}

/** 將一筆通知標為已讀（僅限本人；查無或非本人→404）。 */
export function markNotificationRead(notificationId: string): Promise<{ id: string; read: true }> {
  return apiPost<{ id: string; read: true }>(
    `/reminders/inbox/${encodeURIComponent(notificationId)}/read`,
  );
}
