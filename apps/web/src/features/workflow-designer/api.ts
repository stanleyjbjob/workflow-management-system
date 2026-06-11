/**
 * 流程定義設計器 — REST 持久化（issue 8.11 #46；後端 `/workflows` CRUD，issue 8.6 #41）。
 *
 * 取代 localStorage 成為設計器的主要持久化層：儲存的流程定義持久化於 DB，
 * 重整／換裝置仍在，並可套用於新案件（後端同步重建 StepDefinition 正規列）。
 *
 * 設計：
 * - `AsyncWorkflowRepository`：`storage.ts` 之 `WorkflowRepository` 的 Promise 版介面
 *   （REST 本質非同步，無法沿用同步介面；UI 改以載入／錯誤狀態呈現，見 WorkflowDesigner.tsx）。
 * - `createRestRepository(http)`：以可注入的 `WorkflowHttp` 建構，純邏輯可被 vitest 直接測試；
 *   預設注入 `lib/api` 共用 client（VITE_API_BASE_URL、credentials、401 統一導向）。
 * - save 策略：先 `PATCH /workflows/:id`（全量儲存），404（尚未存在，如「＋ 新增流程」
 *   產生的本機草稿）時回退 `POST /workflows` 建立——與後端「客戶端 id 直接作為 DB id」對齊。
 * - `seedIfEmpty`：首次使用（DB 尚無任何流程定義）時，將四大標準流程種子逐筆建立，
 *   供主管直接調整（沿用 localStorage 時代的行為）；無 `workflow:manage` 權限（403）時
 *   靜默略過——一般使用者僅瀏覽，不應因種子寫入失敗而中斷頁面。
 */
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api';
import type { WorkflowSummary } from './designer';
import { seedWorkflows } from './seed';
import type { WorkflowDraft } from './types';

/** 後端刪除結果：被案件引用時不實刪、改停用（軟刪保護，見 8.6 #41）。 */
export interface DeleteWorkflowResult {
  deleted: boolean;
  deactivated: boolean;
}

/** `storage.ts` WorkflowRepository 的非同步（REST）版介面。 */
export interface AsyncWorkflowRepository {
  list(): Promise<WorkflowSummary[]>;
  get(id: string): Promise<WorkflowDraft | null>;
  save(wf: WorkflowDraft): Promise<WorkflowDraft>;
  remove(id: string): Promise<DeleteWorkflowResult>;
}

export const WORKFLOWS_PATH = '/workflows';

/** 單筆資源路徑（id 經 URL 編碼，純函式）。 */
export function workflowPath(id: string): string {
  return `${WORKFLOWS_PATH}/${encodeURIComponent(id)}`;
}

/** 是否為 404（PATCH 回退 POST、get 回 null 的判斷依據，純函式）。 */
export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/** 是否為 403（種子寫入靜默略過的判斷依據，純函式）。 */
export function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

/** 可注入的 HTTP 介面（測試以假物件替代，不碰 fetch）。 */
export interface WorkflowHttp {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

const defaultHttp: WorkflowHttp = {
  get: apiGet,
  post: apiPost,
  patch: apiPatch,
  delete: apiDelete,
};

/** 建構 REST 版 repository（http 可注入以利測試）。 */
export function createRestRepository(http: WorkflowHttp = defaultHttp): AsyncWorkflowRepository {
  return {
    async list(): Promise<WorkflowSummary[]> {
      return http.get<WorkflowSummary[]>(WORKFLOWS_PATH);
    },
    async get(id: string): Promise<WorkflowDraft | null> {
      try {
        return await http.get<WorkflowDraft>(workflowPath(id));
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async save(wf: WorkflowDraft): Promise<WorkflowDraft> {
      try {
        return await http.patch<WorkflowDraft>(workflowPath(wf.id), wf);
      } catch (err) {
        if (isNotFound(err)) return http.post<WorkflowDraft>(WORKFLOWS_PATH, wf);
        throw err;
      }
    },
    async remove(id: string): Promise<DeleteWorkflowResult> {
      return http.delete<DeleteWorkflowResult>(workflowPath(id));
    },
  };
}

/** 預設（生產）repository：經 8.4 共用 client 連後端。 */
export const restRepository: AsyncWorkflowRepository = createRestRepository();

/**
 * DB 尚無任何流程定義時載入四大標準流程種子；回傳實際建立筆數。
 * - 列表非空 → 不動作（回 0）。
 * - 無寫入權限（403）→ 靜默停止（一般使用者僅瀏覽）。
 * - 其他錯誤照拋（網路／伺服器問題應浮現給 UI）。
 */
export async function seedIfEmpty(
  repo: AsyncWorkflowRepository,
  seeds: () => WorkflowDraft[] = seedWorkflows,
): Promise<number> {
  const existing = await repo.list();
  if (existing.length > 0) return 0;
  let created = 0;
  for (const wf of seeds()) {
    try {
      await repo.save(wf);
      created += 1;
    } catch (err) {
      if (isForbidden(err)) return created;
      throw err;
    }
  }
  return created;
}
