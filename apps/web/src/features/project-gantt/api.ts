/**
 * 專案管理 REST 串接（issue 8.10 #45；後端 `/projects` 系列 18 端點，issue 8.1 #33）。
 *
 * - 型別為後端輸出之**前端鏡像**（與 types.ts GanttView 同策略：結構複製、解耦後端型別）。
 * - 查詢參數組裝（ganttQuery / delaysQuery / projectsQuery）為純函式，可被 vitest 測試。
 * - 寫入端點（POST/PATCH/DELETE）與 controller 一一對應；錯誤沿用 lib/api ApiError（{code,message}）。
 * - `toProjectGanttData` 將「專案表頭 + 後端 GanttView」組成 ProjectGanttView 所需的 ProjectGanttData。
 */
import { apiDelete, apiGet, apiPatch, apiPost, buildQuery } from '../../lib/api';
import type { GanttView, ProjectGanttData } from './types';

// ---- 後端資料形狀鏡像（Prisma Project / ProjectFlow / Exclusion 序列化後） ----

/** 專案狀態（schema.prisma ProjectStatus）。 */
export type ProjectStatusValue = 'ACTIVE' | 'COMPLETED' | 'ON_HOLD' | 'CANCELLED';

/** 流程型別（schema.prisma FlowType）。 */
export type FlowTypeValue = 'SALES' | 'ONBOARDING' | 'ENVIRONMENT' | 'CUSTOMIZATION';

/** 排除日來源（§9-5 定案：CUSTOMER / INTERNAL 兩值）。 */
export type ExclusionSourceValue = 'CUSTOMER' | 'INTERNAL';

/** `GET /projects` 清單項（include flows:{id,progress}）。 */
export interface ProjectSummary {
  id: string;
  code: string;
  name: string;
  client: string;
  ownerId: string;
  planStart: string;
  planEnd: string;
  status: ProjectStatusValue;
  flows: { id: string; progress: number }[];
}

/** 掛載流程（ProjectFlow）。 */
export interface ProjectFlowRecord {
  id: string;
  projectId: string;
  caseId: string | null;
  flowType: FlowTypeValue;
  name: string;
  planStart: string;
  planEnd: string;
  progress: number;
}

/** 排除日（Exclusion）。 */
export interface ExclusionRecord {
  id: string;
  projectId: string;
  fromDate: string;
  toDate: string;
  reason: string;
  source: ExclusionSourceValue | null;
}

/** `GET /projects/:id`（include flows / exclusions / owner）。 */
export interface ProjectRecord {
  id: string;
  code: string;
  name: string;
  client: string;
  ownerId: string;
  planStart: string;
  planEnd: string;
  status: ProjectStatusValue;
  flows: ProjectFlowRecord[];
  exclusions: ExclusionRecord[];
  owner: { id: string; displayName: string; email: string } | null;
}

/** 延遲清單單列（delay-engine DelayEvaluation 鏡像）。 */
export interface DelayRow {
  id: string | null;
  caseId: string | null;
  flowType: string | null;
  name: string | null;
  planStart: string;
  planEnd: string;
  expected: number;
  actual: number;
  deltaPercent: number;
  status: 'COMPLETED' | 'NOT_STARTED' | 'DELAYED' | 'AHEAD' | 'ON_TIME';
  thresholdUsed: number;
  basis: 'CALENDAR' | 'WORKDAY';
  durationDays: number;
  deltaDays: number;
  delayDays: number;
  aheadDays: number;
}

/** `GET /projects/:id/delays`（delay.service ProjectDelayReport 鏡像）。 */
export interface DelayReport {
  projectId: string;
  basis: 'CALENDAR' | 'WORKDAY';
  rows: DelayRow[];
  summary: {
    total: number;
    completedCount: number;
    notStartedCount: number;
    delayedCount: number;
    aheadCount: number;
    onTimeCount: number;
    maxDelayDays: number;
    maxAheadDays: number;
    netDeltaDays: number;
  };
}

