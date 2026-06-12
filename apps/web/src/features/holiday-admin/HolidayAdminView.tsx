/**
 * 假日維護 呈現元件（issue 8.14 #49）。
 *
 * 無資料存取；由 HolidayAdminPage 餵資料與回呼（與 IsoTrailView / KanbanView 同模式）。
 * 版面：過濾列（年度快選＋from/to＋類型）→ 新增表單卡 → 清單表格（列內編輯／刪除）。
 */
import { useState } from 'react';
import type { HolidayRecord, HolidaySourceCode, HolidayTypeCode } from './types';
import {
  SOURCE_LABELS,
  TYPE_LABELS,
  draftFromRecord,
  emptyDraft,
  isoDateOf,
  sourceLabel,
  typeLabel,
  yearRange,
  type HolidayDraft,
  type HolidayFilterState,
} from './holiday-admin-view';

export interface HolidayAdminViewProps {
  records: readonly HolidayRecord[];
  filter: HolidayFilterState;
  onFilterChange: (next: HolidayFilterState) => void;
  /** 套用目前過濾（重新取數）。 */
  onApply: () => void;
  /** 新增（驗證與錯誤處理在容器）。 */
  onCreate: (draft: HolidayDraft) => Promise<boolean>;
  /** 更新；成功回 true（供關閉列內編輯）。 */
  onUpdate: (id: string, draft: HolidayDraft) => Promise<boolean>;
  onDelete: (id: string) => void;
  /** 寫入中（停用按鈕避免重複送出）。 */
  busy: boolean;
  /** 寫入錯誤訊息（顯示於新增卡下方；null 表示無）。 */
  writeError: string | null;
}

function DraftFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: HolidayDraft;
  onChange: (next: HolidayDraft) => void;
  idPrefix: string;
}): JSX.Element {
  return (
    <>
      <label className="muted" style={{ fontSize: '12.5px' }} htmlFor={`${idPrefix}-date`}>
        日期{' '}
        <input
          id={`${idPrefix}-date`}
          type="date"
          className="btn sm"
          value={draft.date}
          onChange={(e) => onChange({ ...draft, date: e.target.value })}
        />
      </label>
      <label className="muted" style={{ fontSize: '12.5px' }} htmlFor={`${idPrefix}-name`}>
        名稱{' '}
        <input
          id={`${idPrefix}-name`}
          className="btn sm"
          placeholder="如：春節、補班"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
      </label>
      <label className="muted" style={{ fontSize: '12.5px' }} htmlFor={`${idPrefix}-type`}>
        類型{' '}
        <select
          id={`${idPrefix}-type`}
          className="btn sm"
          value={draft.type}
          onChange={(e) => onChange({ ...draft, type: e.target.value as HolidayTypeCode })}
        >
          {Object.entries(TYPE_LABELS).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="muted" style={{ fontSize: '12.5px' }} htmlFor={`${idPrefix}-source`}>
        來源{' '}
        <select
          id={`${idPrefix}-source`}
          className="btn sm"
          value={draft.source}
          onChange={(e) => onChange({ ...draft, source: e.target.value as HolidaySourceCode })}
        >
          {Object.entries(SOURCE_LABELS).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="muted" style={{ fontSize: '12.5px' }} htmlFor={`${idPrefix}-note`}>
        備註{' '}
        <input
          id={`${idPrefix}-note`}
          className="btn sm"
          placeholder="選填"
          value={draft.note}
          onChange={(e) => onChange({ ...draft, note: e.target.value })}
        />
      </label>
    </>
  );
}

export function HolidayAdminView({
  records,
  filter,
  onFilterChange,
  onApply,
  onCreate,
  onUpdate,
  onDelete,
  busy,
  writeError,
}: HolidayAdminViewProps): JSX.Element {
  const [draft, setDraft] = useState<HolidayDraft>(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<HolidayDraft>(emptyDraft());
  const [year, setYear] = useState<string>(filter.from.slice(0, 4));

  const applyYear = (): void => {
    const y = Number(year);
    if (!Number.isInteger(y) || y < 1970 || y > 9999) return;
    onFilterChange({ ...filter, ...yearRange(y) });
    onApply();
  };

  const startEdit = (r: HolidayRecord): void => {
    setEditingId(r.id);
    setEditDraft(draftFromRecord(r));
  };

  return (
    <section>
      <div className="sec-title">
        假日維護
        <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
          僅主管可維護；變更即時影響看板遞延標示與排程遞延（DB 驅動）
        </span>
      </div>

      {/* 過濾列 */}
      <div className="row" style={{ marginBottom: 12, alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <label className="muted" style={{ fontSize: '12.5px' }} htmlFor="holiday-filter-year">
          年度{' '}
          <input
            id="holiday-filter-year"
            className="btn sm"
            style={{ width: 70 }}
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </label>
        <button className="btn sm" onClick={applyYear} disabled={busy}>
          套用年度
        </button>
        <label className="muted" style={{ fontSize: '12.5px' }} htmlFor="holiday-filter-from">
          起{' '}
          <input
            id="holiday-filter-from"
            type="date"
            className="btn sm"
            value={filter.from}
            onChange={(e) => onFilterChange({ ...filter, from: e.target.value })}
          />
        </label>
        <label className="muted" style={{ fontSize: '12.5px' }} htmlFor="holiday-filter-to">
          迄{' '}
          <input
            id="holiday-filter-to"
            type="date"
            className="btn sm"
            value={filter.to}
            onChange={(e) => onFilterChange({ ...filter, to: e.target.value })}
          />
        </label>
        <label className="muted" style={{ fontSize: '12.5px' }} htmlFor="holiday-filter-type">
          類型{' '}
          <select
            id="holiday-filter-type"
            className="btn sm"
            value={filter.type}
            onChange={(e) => onFilterChange({ ...filter, type: e.target.value as HolidayFilterState['type'] })}
          >
            <option value="">全部</option>
            {Object.entries(TYPE_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary sm" onClick={onApply} disabled={busy}>
          套用過濾
        </button>
      </div>

      {/* 新增表單 */}
      <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
        <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <DraftFields draft={draft} onChange={setDraft} idPrefix="holiday-new" />
          <button
            className="btn primary sm"
            disabled={busy}
            onClick={() => {
              void onCreate(draft).then((ok) => {
                if (ok) setDraft(emptyDraft());
              });
            }}
          >
            新增
          </button>
        </div>
        {writeError && (
          <p style={{ color: '#b91c1c', fontSize: '12.5px', margin: '8px 0 0' }}>{writeError}</p>
        )}
      </div>

      {/* 清單 */}
      {records.length === 0 ? (
        <p className="muted">目前區間內沒有假日／補班資料。</p>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>日期</th>
                <th style={{ textAlign: 'left' }}>名稱</th>
                <th style={{ textAlign: 'left' }}>類型</th>
                <th style={{ textAlign: 'left' }}>來源</th>
                <th style={{ textAlign: 'left' }}>備註</th>
                <th style={{ textAlign: 'left' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) =>
                editingId === r.id ? (
                  <tr key={r.id}>
                    <td colSpan={5}>
                      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <DraftFields draft={editDraft} onChange={setEditDraft} idPrefix={`holiday-edit-${r.id}`} />
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className="btn primary sm"
                        disabled={busy}
                        onClick={() => {
                          void onUpdate(r.id, editDraft).then((ok) => {
                            if (ok) setEditingId(null);
                          });
                        }}
                      >
                        儲存
                      </button>{' '}
                      <button className="btn sm" disabled={busy} onClick={() => setEditingId(null)}>
                        取消
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id}>
                    <td>{isoDateOf(r.date)}</td>
                    <td>{r.name}</td>
                    <td>{typeLabel(r.type)}</td>
                    <td>{sourceLabel(r.source)}</td>
                    <td className="muted">{r.note ?? ''}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn sm" disabled={busy} onClick={() => startEdit(r)}>
                        編輯
                      </button>{' '}
                      <button className="btn sm" disabled={busy} onClick={() => onDelete(r.id)}>
                        刪除
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
