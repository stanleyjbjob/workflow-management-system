/**
 * 前端共用 REST client（issue 8.2 #34）。
 *
 * - `API_BASE` 由 `VITE_API_BASE_URL` 提供（預設 http://localhost:3000，與 App.tsx 健康檢查一致）。
 * - 一律帶 `credentials: 'include'`：後端以 session cookie 認證（SessionAuthGuard）。
 * - 後端錯誤慣例為 guard()→HTTP 例外、body 形如 `{ code, message }`（見 projects/kanban controller）；
 *   統一轉為 `ApiError` 保留 `status` 與 `code` 供前端判讀（401 未登入 / 403 權限不足…）。
 * - `buildQuery` / `toErrorBody` 為純函式（無 fetch/DOM 相依），可被 vitest 直接測試。
 * - 401 統一處理（issue 8.4 #39）：呼叫 `handleUnauthorized()`（預設導向 `GET /auth/login`），全站一致。
 */
import { handleUnauthorized } from './auth';
import { API_BASE } from './env';

export { API_BASE };

/** REST 錯誤（保留 HTTP status 與後端錯誤碼）。`status === 0` 表示連線失敗。 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type QueryValue = string | number | boolean | Date | null | undefined;

/** 將參數物件序列化為 query string：略過 null / undefined / 空字串；Date → ISO；`false` 照常輸出。 */
export function buildQuery(params: Record<string, QueryValue>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    const text = value instanceof Date ? value.toISOString() : String(value);
    if (text === '') continue;
    usp.set(key, text);
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

export interface ApiErrorBody {
  code: string;
  message: string;
}

function fallbackCode(status: number): string {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  return `http_${status}`;
}

/** 解析錯誤回應 body（容忍自訂 `{code,message}`、Nest 預設格式與非 JSON 文字）。 */
export function toErrorBody(status: number, raw: unknown): ApiErrorBody {
  if (raw != null && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const code = typeof obj.code === 'string' && obj.code !== '' ? obj.code : fallbackCode(status);
    let message = `HTTP ${status}`;
    if (typeof obj.message === 'string' && obj.message !== '') message = obj.message;
    else if (Array.isArray(obj.message)) message = obj.message.join('; ');
    return { code, message };
  }
  if (typeof raw === 'string' && raw !== '') return { code: fallbackCode(status), message: raw };
  return { code: fallbackCode(status), message: `HTTP ${status}` };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...init });
  } catch {
    throw new ApiError(0, 'network_error', '無法連線 API，請確認後端服務與網路狀態');
  }
  if (!res.ok) {
    let raw: unknown = null;
    try {
      const text = await res.text();
      try {
        raw = JSON.parse(text) as unknown;
      } catch {
        raw = text;
      }
    } catch {
      raw = null;
    }
    const body = toErrorBody(res.status, raw);
    if (res.status === 401) handleUnauthorized();
    throw new ApiError(res.status, body.code, body.message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** GET（query 請以 `buildQuery` 組好附在 path）。 */
export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

/** POST JSON。 */
export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** PATCH JSON。 */
export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** DELETE。 */
export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}
