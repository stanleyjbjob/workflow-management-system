/**
 * 帳號徽章 + 登出 + 角色檢視過濾（issue 8.5 #40）。
 *
 * 取代原本寫死的帳號顯示：
 * - authenticated：顯示真實姓名、email、角色；主管可切換「檢視角色」（僅過濾視角，非授權）。
 * - loading：顯示「載入中」。
 * - unauthenticated：顯示登入按鈕（當 AUTH_REDIRECT=false 未自動導向時）。
 * - error：顯示錯誤與重試。
 */
import type { SessionState } from './types';
import { describeRoles, roleLabel, viewRoleOptions } from './roles';

const badgeWrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  fontSize: '0.85rem',
  color: '#475569',
};

const btn: React.CSSProperties = {
  padding: '0.25rem 0.7rem',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  background: '#fff',
  color: '#334155',
  cursor: 'pointer',
  fontSize: '0.8rem',
};

export interface AccountBadgeProps {
  state: SessionState;
  onLogin: () => void;
  onLogout: () => void;
  onReload: () => void;
  /** 目前選定的檢視角色（過濾用）。 */
  viewRole: string | null;
  onViewRoleChange: (role: string | null) => void;
}

export function AccountBadge({
  state,
  onLogin,
  onLogout,
  onReload,
  viewRole,
  onViewRoleChange,
}: AccountBadgeProps): JSX.Element {
  if (state.status === 'loading') {
    return <div style={badgeWrap}>帳號載入中…</div>;
  }

  if (state.status === 'unauthenticated') {
    return (
      <div style={badgeWrap}>
        <span>尚未登入</span>
        <button type="button" style={btn} onClick={onLogin}>
          以 Microsoft 365 登入
        </button>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div style={badgeWrap}>
        <span style={{ color: '#b91c1c' }}>帳號載入失敗：{state.message}</span>
        <button type="button" style={btn} onClick={onReload}>
          重試
        </button>
      </div>
    );
  }

  const { user } = state;
  const options = viewRoleOptions(user.roles);
  const showRoleFilter = options.length > 1; // 實質為「主管可跨角色檢視」

  return (
    <div style={badgeWrap}>
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, textAlign: 'right' }}>
        <strong style={{ color: '#1e293b' }} title={user.email}>
          {user.name}
        </strong>
        <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{describeRoles(user.roles)}</span>
      </div>

      {showRoleFilter && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>檢視角色</span>
          <select
            value={viewRole ?? ''}
            onChange={(e) => onViewRoleChange(e.target.value || null)}
            style={{ ...btn, padding: '0.2rem 0.4rem' }}
          >
            {options.map((code) => (
              <option key={code} value={code}>
                {roleLabel(code)}
              </option>
            ))}
          </select>
        </label>
      )}

      <button type="button" style={btn} onClick={onLogout}>
        登出
      </button>
    </div>
  );
}
