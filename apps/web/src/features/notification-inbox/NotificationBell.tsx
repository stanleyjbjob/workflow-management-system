/**
 * 通知鈴鐺＋收件匣下拉（issue 8.13 #48）。
 *
 * - 掛載時抓一次 `GET /reminders/inbox`（供未讀徽章）；展開與「重新整理」時重抓。
 * - 點擊通知：樂觀標已讀（失敗回滾）＋ `POST /reminders/inbox/:id/read`；
 *   若通知帶 caseId 則一併呼叫 onOpenCase 導向案件詳情並收合面板。
 * - 「只看未讀」為客端過濾（一次取回後端預設 100 筆內篩選，免重抓）。
 * - 錯誤呈現沿用 8.4 慣例（toErrorState＋errorHint；401 由 lib/api 統一導登入）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toErrorState, type NormalizedError } from '../../components/AsyncStates';
import { errorHint } from '../../components/errorHint';
import { fetchInbox, markNotificationRead } from './api';
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

export interface NotificationBellProps {
  /** 通知帶 caseId 時點擊導向案件詳情（由 App 接 openCase）。 */
  onOpenCase?: (caseId: string) => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; list: InboxNotification[]; refreshing: boolean }
  | { kind: 'error'; error: NormalizedError };

export function NotificationBell({ onOpenCase }: NotificationBellProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  /** 遞增請求序號：僅最新請求的回應可落地（沿用 8.9 防競態慣例）。 */
  const seqRef = useRef(0);

  const load = useCallback((): void => {
    const seq = ++seqRef.current;
    setState((prev) => (prev.kind === 'ready' ? { ...prev, refreshing: true } : { kind: 'loading' }));
    fetchInbox()
      .then((list) => {
        if (seqRef.current !== seq) return;
        setState({ kind: 'ready', list, refreshing: false });
      })
      .catch((err: unknown) => {
        if (seqRef.current !== seq) return;
        setState({ kind: 'error', error: toErrorState(err) });
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleOpen = (): void => {
    setOpen((prev) => {
      const next = !prev;
      if (next) load(); // 每次展開重抓，確保未讀數即時
      return next;
    });
  };

  const handleItemClick = (item: InboxNotification): void => {
    if (!item.read) {
      // 樂觀標已讀；失敗回滾（404 含「非本人」情境，不額外打擾使用者）。
      setState((prev) => (prev.kind === 'ready' ? { ...prev, list: markReadLocally(prev.list, item.id) } : prev));
      markNotificationRead(item.id).catch(() => {
        setState((prev) =>
          prev.kind === 'ready'
            ? { ...prev, list: prev.list.map((x) => (x.id === item.id ? { ...x, read: false } : x)) }
            : prev,
        );
      });
    }
    if (item.caseId && onOpenCase) {
      onOpenCase(item.caseId);
      setOpen(false);
    }
  };

  const count = state.kind === 'ready' ? unreadCount(state.list) : 0;
  const badge = badgeText(count);
  const now = new Date();

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={toggleOpen}
        aria-label={badge ? `通知（${count} 則未讀）` : '通知'}
        title="通知收件匣"
        style={{
          position: 'relative',
          padding: '0.25rem 0.55rem',
          border: '1px solid #cbd5e1',
          borderRadius: 6,
          background: open ? '#eff6ff' : '#fff',
          cursor: 'pointer',
          fontSize: '0.95rem',
          lineHeight: 1.2,
        }}
      >
        🔔
        {badge && (
          <span
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              minWidth: 16,
              padding: '0 4px',
              borderRadius: 999,
              background: '#dc2626',
              color: '#fff',
              fontSize: '0.65rem',
              fontWeight: 700,
              lineHeight: '16px',
              textAlign: 'center',
            }}
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            width: 340,
            maxHeight: 420,
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
            zIndex: 50,
            padding: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0.25rem 0.4rem' }}>
            <strong style={{ fontSize: '0.9rem', color: '#1e293b' }}>通知收件匣</strong>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
                只看未讀
              </label>
              <button
                onClick={load}
                style={{ border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '0.75rem' }}
              >
                重新整理
              </button>
            </span>
          </div>

          {state.kind === 'loading' && <p style={{ margin: '0.5rem', color: '#64748b', fontSize: '0.85rem' }}>載入中…</p>}

          {state.kind === 'error' && (
            <div style={{ margin: '0.5rem', fontSize: '0.85rem' }}>
              <p style={{ margin: 0, color: '#b91c1c', fontWeight: 600 }}>通知載入失敗（{state.error.code}）</p>
              <p style={{ margin: '0.25rem 0', color: '#64748b' }}>
                {state.error.message}
                {errorHint(state.error.status) ? `；${errorHint(state.error.status)}` : ''}
              </p>
              <button
                onClick={load}
                style={{ border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: '0.8rem', padding: '0.2rem 0.6rem' }}
              >
                重試
              </button>
            </div>
          )}

          {state.kind === 'ready' &&
            (() => {
              const items = visibleNotifications(state.list, unreadOnly);
              if (items.length === 0) {
                return (
                  <p style={{ margin: '0.5rem', color: '#64748b', fontSize: '0.85rem' }}>
                    {unreadOnly ? '沒有未讀通知。' : '目前沒有通知。'}
                  </p>
                );
              }
              return (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, opacity: state.refreshing ? 0.6 : 1 }}>
                  {items.map((item) => (
                    <li key={item.id}>
                      <button
                        onClick={() => handleItemClick(item)}
                        title={item.caseId ? '點擊標已讀並開啟案件' : '點擊標已讀'}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          border: 'none',
                          borderBottom: '1px solid #f1f5f9',
                          background: item.read ? '#fff' : '#eff6ff',
                          cursor: 'pointer',
                          padding: '0.5rem 0.45rem',
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem' }}>
                          <span style={{ color: kindColor(item.kind), fontWeight: 700 }}>{kindLabel(item.kind)}</span>
                          <span style={{ color: '#94a3b8' }}>{formatNotificationTime(item.createdAt, now)}</span>
                          {!item.read && <span style={{ color: '#2563eb', fontWeight: 700 }}>●</span>}
                        </span>
                        <span
                          style={{
                            display: 'block',
                            marginTop: 2,
                            fontSize: '0.85rem',
                            color: '#1e293b',
                            fontWeight: item.read ? 400 : 600,
                          }}
                        >
                          {item.title || '（無標題）'}
                        </span>
                        {item.body && (
                          <span style={{ display: 'block', marginTop: 2, fontSize: '0.78rem', color: '#64748b' }}>
                            {item.body}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              );
            })()}
        </div>
      )}
    </div>
  );
}