/** `GET /projects/:id/exclusion-conflicts` 單列（exclusion-conflict FlowExclusionConflict 鏡像）。 */
export interface FlowConflict {
  flowId: string;
  name?: string | null;
  flowType?: string | null;
  planStart: string;
  planEnd: string;
  conflicts: {
    exclusionId?: string;
    fromDate: string;
    toDate: string;
    reason?: string | null;
    source?: string | null;
    overlapFrom: string;
    overlapTo: string;
    overlapCalendarDays: number;
  }[];
  overlapCalendarDays: number;
}

// ---- 寫入 payload（controller Body 鏡像） ----

/** 建立 / 編輯專案（ProjectDraftInput；建立時全欄位必填、編輯為部分更新）。 */
export interface ProjectDraftPayload {
  name?: string | null;
  client?: string | null;
  ownerId?: string | null;
  planStart?: string | null;
  planEnd?: string | null;
}

/** 掛載流程（FlowMountInput；caseId 與 flowType/name 擇一來源）。 */
export interface FlowMountPayload {
  caseId?: string | null;
  flowType?: FlowTypeValue | null;
  name?: string | null;
  planStart?: string | null;
  planEnd?: string | null;
  progress?: number | null;
}

/** 排除日（ExclusionDraftInput；編輯為部分更新）。 */
export interface ExclusionDraftPayload {
  fromDate?: string | null;
  toDate?: string | null;
  reason?: string | null;
  source?: ExclusionSourceValue | null;
}

// ---- 純函式（query 組裝 / 資料映射；vitest 可測） ----

/** ISO 日期字串 → YYYY-MM-DD（Prisma DateTime 序列化為完整 ISO；甘特表頭僅需日）。 */
export function isoDay(value: string): string {
  return value.length > 10 ? value.slice(0, 10) : value;
}

/** `GET /projects` 查詢參數。 */
export function projectsQuery(q: { status?: ProjectStatusValue | null; ownerId?: string | null } = {}): string {
  return buildQuery({ status: q.status, ownerId: q.ownerId });
}

/** `GET /projects/:id/gantt` 查詢參數（fresh=true 先回寫進度再算；§5.2）。 */
export function ganttQuery(q: { fresh?: boolean; now?: string | null; toleranceThreshold?: number | null } = {}): string {
  return buildQuery({
    fresh: q.fresh ? true : undefined,
    now: q.now,
    toleranceThreshold: q.toleranceThreshold,
  });
}

/** `GET /projects/:id/delays` 查詢參數（basis=CALENDAR|WORKDAY；§4.2–§4.4、§9-3）。 */
export function delaysQuery(
  q: { fresh?: boolean; now?: string | null; basis?: 'CALENDAR' | 'WORKDAY' | null; threshold?: number | null } = {},
): string {
  return buildQuery({
    fresh: q.fresh ? true : undefined,
    now: q.now,
    basis: q.basis,
    threshold: q.threshold,
  });
}

/** 清單項整體進度（各流程 progress 平均，四捨五入；無流程回 0）——與後端 KPI overallProgress 同義。 */
export function projectOverallProgress(p: Pick<ProjectSummary, 'flows'>): number {
  if (p.flows.length === 0) return 0;
  const sum = p.flows.reduce((acc, f) => acc + f.progress, 0);
  return Math.round(sum / p.flows.length);
}

/** 專案表頭 + 後端 GanttView → ProjectGanttView 之 ProjectGanttData。 */
export function toProjectGanttData(
  project: Pick<ProjectRecord, 'code' | 'name' | 'client' | 'planStart' | 'planEnd'>,
  view: GanttView,
): ProjectGanttData {
  return {
    project: {
      code: project.code,
      name: project.name,
      client: project.client,
      planStart: isoDay(project.planStart),
      planEnd: isoDay(project.planEnd),
    },
    view,
  };
}

