/**
 * 任務看板示範資料（REST 層就緒前驅動 UI）。結構與後端 KanbanBoard 一致。
 * 基準日設定為 2026-06-07；涵蓋逾期 / 即將到期 / 進行中 / 待辦(含遞延) / 已完成等情境。
 */
import { KANBAN_COLUMN_ORDER, type KanbanBoard, type KanbanCard } from './types';

function card(c: Partial<KanbanCard> & Pick<KanbanCard, 'stepInstanceId' | 'caseId' | 'column'>): KanbanCard {
  return {
    caseCode: null,
    caseTitle: null,
    clientName: null,
    flowType: null,
    stepDefinitionId: null,
    stepName: null,
    stepOrder: null,
    status: 'PENDING',
    responsibleRoleId: null,
    responsibleRoleCode: null,
    assigneeId: null,
    dueDate: null,
    pendingRequiredForms: 0,
    isActive: true,
    dueState: 'NONE',
    daysUntilDue: null,
    workdaysUntilDue: null,
    dueSoon: false,
    overdue: false,
    deferred: false,
    deferredDays: 0,
    ...c,
  };
}

const cards: KanbanCard[] = [
  card({
    stepInstanceId: 'si-1', caseId: 'case-sales-1', caseCode: 'SALES-20260520-AB12', caseTitle: '宏全國際 ERP 商機',
    clientName: '宏全國際', flowType: 'SALES', stepName: '報價確認', stepOrder: 3, status: 'PENDING',
    responsibleRoleCode: 'SALES', assigneeId: 'u-sales', dueDate: '2026-06-03', column: 'UPCOMING',
    dueState: 'OVERDUE', daysUntilDue: -4, overdue: true, pendingRequiredForms: 1,
  }),
  card({
    stepInstanceId: 'si-2', caseId: 'case-onb-1', caseCode: 'ONBOARDING-20260601-CD34', caseTitle: '台鹽導入啟動',
    clientName: '台鹽', flowType: 'ONBOARDING', stepName: '委任權限表簽核', stepOrder: 2, status: 'IN_PROGRESS',
    responsibleRoleCode: 'CONSULTANT', assigneeId: 'u-consultant', dueDate: '2026-06-09', column: 'UPCOMING',
    dueState: 'UPCOMING', daysUntilDue: 2, workdaysUntilDue: 2, dueSoon: true,
  }),
  card({
    stepInstanceId: 'si-3', caseId: 'case-env-1', caseCode: 'ENVIRONMENT-20260528-EF56', caseTitle: '主機環境建置',
    clientName: '台鹽', flowType: 'ENVIRONMENT', stepName: '主機建置', stepOrder: 2, status: 'IN_PROGRESS',
    responsibleRoleCode: 'ENGINEER', assigneeId: 'u-eng', dueDate: '2026-06-22', column: 'IN_PROGRESS',
    dueState: 'NONE', daysUntilDue: 15, workdaysUntilDue: 11,
  }),
  card({
    stepInstanceId: 'si-4', caseId: 'case-cus-1', caseCode: 'CUSTOMIZATION-20260605-GH78', caseTitle: '報表客製需求',
    clientName: '宏全國際', flowType: 'CUSTOMIZATION', stepName: '開發任務指派', stepOrder: 2, status: 'PENDING',
    responsibleRoleCode: 'ENG_LEAD', assigneeId: 'u-lead', dueDate: null, column: 'TODO',
  }),
  card({
    stepInstanceId: 'si-5', caseId: 'case-cus-2', caseCode: 'CUSTOMIZATION-20260606-IJ90', caseTitle: '介面調整需求',
    clientName: '中油', flowType: 'CUSTOMIZATION', stepName: '需求變更單', stepOrder: 1, status: 'PENDING',
    responsibleRoleCode: 'CONSULTANT', assigneeId: 'u-consultant', dueDate: '2026-06-13', column: 'TODO',
    dueState: 'NONE', daysUntilDue: 6, workdaysUntilDue: 5, deferred: true, deferredDays: 2,
  }),
  card({
    stepInstanceId: 'si-6', caseId: 'case-sales-2', caseCode: 'SALES-20260410-KL11', caseTitle: '中油詢價成案',
    clientName: '中油', flowType: 'SALES', stepName: '成案移交', stepOrder: 5, status: 'COMPLETED',
    responsibleRoleCode: 'SALES', assigneeId: 'u-sales', dueDate: '2026-05-30', column: 'DONE',
    isActive: false,
  }),
];

function group(): KanbanBoard {
  const columns = { TODO: [], IN_PROGRESS: [], UPCOMING: [], DONE: [] } as KanbanBoard['columns'];
  for (const c of cards) columns[c.column].push(c);
  const active = cards.filter((c) => c.isActive);
  const kpi = {
    pending: active.length,
    upcoming: active.filter((c) => c.dueSoon).length,
    overdue: active.filter((c) => c.overdue).length,
    deferred: active.filter((c) => c.deferred).length,
  };
  return { order: KANBAN_COLUMN_ORDER, columns, kpi, total: cards.length, activeTotal: active.length };
}

export const sampleKanbanBoard: KanbanBoard = group();
