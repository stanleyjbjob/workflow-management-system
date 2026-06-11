/**
 * 任務看板畫面（issue 6.1 / §8；8.9 #44 改為伺服端過濾）。
 *  - 上方 KPI：待處理 / 即將到期 / 逾期 / 遞延（prototype .grid-kpi 樣式）；由後端計算、前端直接呈現。
 *  - 過濾：角色（責任角色）、流程型別、僅看與我相關、「即將到期」視窗（工作日）。
 *    過濾器為**受控元件**：變更經 onFilterChange 通知上層，由上層帶 query 參數重新呼叫 GET /kanban
 *    （issue 8.9 #44；不再於客端過濾，KPI / 分欄 / 計數一律以後端結果為準）。
 *  - 四欄看板：待辦 / 進行中 / 即將到期（含逾期）/ 已完成；逾期、即將到期、受連假遞延、待填表單以標記呈現。
 *  - 點任務卡 → 開啟案件詳情側欄；提供 onOpenCase 時側欄「前往案件詳情」帶 caseId 導向（與 8.12 銜接）。
 * 視覺對齊 prototype/index.html（view-board）。
 */
import { useState } from 'react';
import { EmptyState } from '../../components/AsyncStates';
import {
  ROLE_OPTIONS,
  UPCOMING_WINDOW_OPTIONS,
  mergeFlowOptions,
  type KanbanFilterState,
} from './board-view';
import { KANBAN_COLUMN_LABELS, type KanbanBoard, type KanbanCard, type KanbanColumn } from './types';

export interface TaskKanbanViewProps {
  board: KanbanBoard;
  /** 過濾器狀態（受控）。 */
  filter: KanbanFilterState;
  /** 過濾器變更（上層應重新向後端查詢）。 */
  onFilterChange: (next: KanbanFilterState) => void;
  /** 重新查詢中（保留現有看板、淡化呈現）。 */
  refreshing?: boolean;
  /** 點卡片「前往案件」時呼叫（提供 caseId）；未提供則僅顯示側欄詳情。 */
  onOpenCase?: (caseId: string) => void;
}

const FLOW_LABELS: Record<string, string> = {
  SALES: '銷售',
  ONBOARDING: '導入',
  ENVIRONMENT: '環境建置',
  CUSTOMIZATION: '客製化',
};

const STATUS_LABELS: Record<string, { label: string; pill: string }> = {
  PENDING: { label: '待辦', pill: 'p-grey' },
  IN_PROGRESS: { label: '進行中', pill: 'p-blue' },
  COMPLETED: { label: '已完成', pill: 'p-green' },
};

function kpiCard(label: string, value: number, cssColor: string, pct: number): JSX.Element {
  return (
    <div className="card kpi" key={label}>
      <div className="n" style={{ color: cssColor }}>
        {value}
      </div>
      <div className="l">{label}</div>
      <div className="bar">
        <i style={{ width: `${pct}%`, background: cssColor }} />
      </div>
    </div>
  );
}

