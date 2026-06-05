// 流程定義設計器 — 領域型別（前端草稿模型，對齊 WorkflowDefinition / StepDefinition / StepForm）
import type { DeferStrategy, FlowType, RoleCode } from './constants';

// 步驟上應填表單 / 應產出文件（對齊 StepForm + FormDefinition），
// 並帶 ISO 27001 文件化對應（需求 §11）。
export interface StepFormRef {
  id: string;
  name: string; // 表單 / 產出名稱，如「報價單」
  isRequired: boolean; // 對齊 StepForm.isRequired
  isoMapping: string; // 對應 ISO 27001 需求面向，可留空
}

// 步驟（對齊 StepDefinition）
export interface StepDraft {
  id: string;
  order: number; // 由 1 起遞增，連續
  name: string;
  description: string;
  responsibleRole: RoleCode | null; // 對齊 StepDefinition.responsibleRoleId（以角色碼表示）
  isOptional: boolean; // 對齊 StepDefinition.isOptional
  forms: StepFormRef[]; // 應填表單 / 應產出
}

// 流程觸發條件（需求 §12-1，先以彈性欄位保留）
export interface TriggerRule {
  initiatorRole: RoleCode | null; // 由哪個角色發起
  condition: string; // 觸發條件說明（如「銷售成案後」）
}

// 行事曆規則（需求 §8.3）
export interface CalendarRule {
  deferOnHoliday: boolean; // 遇國定假日 / 連假是否自動遞延
  deferStrategy: DeferStrategy;
  note: string;
}

// 流程定義（對齊 WorkflowDefinition）
export interface WorkflowDraft {
  id: string;
  flowType: FlowType;
  name: string;
  description: string;
  version: number; // 對齊 WorkflowDefinition.version
  isActive: boolean; // 對齊 WorkflowDefinition.isActive
  trigger: TriggerRule;
  calendar: CalendarRule;
  steps: StepDraft[];
  updatedAt: string; // ISO 字串
}
