/**
 * 共用 載入 / 錯誤 / 空狀態 元件（issue 8.4 #39）。
 *
 * 統一各 feature 頁（任務看板、稽核軌跡、案件詳情、專案管理…）的非資料狀態呈現，
 * 使錯誤碼與提示文案全站一致。沿用既有頁面的視覺樣式（.muted/.btn 與行內色碼）。
 *
 * `toErrorState` 將任意 catch 到的錯誤正規化為 { status, code, message }：
 * - `ApiError` → 保留後端 status/code/message；
 * - 其他 → status -1、code 'unknown'。
 */
import type { ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { errorHint } from './errorHint';

/** 正規化後的錯誤狀態（供 ErrorState 與各頁 state 共用）。 */
export interface NormalizedError {
  status: number;
  code: string;
  message: string;
}

/** 任意錯誤 → NormalizedError。 */
export function toErrorState(err: unknown): NormalizedError {
  if (err instanceof ApiError) return { status: err.status, code: err.code, message: err.message };
  return { status: -1, code: 'unknown', message: String(err) };
}

/** 載入中。 */
export function LoadingState({ label = '載入中…' }: { label?: string }): JSX.Element {
  return (
    <section>
      <p className="muted">{label}</p>
    </section>
  );
}

export interface ErrorStateProps {
  /** 標題（如「看板載入失敗」）。 */
  title?: string;
  /** 錯誤內容（ApiError 或已正規化者皆可）。 */
  error: NormalizedError;
  /** 提供時顯示「重試」按鈕。 */
  onRetry?: () => void;
}

/** 錯誤狀態：標題（含 code）＋ 訊息 ＋ 對應提示 ＋ 可選重試。 */
export function ErrorState({ title = '載入失敗', error, onRetry }: ErrorStateProps): JSX.Element {
  const hint = errorHint(error.status);
  return (
    <section>
      <p style={{ color: '#b91c1c', fontWeight: 600 }}>
        {title}（{error.code}）
      </p>
      <p className="muted" style={{ fontSize: '12.5px' }}>
        {error.message}
      </p>
      {hint && (
        <p className="muted" style={{ fontSize: '12.5px' }}>
          {hint}
        </p>
      )}
      {onRetry && (
        <button className="btn primary" onClick={onRetry}>
          重試
        </button>
      )}
    </section>
  );
}

/** 空狀態（查無資料）。 */
export function EmptyState({
  message = '目前沒有資料。',
  children,
}: {
  message?: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <section>
      <p className="muted">{message}</p>
      {children}
    </section>
  );
}