export function TaskKanbanView({ board, filter, onFilterChange, refreshing, onOpenCase }: TaskKanbanViewProps): JSX.Element {
  const [selected, setSelected] = useState<KanbanCard | null>(null);
  const flowOptions = mergeFlowOptions(board);
  const upcomingWindow = filter.upcomingWithinDays ?? 3;
  const isEmpty = board.total === 0;
  const hasFilter = filter.role !== '' || filter.flowType !== '' || filter.onlyMine;

  return (
    <section style={refreshing ? { opacity: 0.6, transition: 'opacity .15s' } : undefined} aria-busy={refreshing}>
      <div className="grid-kpi">
        {kpiCard('待處理任務', board.kpi.pending, 'var(--brand)', 70)}
        {kpiCard(`即將到期（${upcomingWindow} 工作日內）`, board.kpi.upcoming, 'var(--amber)', 40)}
        {kpiCard('已逾期', board.kpi.overdue, 'var(--red)', board.kpi.overdue ? 60 : 6)}
        {kpiCard('受連假遞延', board.kpi.deferred, 'var(--purple)', 30)}
      </div>

      <div className="sec-title">
        📌 我的待辦（依到期排序）
        <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
          　點任務卡可開啟案件詳情
        </span>
      </div>

      <div className="row" style={{ marginBottom: 14, alignItems: 'center' }}>
        <label className="muted" style={{ fontSize: '12.5px' }}>
          角色：
          <select
            className="btn sm"
            value={filter.role}
            onChange={(e) => onFilterChange({ ...filter, role: e.target.value })}
            style={{ marginLeft: 4 }}
          >
            <option value="">全部</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="muted" style={{ fontSize: '12.5px' }}>
          流程：
          <select
            className="btn sm"
            value={filter.flowType}
            onChange={(e) => onFilterChange({ ...filter, flowType: e.target.value })}
            style={{ marginLeft: 4 }}
          >
            <option value="">全部</option>
            {flowOptions.map((f) => (
              <option key={f.code} value={f.code}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="muted" style={{ fontSize: '12.5px' }}>
          到期視窗：
          <select
            className="btn sm"
            value={String(upcomingWindow)}
            onChange={(e) => {
              const n = Number(e.target.value);
              onFilterChange({ ...filter, upcomingWithinDays: n === 3 ? null : n });
            }}
            style={{ marginLeft: 4 }}
          >
            {UPCOMING_WINDOW_OPTIONS.map((n) => (
              <option key={n} value={String(n)}>
                {n} 工作日{n === 3 ? '（預設）' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="muted" style={{ fontSize: '12.5px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={filter.onlyMine}
            onChange={(e) => onFilterChange({ ...filter, onlyMine: e.target.checked })}
            style={{ verticalAlign: 'middle', marginRight: 4 }}
          />
          僅看與我相關
        </label>
        <span className="muted" style={{ fontSize: 12 }}>
          共 {board.total} 張任務卡
        </span>
      </div>

      {isEmpty ? (
        <EmptyState message={hasFilter ? '目前過濾條件下沒有任務卡。' : '目前沒有任務卡。'}>
          {hasFilter && (
            <button
              className="btn sm"
              onClick={() => onFilterChange({ ...filter, role: '', flowType: '', onlyMine: false })}
            >
              清除過濾條件
            </button>
          )}
        </EmptyState>
      ) : (
        <div className="kanban">
          {board.order.map((col) => (
            <KanbanColumnView key={col} column={col} cards={board.columns[col]} onSelect={(c) => setSelected(c)} />
          ))}
        </div>
      )}

      <div className="legend">
        <span>🟦 進行中　🟩 已完成　🟧 即將到期　🟥 已逾期</span>
        <span>📄 待填表單　📅 受連假影響已自動遞延</span>
      </div>

      {selected && <CardDetailDrawer card={selected} onClose={() => setSelected(null)} onOpenCase={onOpenCase} />}
    </section>
  );
}

function KanbanColumnView({
  column,
  cards,
  onSelect,
}: {
  column: KanbanColumn;
  cards: KanbanCard[];
  onSelect: (c: KanbanCard) => void;
}): JSX.Element {
  return (
    <div className="col">
      <h3>
        {KANBAN_COLUMN_LABELS[column]}
        <span>{cards.length}</span>
      </h3>
      {cards.length === 0 && (
        <div className="muted" style={{ fontSize: 12, padding: 6 }}>
          無
        </div>
      )}
      {cards.map((c) => (
        <TaskCardView key={c.stepInstanceId} card={c} onSelect={onSelect} />
      ))}
    </div>
  );
}

function TaskCardView({ card, onSelect }: { card: KanbanCard; onSelect: (c: KanbanCard) => void }): JSX.Element {
  const status = STATUS_LABELS[card.status] ?? STATUS_LABELS.PENDING;
  const dueClass = card.overdue ? 'over' : card.dueSoon ? 'soon' : '';
  const roleLabel = ROLE_OPTIONS.find((r) => r.code === card.responsibleRoleCode)?.label ?? card.responsibleRoleCode;
  return (
    <div
      className="task"
      onClick={() => onSelect(card)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect(card);
      }}
    >
      <div className="t-top">
        <span className="t-name">{card.caseTitle ?? card.caseCode ?? card.caseId}</span>
        <span className={`pill ${status.pill}`}>{status.label}</span>
      </div>
      <div className="muted" style={{ fontSize: '11.5px' }}>
        {card.caseCode ?? card.caseId}
        {card.flowType ? ` · ${FLOW_LABELS[card.flowType] ?? card.flowType}流程` : ''}
        {card.stepName ? ` · ${card.stepName}` : ''}
      </div>
      {card.pendingRequiredForms > 0 && <div className="form-chip">📄 待填表單 {card.pendingRequiredForms} 份</div>}
      <div className="t-meta">
        {roleLabel && <span>👤 {roleLabel}</span>}
        {card.dueDate && (
          <span className={`due ${dueClass}`}>
            📅 {card.dueDate}
            {card.overdue ? '（逾期）' : card.dueSoon ? '（將到期）' : ''}
          </span>
        )}
      </div>
      {card.deferred && <div className="defer">📅 遇連假，系統已自動順延 {card.deferredDays} 天</div>}
    </div>
  );
}

function CardDetailDrawer({
  card,
  onClose,
  onOpenCase,
}: {
  card: KanbanCard;
  onClose: () => void;
  onOpenCase?: (caseId: string) => void;
}): JSX.Element {
  const status = STATUS_LABELS[card.status] ?? STATUS_LABELS.PENDING;
  const roleLabel = ROLE_OPTIONS.find((r) => r.code === card.responsibleRoleCode)?.label ?? card.responsibleRoleCode;
  const row = (k: string, v: string): JSX.Element => (
    <li key={k}>
      <span className="k">{k}</span>
      <span>{v}</span>
    </li>
  );
  return (
    <div className="modal-bg show" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <span className="x" onClick={onClose}>
          ×
        </span>
        <h3>{card.stepName ?? '（步驟）'}</h3>
        <div className="muted" style={{ marginBottom: 14, fontSize: '12.5px' }}>
          {card.caseTitle ?? card.caseCode ?? card.caseId}　<span className={`pill ${status.pill}`}>{status.label}</span>
        </div>
        <ul className="meta-list">
          {card.caseCode && row('案件編號', card.caseCode)}
          {card.clientName && row('客戶', card.clientName)}
          {card.flowType && row('流程', FLOW_LABELS[card.flowType] ?? card.flowType)}
          {roleLabel && row('負責角色', roleLabel)}
          {card.dueDate && row('到期日', card.dueDate)}
          {card.deferred && row('遞延', `遇假日遞延 ${card.deferredDays} 天`)}
          {card.pendingRequiredForms > 0 && row('待填表單', `${card.pendingRequiredForms} 份`)}
        </ul>
        <div style={{ textAlign: 'right', marginTop: 14 }}>
          <button className="btn" onClick={onClose}>
            關閉
          </button>{' '}
          {onOpenCase && (
            <button className="btn primary" onClick={() => onOpenCase(card.caseId)}>
              前往案件詳情
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
