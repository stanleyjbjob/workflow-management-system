/**
 * 通知收件匣 純呈現邏輯（issue 8.13 #48）。
 *
 * 與 NotificationBell.tsx 分離：未讀數、樂觀標已讀、未讀過濾、種類標籤、相對時間
 * 皆為純函式（無 fetch / DOM 相依），可被 vitest 直接測試。
 */
import type { InboxNotification } from './types';

/** 未讀數（鈴鐺徽章）。 */
export function unreadCount(list: readonly InboxNotification[]): number {
  return list.reduce((n, item) => (item.read ? n : n + 1), 0);
}

/** 徽章顯示文字：0 → null（不顯示）；>99 → '99+'。 */
export function badgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

/** 樂觀更新：將指定通知標為已讀（不存在則原樣返回；不變更順序）。 */
export function markReadLocally(
  list: readonly InboxNotification[],
  id: string,
): InboxNotification[] {
  return list.map((item) => (item.id === id && !item.read ? { ...item, read: true } : item));
}

/** 依「只看未讀」過濾（false 時原序全列）。 */
export function visibleNotifications(
  list: readonly InboxNotification[],
  unreadOnly: boolean,
): InboxNotification[] {
  return unreadOnly ? list.filter((item) => !item.read) : [...list];
}

/** 提醒種類 → 中文標籤（reminder-engine ReminderKind；未知值回「通知」）。 */
export function kindLabel(kind: string): string {
  switch (kind) {
    case 'LEAD':
      return '提前提醒';
    case 'DUE':
      return '到期提醒';
    case 'OVERDUE':
      return '逾期提醒';
    default:
      return '通知';
  }
}

/** 種類對應強調色（逾期紅、到期橘、其餘灰藍）。 */
export function kindColor(kind: string): string {
  switch (kind) {
    case 'OVERDUE':
      return '#b91c1c';
    case 'DUE':
      return '#b45309';
    default:
      return '#475569';
  }
}

/**
 * 相對時間（now 由呼叫端注入以利測試）：
 * <1 分鐘「剛剛」；<60 分鐘「N 分鐘前」；<24 小時「N 小時前」；<7 天「N 天前」；
 * 其餘（含未來時間與非法字串）顯示日期 yyyy-mm-dd（非法→原字串）。
 */
export function formatNotificationTime(createdAt: string, now: Date): string {
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return createdAt;
  const diffMs = now.getTime() - t;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs >= 0 && diffMs < minute) return '剛剛';
  if (diffMs >= minute && diffMs < hour) return `${Math.floor(diffMs / minute)} 分鐘前`;
  if (diffMs >= hour && diffMs < day) return `${Math.floor(diffMs / hour)} 小時前`;
  if (diffMs >= day && diffMs < 7 * day) return `${Math.floor(diffMs / day)} 天前`;
  return new Date(t).toISOString().slice(0, 10);
}
