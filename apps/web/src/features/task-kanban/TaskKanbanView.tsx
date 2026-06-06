/**
 * 任務看板畫面（issue 6.1 / §8，對應原型「流程看板/待辦」）。
 *  - 上方 KPI：待處理 / 即將到期 / 逾期 / 遞延。
 *  - 過濾：角色（責任角色）、流程型別。
 *  - 四欄看板：待辦 / 進行中 / 即將到期（含逾期）/ 已完成；逾期、即將到期、受連假遞延、待填表單以標記呈現。
 *  - 點任務卡 → 開啟案件詳情（側欄；提供 onOpenCase 時可導向實際案件頁）。
 * 後端已完成分類與標示；本元件僅呈現與檢視層互動。資料未提供時使用 seed 範例。
 */
import { useMemo, useState } from 'react';
import {
  COLUMN_ACCENT,
  ROLE_OPTIONS,
  cardBadges,
  filterBoard,
  flowTypesIn,
} from './board-view';
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

function kpiCard(label: string, value: number, color: string): JSX.Element {
  return (
    <div
      key={label}
      style={{
        flex: 1,
        minWidth: 110,
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        padding: '0.6rem 0.9rem',
        background: '#fff',
      }}
    >
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{label}</div>
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

  const selectStyle: React.CSSProperties = {
    padding: '0.35rem 0.5rem',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    fontSize: '0.9rem',
    background: '#fff',
  };

  return (
    <section>
      <h2 style={{ margin: '0 0 0.75rem' }}>任務看板</h2>

      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {kpiCard('待處理', view.kpi.pending, '#0f172a')}
        {kpiCard('即將到期', view.kpi.upcoming, '#d97706')}
        {kpiCard('逾期', view.kpi.overdue, '#dc2626')}
        {kpiCard('遞延', view.kpi.deferred, '#7c3aed')}
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '0.85rem', color: '#475569' }}>
          角色：
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ ...selectStyle, marginLeft: 4 }}>
            <option value="">全部</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: '0.85rem', color: '#475569' }}>
          流程：
          <select value={flow} onChange={(e) => setFlow(e.target.value)} style={{ ...selectStyle, marginLeft: 4 }}>
            <option value="">全部</option>
            {flowTypes.map((f) => (
              <option key={f} value={f}>{FLOW_LABELS[f] ?? f}</option>
            ))}
          </select>
        </label>
        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>共 {view.total} 張任務卡</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', alignItems: 'start' }}>
        {board.order.map((col) => (
          <KanbanColumnView
            key={col}
            column={col}
            cards={view.columns[col]}
            onSelect={(c) => setSelected(c)}
          />
        ))}
      </div>

      {selected && (
        <CardDetailDrawer
          card={selected}
          onClose={() => setSelected(null)}
          onOpenCase={onOpenCase}
        />
      )}
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
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.5rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0.25rem 0.4rem 0.5rem',
          borderBottom: `2px solid ${COLUMN_ACCENT[column]}`,
          marginBottom: '0.5rem',
        }}
      >
        <strong style={{ color: COLUMN_ACCENT[column], fontSize: '0.92rem' }}>{KANBAN_COLUMN_LABELS[column]}</strong>
        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{cards.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {cards.length === 0 && <div style={{ fontSize: '0.8rem', color: '#cbd5e1', padding: '0.5rem' }}>無任務</div>}
        {cards.map((c) => (
          <TaskCardView key={c.stepInstanceId} card={c} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function TaskCardView({ card, onSelect }: { card: KanbanCard; onSelect: (c: KanbanCard) => void }): JSX.Element {
  const badges = cardBadges(card);
  return (
    <button
      type="button"
      onClick={() => onSelect(card)}
      style={{
        textAlign: 'left',
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderLeft: card.overdue ? '3px solid #dc2626' : card.dueSoon ? '3px solid #d97706' : '3px solid #cbd5e1',
        borderRadius: 6,
        padding: '0.5rem 0.6rem',
        cursor: 'pointer',
        fontSize: '0.85rem',
      }}
    >
      <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 2 }}>{card.stepName ?? '（步驟）'}</div>
      <div style={{ color: '#475569', fontSize: '0.8rem' }}>
        {card.caseTitle ?? card.caseCode ?? card.caseId}
        {card.clientName ? ` · ${card.clientName}` : ''}
      </div>
      {card.dueDate && (
        <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: 2 }}>到期 {card.dueDate}</div>
      )}
      {badges.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
          {badges.map((b) => (
            <span
              key={b.kind}
              style={{ fontSize: '0.7rem', color: b.color, background: b.bg, borderRadius: 4, padding: '1px 6px' }}
            >
              {b.label}
            </span>
          ))}
        </div>
      )}
    </button>
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
  const row = (label: string, value: string): JSX.Element => (
    <div style={{ display: 'flex', gap: 8, padding: '0.2rem 0' }}>
      <span style={{ width: 88, color: '#94a3b8', fontSize: '0.8rem' }}>{label}</span>
      <span style={{ fontSize: '0.85rem', color: '#0f172a' }}>{value}</span>
    </div>
  );
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', display: 'flex', justifyContent: 'flex-end', zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 360, maxWidth: '90vw', background: '#fff', height: '100%', padding: '1.25rem', boxShadow: '-4px 0 16px rgba(0,0,0,0.1)', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <strong style={{ fontSize: '1rem' }}>任務詳情</strong>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#64748b' }}>×</button>
        </div>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>{card.stepName ?? '（步驟）'}</h3>
        {row('案件', card.caseTitle ?? card.caseCode ?? card.caseId)}
        {card.caseCode && row('案件編號', card.caseCode)}
        {card.clientName && row('客戶', card.clientName)}
        {card.flowType && row('流程', FLOW_LABELS[card.flowType] ?? card.flowType)}
        {card.responsibleRoleCode && row('負責角色', card.responsibleRoleCode)}
        {card.dueDate && row('到期日', card.dueDate)}
        {card.deferred && row('遞延', `遇假日遞延 ${card.deferredDays} 天`)}
        {card.pendingRequiredForms > 0 && row('待填表單', String(card.pendingRequiredForms))}
        <button
          type="button"
          onClick={() => onOpenCase?.(card.caseId)}
          style={{
            marginTop: '1rem',
            width: '100%',
            padding: '0.5rem',
            border: 'none',
            borderRadius: 6,
            background: '#2563eb',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '0.9rem',
          }}
        >
          前往案件詳情
        </button>
      </div>
    </div>
  );
}
