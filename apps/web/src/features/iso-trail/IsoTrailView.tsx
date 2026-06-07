/**
 * ISO 27001 稽核軌跡查閱頁（§11 / issue 8.3 #35）。
 *  - 上方 KPI：可稽核紀錄 / 需簽核 / 簽核缺口 / 留存到期（prototype .grid-kpi 樣式）。
 *  - 過濾：紀錄類別 / 文件種類 / 案件 / 專案 / 日期區間 / 簽核狀態（套用後由上層重新取數）。
 *  - 列表：點列展開簽核與事件軌跡；留存政策未注入時 retentionUntil 顯示「不限／未定」。
 *  - 一鍵匯出：JSON / CSV（接 GET /iso-trail/export(.csv)，沿用 session cookie 認證）。
 * 過濾與彙總由後端完成；本元件僅呈現與檢視層互動。資料未提供時使用 seed 範例。
 */
import { useMemo, useState } from 'react';
import type { TrailFilterState } from './api';
import { EMPTY_TRAIL_FILTER } from './api';
import { sampleTrailRecords, sampleTrailSummary } from './seed';
import {
  SIGN_FILTER_OPTIONS,
  buildSummaryCards,
  formatDateTime,
  recordKey,
  retentionLabel,
  signStatusMeta,
  sortTrail,
  topAspects,
} from './trail-view';
import type { SignFilter } from './trail-view';
import {
  DOCUMENT_KIND_LABELS,
  RECORD_TYPE_LABELS,
  TRACE_ACTION_LABELS,
  type IsoDocumentKind,
  type TraceRecordType,
  type TraceabilityRecord,
  type TrailSummary,
} from './types';

export interface IsoTrailViewProps {
  records?: TraceabilityRecord[];
  summary?: TrailSummary;
  filter?: TrailFilterState;
  onFilterChange?: (next: TrailFilterState) => void;
  /** 按「套用過濾」時呼叫（由上層重新取數）。 */
  onApply?: () => void;
  /** 匯出連結（未提供則隱藏匯出按鈕，例如 seed 展示模式）。 */
  exportJsonHref?: string;
  exportCsvHref?: string;
}

const RECORD_TYPE_OPTIONS = Object.entries(RECORD_TYPE_LABELS) as [TraceRecordType, string][];
const DOCUMENT_KIND_OPTIONS = Object.entries(DOCUMENT_KIND_LABELS) as [IsoDocumentKind, string][];

