// 專案管理模組 — 領域型別（對齊 docs/專案管理模組規格.md §3）
export type ProjectStatus = 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD' | 'CANCELLED';
export type FlowType = 'SALES' | 'ONBOARDING' | 'ENVIRONMENT' | 'CUSTOMIZATION';
export type FlowStatusKind = 'COMPLETED' | 'NOT_STARTED' | 'DELAYED' | 'AHEAD' | 'ON_TIME';

// 專案行事曆排除日（§3.3）
export interface Exclusion {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD（含當日）
  reason: string;
  source?: 'CLIENT' | 'INTERNAL';
}

// 專案下的流程掛載（§3.2）
export interface ProjectFlow {
  flowId: string;
  flowType: FlowType;
  name: string;
  planStart: string;
  planEnd: string;
  progress: number; // 0-100，實際完成比例
  caseRef?: string | null; // 對應案件詳情 ID；無則不提供跳轉（§5.3）
}

// 專案（§3.1）
export interface Project {
  id: string;
  name: string;
  client: string;
  owner: string;
  planStart: string;
  planEnd: string;
  status: ProjectStatus;
  flows: ProjectFlow[];
  exclusions: Exclusion[];
}

// 案件詳情（流程實例）—— 雙向導覽之目標畫面
export interface CaseStep {
  name: string;
  role: string;
  done: boolean;
  active?: boolean;
  forms: string[];
  description: string;
}

export interface CaseDetail {
  id: string;
  projectId: string | null; // 所屬專案；null = 未指派專案
  title: string;
  meta: string;
  flowLabel: string;
  tags: string[];
  steps: CaseStep[];
}

export interface FlowStatus {
  kind: FlowStatusKind;
  label: string;
  deltaPct?: number; // 延遲/超前的百分點（負=落後預期）
}
