/**
 * 任務看板畫面（issue 6.1 / §8，對應原型「流程看板/待辦」）。
 *  - 上方 KPI：待處理 / 即將到期 / 逾期 / 遞延（prototype .grid-kpi 樣式）。
 *  - 過濾：角色（責任角色）、流程型別。
 *  - 四欄看板：待辦 / 進行中 / 即將到期（含逾期）/ 已完成；逾期、即將到期、受連假遞延、待填表單以標記呈現。
 *  - 點任務卡 → 開啟案件詳情側欄（提供 onOpenCase 時可導向案件詳情頁）。
 * 後端已完成分類與標示；本元件僅呈現與檢視層互動。資料未提供時使用 seed 範例。
 * 視覺對齊 prototype/index.html（view-board）。
 */
import { useMemo, useState } from 'react';
import { ROLE_OPTIONS, filterBoard, flowTypesIn } from './board-view';
import { sampleKanbanBoard } from './seed';
import { KANBAN_COLUMN_LABELS, type KanbanBoard, type KanbanCard, type KanbanColumn } from './types';

export interface TaskKanbanViewProps {
  board?: KanbanBoard;
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

export function TaskKanbanView({ board = sampleKanbanBoard, onOpenCase }: TaskKanbanViewProps): JSX.Element {
  const [role, setRole] = useState<string>('');
  const [flow, setFlow] = useState<string>('');
  const [selected, setSelected] = useState<KanbanCard | null>(null);

  const view = useMemo(
    () => filterBoard(board, { role: role || null, flowType: flow || null }),
    [board, role, flow],
  );
  const flowTypes = useMemo(() => flowTypesIn(board), [board]);

  return (
    <section>
      <div className="grid-kpi">
        {kpiCard('待處理任務', view.kpi.pending, 'var(--brand)', 70)}
        {kpiCard('即將到期（3 工作日內）', view.kpi.upcoming, 'var(--amber)', 40)}
        {kpiCard('已逾期', view.kpi.overdue, 'var(--red)', view.kpi.overdue ? 60 : 6)}
        {kpiCard('受連假遞延', view.kpi.deferred, 'var(--purple)', 30)}
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
          <select className="btn sm" value={role} onChange={(e) => setRole(e.target.value)} style={{ marginLeft: 4 }}>
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
          <select className="btn sm" value={flow} onChange={(e) => setFlow(e.target.value)} style={{ marginLeft: 4 }}>
            <option value="">全部</option>
            {flowTypes.map((f) => (
              <option key={f} value={f}>
                {FLOW_LABELS[f] ?? f}
              </option>
            ))}
          </select>
        </label>
        <span className="muted" style={{ fontSize: 12 }}>
          共 {view.total} 張任務卡
        </span>
      </div>

      <div className="kanban">
        {board.order.map((col) => (
          <KanbanColumnView key={col} column={col} cards={view.columns[col]} onSelect={(c) => setSelected(c)} />
        ))}
      </div>

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
          <button className="btn primary" onClick={() => onOpenCase?.(card.caseId)}>
            前往案件詳情
          </button>
        </div>
      </div>
    </div>
  );
}