export function IsoTrailView({
  records = sampleTrailRecords,
  summary = sampleTrailSummary,
  filter = EMPTY_TRAIL_FILTER,
  onFilterChange,
  onApply,
  exportJsonHref,
  exportCsvHref,
}: IsoTrailViewProps): JSX.Element {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const rows = useMemo(() => sortTrail(records), [records]);
  const cards = useMemo(() => buildSummaryCards(summary), [summary]);
  const aspects = useMemo(() => topAspects(summary.byAspect), [summary]);

  const patch = (p: Partial<TrailFilterState>): void => {
    onFilterChange?.({ ...filter, ...p });
  };

  return (
    <section>
      <div className="iso-note">
        🛡️ <b>ISO 27001 文件化軌跡：</b>彙整表單簽核、附件、登入與專案紀錄為統一稽核軌跡，支援過濾查閱、簽核缺口檢視與一鍵匯出。
        主管可綜覽全部，其餘角色依可見範圍收斂（由後端處理）。
      </div>

      <div className="grid-kpi">
        {cards.map((c) => (
          <div className="card kpi" key={c.key}>
            <div className="n" style={{ color: c.color }}>
              {c.value}
            </div>
            <div className="l">{c.label}</div>
            <div className="bar">
              <i style={{ width: `${c.pct}%`, background: c.color }} />
            </div>
          </div>
        ))}
      </div>

      {aspects.length > 0 && (
        <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
          {aspects.map((a) => (
            <span key={a.aspect} className="pill p-blue" title={a.aspect}>
              {a.aspect}　{a.count}
            </span>
          ))}
        </div>
      )}

      <div className="sec-title">
        🛡️ 稽核軌跡
        <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
          　點列可展開簽核與事件軌跡
        </span>
        <span style={{ flex: 1 }} />
        {exportJsonHref && (
          <a className="btn sm" href={exportJsonHref} target="_blank" rel="noreferrer">
            ⬇️ 匯出 JSON
          </a>
        )}
        {exportCsvHref && (
          <a className="btn sm" href={exportCsvHref}>
            ⬇️ 下載 CSV
          </a>
        )}
      </div>

      <div className="row" style={{ marginBottom: 14, alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <label className="muted" style={{ fontSize: '12.5px' }}>
          類別：
          <select
            className="btn sm"
            value={filter.recordType}
            onChange={(e) => patch({ recordType: e.target.value })}
            style={{ marginLeft: 4 }}
          >
            <option value="">全部</option>
            {RECORD_TYPE_OPTIONS.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="muted" style={{ fontSize: '12.5px' }}>
          文件種類：
          <select
            className="btn sm"
            value={filter.documentKind}
            onChange={(e) => patch({ documentKind: e.target.value })}
            style={{ marginLeft: 4 }}
          >
            <option value="">全部</option>
            {DOCUMENT_KIND_OPTIONS.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="muted" style={{ fontSize: '12.5px' }}>
          簽核：
          <select
            className="btn sm"
            value={filter.sign}
            onChange={(e) => patch({ sign: e.target.value as SignFilter })}
            style={{ marginLeft: 4 }}
          >
            {SIGN_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="muted" style={{ fontSize: '12.5px' }}>
          案件：
          <input
            className="btn sm"
            value={filter.caseId}
            placeholder="caseId"
            onChange={(e) => patch({ caseId: e.target.value })}
            style={{ marginLeft: 4, width: 110 }}
          />
        </label>
        <label className="muted" style={{ fontSize: '12.5px' }}>
          專案：
          <input
            className="btn sm"
            value={filter.projectId}
            placeholder="projectId"
            onChange={(e) => patch({ projectId: e.target.value })}
            style={{ marginLeft: 4, width: 110 }}
          />
        </label>
        <label className="muted" style={{ fontSize: '12.5px' }}>
          自：
          <input
            className="btn sm"
            type="date"
            value={filter.from}
            onChange={(e) => patch({ from: e.target.value })}
            style={{ marginLeft: 4 }}
          />
        </label>
        <label className="muted" style={{ fontSize: '12.5px' }}>
          至：
          <input
            className="btn sm"
            type="date"
            value={filter.to}
            onChange={(e) => patch({ to: e.target.value })}
            style={{ marginLeft: 4 }}
          />
        </label>
        {onApply && (
          <button className="btn primary sm" onClick={onApply}>
            套用過濾
          </button>
        )}
        <span className="muted" style={{ fontSize: 12 }}>
          共 {rows.length} 筆
        </span>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: '9%' }}>類別</th>
              <th>標題</th>
              <th style={{ width: '11%' }}>文件種類</th>
              <th style={{ width: '17%' }}>ISO 面向</th>
              <th style={{ width: '5%' }}>版本</th>
              <th style={{ width: '9%' }}>簽核狀態</th>
              <th style={{ width: '13%' }}>發生時間</th>
              <th style={{ width: '10%' }}>留存期限</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 18 }}>
                  無符合過濾條件的稽核紀錄
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const key = recordKey(r);
              const sign = signStatusMeta(r.signStatus);
              const expanded = expandedKey === key;
              return [
                <tr
                  key={key}
                  onClick={() => setExpandedKey(expanded ? null : key)}
                  style={{ cursor: 'pointer', background: expanded ? 'var(--brand-l)' : undefined }}
                >
                  <td>
                    <span className="pill p-grey">{RECORD_TYPE_LABELS[r.recordType] ?? r.recordType}</span>
                  </td>
                  <td>
                    <b>{r.title}</b>
                    {r.annexHint && (
                      <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                        {r.annexHint}
                      </span>
                    )}
                  </td>
                  <td>{DOCUMENT_KIND_LABELS[r.documentKind] ?? r.documentKind}</td>
                  <td className="muted" style={{ fontSize: '12.5px' }}>
                    {r.isoAspect}
                  </td>
                  <td>v{r.version}</td>
                  <td>
                    <span className={`pill ${sign.pill}`}>{sign.label}</span>
                  </td>
                  <td className="muted" style={{ fontSize: '12.5px' }}>
                    {formatDateTime(r.occurredAt)}
                  </td>
                  <td className="muted" style={{ fontSize: '12.5px' }}>
                    {retentionLabel(r.retentionUntil)}
                  </td>
                </tr>,
                expanded ? (
                  <tr key={`${key}-detail`}>
                    <td colSpan={8} style={{ background: '#fbfcfe' }}>
                      <div style={{ padding: '6px 4px' }}>
                        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                          {r.caseId ? `案件：${r.caseId}　` : ''}
                          {r.projectId ? `專案：${r.projectId}　` : ''}
                          {r.actorId ? `主要人員：${r.actorId}` : ''}
                        </div>
                        {r.events.map((e, i) => (
                          <div key={i} style={{ fontSize: '12.5px', padding: '2px 0' }}>
                            <span className="pill p-blue" style={{ marginRight: 6 }}>
                              {TRACE_ACTION_LABELS[e.action] ?? e.action}
                            </span>
                            {formatDateTime(e.at)}　{e.actorId ?? '系統'}
                            {e.detail ? `　— ${e.detail}` : ''}
                          </div>
                        ))}
                        {r.events.length === 0 && (
                          <div className="muted" style={{ fontSize: 12 }}>
                            無事件軌跡
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>

      <div className="legend">
        <span>🟩 已核可　🟧 待簽核　🟥 已退回　⬜ 無需簽核</span>
        <span>留存期限「不限／未定」＝留存政策待 §11.3 定案後注入</span>
      </div>
    </section>
  );
}
