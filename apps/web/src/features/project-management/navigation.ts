// 專案管理模組 — 純邏輯（無 React/DOM 相依，可純函式測試）
// 涵蓋：流程狀態計算（§4）、專案↔案件雙向導覽解析（§5.3 / issue 5.6 #28）、甘特圖幾何（§5.2）。
import type { CaseDetail, FlowStatus, Project, ProjectFlow } from './types';

export const ON_TIME_THRESHOLD = 8; // 容許門檻 T（百分點），§4.3 預設 ±8%

// 日期字串/物件 → 自 epoch 起的「天」序號（以 UTC 切齊，避免時區位移）
export function dayNum(date: string | Date): number {
  const t = typeof date === 'string' ? Date.parse(`${date}T00:00:00Z`) : date.getTime();
  return Math.floor(t / 86_400_000);
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

// 預期進度（§4.2）：線性時間推估，回傳 0-100
export function expectedProgress(flow: ProjectFlow, today: string | Date): number {
  const s = dayNum(flow.planStart);
  const e = dayNum(flow.planEnd);
  const t = dayNum(today);
  if (t <= s) return 0;
  if (t >= e) return 100;
  return clamp((t - s) / Math.max(1, e - s), 0, 1) * 100;
}

// 流程狀態（§4.3）：完成 / 未開始 / 延遲 / 超前 / 準時，附差異百分點
export function flowStatus(
  flow: ProjectFlow,
  today: string | Date,
  threshold = ON_TIME_THRESHOLD,
): FlowStatus {
  const s = dayNum(flow.planStart);
  const t = dayNum(today);
  if (flow.progress >= 100) return { kind: 'COMPLETED', label: '完成' };
  if (t < s) return { kind: 'NOT_STARTED', label: '未開始' };
  const delta = Math.round(flow.progress - expectedProgress(flow, today));
  if (delta < -threshold) return { kind: 'DELAYED', label: '延遲', deltaPct: delta };
  if (delta > threshold) return { kind: 'AHEAD', label: '超前', deltaPct: delta };
  return { kind: 'ON_TIME', label: '準時', deltaPct: delta };
}

// --- 雙向導覽（issue 5.6 / §5.3）------------------------------------------

// 流程是否可跳轉案件：需有 caseRef 且該案件存在
// （§5.3「無對應案件之流程不提供跳轉」）
export function canJumpToCase(
  flow: ProjectFlow,
  cases: Record<string, CaseDetail>,
): boolean {
  const ref = flow.caseRef;
  return ref != null && ref !== '' && Object.prototype.hasOwnProperty.call(cases, ref);
}

// 甘特圖流程列 → 對應案件詳情（不可跳轉時回傳 null）
export function resolveCaseFromFlow(
  flow: ProjectFlow,
  cases: Record<string, CaseDetail>,
): CaseDetail | null {
  if (!canJumpToCase(flow, cases)) return null;
  return cases[flow.caseRef as string];
}

// 案件詳情「所屬專案」→ 反向跳回專案（未指派或不存在時回傳 null）
export function resolveProjectFromCase(
  caseDetail: CaseDetail,
  projects: Record<string, Project>,
): Project | null {
  const pid = caseDetail.projectId;
  if (pid == null) return null;
  return Object.prototype.hasOwnProperty.call(projects, pid) ? projects[pid] : null;
}

// 反查：某案件目前掛載於哪些專案的哪一條流程（供一致性檢查 / 反向標示）
export function findFlowsReferencingCase(
  caseId: string,
  projects: Record<string, Project>,
): Array<{ project: Project; flow: ProjectFlow }> {
  const out: Array<{ project: Project; flow: ProjectFlow }> = [];
  for (const project of Object.values(projects)) {
    for (const flow of project.flows) {
      if (flow.caseRef === caseId) out.push({ project, flow });
    }
  }
  return out;
}

// --- 甘特圖幾何（§5.2）----------------------------------------------------
export interface GanttBar {
  flow: ProjectFlow;
  leftPct: number;
  widthPct: number;
  status: FlowStatus;
  jumpable: boolean;
}
export interface GanttBand {
  leftPct: number;
  widthPct: number;
  reason: string;
}
export interface GanttMonth {
  leftPct: number;
  label: string;
}
export interface GanttGeometry {
  bars: GanttBar[];
  bands: GanttBand[];
  months: GanttMonth[];
  todayLeftPct: number | null;
}

export function ganttGeometry(
  project: Project,
  today: string | Date,
  cases: Record<string, CaseDetail> = {},
): GanttGeometry {
  const min = dayNum(project.planStart);
  const max = dayNum(project.planEnd);
  const span = Math.max(1, max - min);
  const pct = (n: number): number => ((n - min) / span) * 100;

  const bars: GanttBar[] = project.flows.map((flow) => ({
    flow,
    leftPct: clamp(pct(dayNum(flow.planStart)), 0, 100),
    widthPct: clamp(((dayNum(flow.planEnd) - dayNum(flow.planStart)) / span) * 100, 0, 100),
    status: flowStatus(flow, today),
    jumpable: canJumpToCase(flow, cases),
  }));

  const bands: GanttBand[] = project.exclusions.map((x) => {
    const from = dayNum(x.from);
    const to = Math.max(dayNum(x.to), from);
    return {
      leftPct: clamp(pct(from), 0, 100),
      widthPct: clamp(((to - from + 1) / span) * 100, 0, 100),
      reason: x.reason,
    };
  });

  const months: GanttMonth[] = [];
  const cursor = new Date(Date.parse(`${project.planStart}T00:00:00Z`));
  cursor.setUTCDate(1);
  while (dayNum(cursor) <= max) {
    const p = pct(dayNum(cursor));
    if (p >= -2 && p <= 100) months.push({ leftPct: Math.max(0, p), label: `${cursor.getUTCMonth() + 1}月` });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const tnum = dayNum(today);
  const todayLeftPct = tnum >= min && tnum <= max ? pct(tnum) : null;

  return { bars, bands, months, todayLeftPct };
}

// 專案整體進度（§5.1 KPI）：各流程進度平均
export function overallProgress(project: Project): number {
  if (project.flows.length === 0) return 0;
  return Math.round(project.flows.reduce((a, f) => a + f.progress, 0) / project.flows.length);
}

export interface ProjectKpis {
  overall: number;
  delayed: number;
  ahead: number;
  exclusionRanges: number;
}

export function projectKpis(project: Project, today: string | Date): ProjectKpis {
  const statuses = project.flows.map((f) => flowStatus(f, today));
  return {
    overall: overallProgress(project),
    delayed: statuses.filter((s) => s.kind === 'DELAYED').length,
    ahead: statuses.filter((s) => s.kind === 'AHEAD').length,
    exclusionRanges: project.exclusions.length,
  };
}
