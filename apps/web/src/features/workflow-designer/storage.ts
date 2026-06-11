// 流程定義設計器 — localStorage 持久化（自 8.11 #46 起降級為備援）
//
// 主要持久化已改接後端 `/workflows` REST（見 api.ts，issue 8.11 #46）；
// 本檔保留 localStorage 實作作為同步介面之參考實作與既有測試之依據，
// 未接入生產 UI。離線草稿暫存（issue 列為可選）若日後需要，可在 api.ts
// 失敗路徑掛回本 repository。
import { reindex, summarize, touch } from './designer';
import type { WorkflowSummary } from './designer';
import type { WorkflowDraft } from './types';
import { seedWorkflows } from './seed';

const STORAGE_KEY = 'wfms.workflow-definitions.v1';
const SEEDED_KEY = 'wfms.workflow-definitions.seeded.v1';

export interface WorkflowRepository {
  list(): WorkflowSummary[];
  get(id: string): WorkflowDraft | null;
  save(wf: WorkflowDraft): WorkflowDraft;
  remove(id: string): void;
}

function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

function readAll(): WorkflowDraft[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WorkflowDraft[];
    return Array.isArray(parsed) ? parsed.map((w) => ({ ...w, steps: reindex(w.steps) })) : [];
  } catch {
    return [];
  }
}

function writeAll(list: WorkflowDraft[]): void {
  if (!hasStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

// 首次使用時載入四大標準流程，供主管直接調整（保留彈性）。
function ensureSeeded(): void {
  if (!hasStorage()) return;
  if (window.localStorage.getItem(SEEDED_KEY)) return;
  const existing = readAll();
  if (existing.length === 0) writeAll(seedWorkflows());
  window.localStorage.setItem(SEEDED_KEY, '1');
}

export const localStorageRepository: WorkflowRepository = {
  list(): WorkflowSummary[] {
    ensureSeeded();
    return readAll()
      .map(summarize)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  get(id: string): WorkflowDraft | null {
    ensureSeeded();
    return readAll().find((w) => w.id === id) ?? null;
  },
  save(wf: WorkflowDraft): WorkflowDraft {
    const stamped = touch(wf);
    const list = readAll();
    const idx = list.findIndex((w) => w.id === stamped.id);
    if (idx >= 0) list[idx] = stamped;
    else list.push(stamped);
    writeAll(list);
    return stamped;
  },
  remove(id: string): void {
    writeAll(readAll().filter((w) => w.id !== id));
  },
};
