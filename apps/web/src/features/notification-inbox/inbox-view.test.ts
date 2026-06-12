/** 通知收件匣純呈現邏輯測試（issue 8.13 #48）。 */
import { describe, expect, it } from 'vitest';
import {
  badgeText,
  formatNotificationTime,
  kindColor,
  kindLabel,
  markReadLocally,
  unreadCount,
  visibleNotifications,
} from './inbox-view';
import type { InboxNotification } from './types';

function n(id: string, read: boolean, kind = 'DUE'): InboxNotification {
  return { id, title: `t-${id}`, body: `b-${id}`, kind, read, createdAt: '2026-06-12T00:00:00.000Z', caseId: null };
}

describe('unreadCount / badgeText', () => {
  it('計算未讀數', () => {
    expect(unreadCount([])).toBe(0);
    expect(unreadCount([n('a', false), n('b', true), n('c', false)])).toBe(2);
  });

  it('徽章文字：0 不顯示、>99 顯示 99+', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(-1)).toBeNull();
    expect(badgeText(1)).toBe('1');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });
});

describe('markReadLocally', () => {
  it('將指定通知標已讀、不變更順序、不影響其他筆', () => {
    const list = [n('a', false), n('b', false)];
    const next = markReadLocally(list, 'b');
    expect(next.map((x) => x.id)).toEqual(['a', 'b']);
    expect(next[0].read).toBe(false);
    expect(next[1].read).toBe(true);
    // 原陣列不被改動（immutable）
    expect(list[1].read).toBe(false);
  });

  it('id 不存在或已讀則內容不變', () => {
    const list = [n('a', true)];
    expect(markReadLocally(list, 'zzz')).toEqual(list);
    expect(markReadLocally(list, 'a')[0]).toBe(list[0]);
  });
});

describe('visibleNotifications', () => {
  it('unreadOnly=true 僅留未讀；false 原序全列', () => {
    const list = [n('a', true), n('b', false)];
    expect(visibleNotifications(list, true).map((x) => x.id)).toEqual(['b']);
    expect(visibleNotifications(list, false).map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('kindLabel / kindColor', () => {
  it('LEAD/DUE/OVERDUE 對應中文；未知值回「通知」', () => {
    expect(kindLabel('LEAD')).toBe('提前提醒');
    expect(kindLabel('DUE')).toBe('到期提醒');
    expect(kindLabel('OVERDUE')).toBe('逾期提醒');
    expect(kindLabel('???')).toBe('通知');
    expect(kindLabel('')).toBe('通知');
  });

  it('逾期紅、到期橘、其餘灰藍', () => {
    expect(kindColor('OVERDUE')).toBe('#b91c1c');
    expect(kindColor('DUE')).toBe('#b45309');
    expect(kindColor('LEAD')).toBe('#475569');
    expect(kindColor('x')).toBe('#475569');
  });
});

describe('formatNotificationTime', () => {
  const now = new Date('2026-06-12T12:00:00.000Z');

  it('依距今時間分段呈現', () => {
    expect(formatNotificationTime('2026-06-12T11:59:30.000Z', now)).toBe('剛剛');
    expect(formatNotificationTime('2026-06-12T11:45:00.000Z', now)).toBe('15 分鐘前');
    expect(formatNotificationTime('2026-06-12T09:00:00.000Z', now)).toBe('3 小時前');
    expect(formatNotificationTime('2026-06-10T12:00:00.000Z', now)).toBe('2 天前');
  });

  it('滿 7 天（含）與未來時間顯示日期；非法字串原樣返回', () => {
    expect(formatNotificationTime('2026-06-05T12:00:00.000Z', now)).toBe('2026-06-05');
    expect(formatNotificationTime('2026-06-13T00:00:00.000Z', now)).toBe('2026-06-13');
    expect(formatNotificationTime('not-a-date', now)).toBe('not-a-date');
  });
});
