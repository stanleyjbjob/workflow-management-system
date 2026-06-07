/**
 * 案件詳情/推進 呈現用型別（對應原型 view-case）。
 * REST 層就緒後改以 fetch 取得相同結構；目前以 seed 範例驅動 UI。
 */

export interface CaseStep {
  /** 步驟名稱 */
  name: string;
  /** 負責角色（顯示用） */
  role: string;
  /** 已完成 */
  done: boolean;
  /** 進行中（當前步驟） */
  active?: boolean;
  /** 應填表單 / 產出 */
  forms: string[];
  /** 步驟說明 */
  desc: string;
  /** 到期日（顯示用，可缺） */
  due?: string;
}

export interface CaseAttachment {
  kind: 'file' | 'link';
  name: string;
  meta: string;
}

export interface CaseRecord {
  id: string;
  title: string;
  meta: string;
  flowLabel: string;
  /** [標籤, pill 類別]，pill 類別對應全域 .pill.p-* */
  tags: [string, string][];
  steps: CaseStep[];
  attachments: CaseAttachment[];
}