// ---- fetch 包裝（與 controller 路由一一對應） ----

export function fetchProjects(q: { status?: ProjectStatusValue | null; ownerId?: string | null } = {}): Promise<ProjectSummary[]> {
  return apiGet<ProjectSummary[]>(`/projects${projectsQuery(q)}`);
}

export function fetchProject(id: string): Promise<ProjectRecord> {
  return apiGet<ProjectRecord>(`/projects/${encodeURIComponent(id)}`);
}

export function fetchProjectGantt(
  id: string,
  q: { fresh?: boolean; now?: string | null; toleranceThreshold?: number | null } = {},
): Promise<GanttView> {
  return apiGet<GanttView>(`/projects/${encodeURIComponent(id)}/gantt${ganttQuery(q)}`);
}

export function fetchProjectDelays(
  id: string,
  q: { fresh?: boolean; now?: string | null; basis?: 'CALENDAR' | 'WORKDAY' | null; threshold?: number | null } = {},
): Promise<DelayReport> {
  return apiGet<DelayReport>(`/projects/${encodeURIComponent(id)}/delays${delaysQuery(q)}`);
}

export function fetchExclusionConflicts(id: string, includeAllFlows = false): Promise<FlowConflict[]> {
  return apiGet<FlowConflict[]>(
    `/projects/${encodeURIComponent(id)}/exclusion-conflicts${buildQuery({ includeAllFlows: includeAllFlows ? true : undefined })}`,
  );
}

export function createProject(payload: ProjectDraftPayload): Promise<{ id: string; code: string }> {
  return apiPost<{ id: string; code: string }>('/projects', payload);
}

export function updateProject(id: string, payload: ProjectDraftPayload): Promise<{ id: string }> {
  return apiPatch<{ id: string }>(`/projects/${encodeURIComponent(id)}`, payload);
}

export function changeProjectStatus(id: string, status: ProjectStatusValue): Promise<{ id: string; status: ProjectStatusValue }> {
  return apiPatch<{ id: string; status: ProjectStatusValue }>(`/projects/${encodeURIComponent(id)}/status`, { status });
}

export function deleteProject(id: string): Promise<{ id: string }> {
  return apiDelete<{ id: string }>(`/projects/${encodeURIComponent(id)}`);
}

export function mountFlow(projectId: string, payload: FlowMountPayload): Promise<{ id: string }> {
  return apiPost<{ id: string }>(`/projects/${encodeURIComponent(projectId)}/flows`, payload);
}

export function updateFlowWindow(
  projectFlowId: string,
  payload: { planStart?: string; planEnd?: string; progress?: number },
): Promise<{ id: string }> {
  return apiPatch<{ id: string }>(`/projects/flows/${encodeURIComponent(projectFlowId)}`, payload);
}

export function unmountFlow(projectFlowId: string): Promise<{ id: string }> {
  return apiDelete<{ id: string }>(`/projects/flows/${encodeURIComponent(projectFlowId)}`);
}

export function refreshFlowProgress(projectFlowId: string): Promise<{ id: string; progress: number }> {
  return apiPost<{ id: string; progress: number }>(`/projects/flows/${encodeURIComponent(projectFlowId)}/refresh-progress`);
}

export function addExclusion(projectId: string, payload: ExclusionDraftPayload): Promise<{ id: string }> {
  return apiPost<{ id: string }>(`/projects/${encodeURIComponent(projectId)}/exclusions`, payload);
}

export function updateExclusion(exclusionId: string, payload: ExclusionDraftPayload): Promise<{ id: string }> {
  return apiPatch<{ id: string }>(`/projects/exclusions/${encodeURIComponent(exclusionId)}`, payload);
}

export function removeExclusion(exclusionId: string): Promise<{ id: string }> {
  return apiDelete<{ id: string }>(`/projects/exclusions/${encodeURIComponent(exclusionId)}`);
}
