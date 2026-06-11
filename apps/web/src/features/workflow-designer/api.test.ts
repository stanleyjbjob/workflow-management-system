/**
 * REST 持久化層測試（issue 8.11 #46）。
 * 以假 WorkflowHttp 注入 createRestRepository，不碰 fetch／DOM；
 * 驗證 save 之 PATCH→404 回退 POST 策略、get 404 回 null、seedIfEmpty 行為。
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api';
import {
  createRestRepository,
  isForbidden,
  isNotFound,
  seedIfEmpty,
  workflowPath,
  WORKFLOWS_PATH,
  type WorkflowHttp,
} from './api';
import { createEmptyWorkflow } from './designer';
import type { WorkflowDraft } from './types';

interface Call {
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  body?: unknown;
}

function fakeHttp(handler: (call: Call) => unknown): { http: WorkflowHttp; calls: Call[] } {
  const calls: Call[] = [];
  const run = async <T>(call: Call): Promise<T> => {
    calls.push(call);
    const result = handler(call);
    if (result instanceof Error) throw result;
    return result as T;
  };
  return {
    calls,
    http: {
      get: <T>(path: string) => run<T>({ method: 'get', path }),
      post: <T>(path: string, body?: unknown) => run<T>({ method: 'post', path, body }),
      patch: <T>(path: string, body?: unknown) => run<T>({ method: 'patch', path, body }),
      delete: <T>(path: string) => run<T>({ method: 'delete', path }),
    },
  };
}

const notFound = (): ApiError => new ApiError(404, 'workflow_not_found', '查無流程定義');
const forbidden = (): ApiError => new ApiError(403, 'forbidden', '權限不足');

describe('workflowPath / 錯誤判斷', () => {
  it('組出單筆資源路徑並做 URL 編碼', () => {
    expect(workflowPath('wf-1')).toBe('/workflows/wf-1');
    expect(workflowPath('a/b c')).toBe('/workflows/a%2Fb%20c');
  });

  it('isNotFound / isForbidden 僅對對應 status 的 ApiError 成立', () => {
    expect(isNotFound(notFound())).toBe(true);
    expect(isNotFound(forbidden())).toBe(false);
    expect(isNotFound(new Error('404'))).toBe(false);
    expect(isForbidden(forbidden())).toBe(true);
    expect(isForbidden(notFound())).toBe(false);
  });
});

describe('createRestRepository', () => {
  it('list 走 GET /workflows', async () => {
    const { http, calls } = fakeHttp(() => []);
    await createRestRepository(http).list();
    expect(calls).toEqual([{ method: 'get', path: WORKFLOWS_PATH }]);
  });

  it('get 命中回草稿、404 回 null、其他錯誤照拋', async () => {
    const wf = createEmptyWorkflow();
    const hit = fakeHttp(() => wf);
    await expect(createRestRepository(hit.http).get(wf.id)).resolves.toEqual(wf);
    expect(hit.calls[0]).toEqual({ method: 'get', path: workflowPath(wf.id) });

    const miss = fakeHttp(() => notFound());
    await expect(createRestRepository(miss.http).get('nope')).resolves.toBeNull();

    const boom = fakeHttp(() => new ApiError(500, 'http_500', 'boom'));
    await expect(createRestRepository(boom.http).get('x')).rejects.toMatchObject({ status: 500 });
  });

  it('save 既有流程走 PATCH 全量儲存', async () => {
    const wf = createEmptyWorkflow();
    const { http, calls } = fakeHttp(() => wf);
    await createRestRepository(http).save(wf);
    expect(calls).toEqual([{ method: 'patch', path: workflowPath(wf.id), body: wf }]);
  });

  it('save 之 PATCH 404（新草稿）回退 POST 建立', async () => {
    const wf = createEmptyWorkflow();
    const { http, calls } = fakeHttp((call) => (call.method === 'patch' ? notFound() : wf));
    const saved = await createRestRepository(http).save(wf);
    expect(saved).toEqual(wf);
    expect(calls.map((c) => c.method)).toEqual(['patch', 'post']);
    expect(calls[1]).toEqual({ method: 'post', path: WORKFLOWS_PATH, body: wf });
  });

  it('save 之 PATCH 非 404 錯誤（如 403／400 驗證）不回退、照拋', async () => {
    const wf = createEmptyWorkflow();
    const { http, calls } = fakeHttp(() => forbidden());
    await expect(createRestRepository(http).save(wf)).rejects.toMatchObject({ status: 403 });
    expect(calls.map((c) => c.method)).toEqual(['patch']);
  });

  it('remove 走 DELETE 並回傳軟刪結果', async () => {
    const { http, calls } = fakeHttp(() => ({ deleted: false, deactivated: true }));
    const result = await createRestRepository(http).remove('wf-1');
    expect(result).toEqual({ deleted: false, deactivated: true });
    expect(calls).toEqual([{ method: 'delete', path: workflowPath('wf-1') }]);
  });
});

describe('seedIfEmpty', () => {
  const twoSeeds = (): WorkflowDraft[] => [createEmptyWorkflow('SALES'), createEmptyWorkflow('ONBOARDING')];

  it('列表非空時不動作', async () => {
    const { http, calls } = fakeHttp(() => [{ id: 'x' }]);
    const repo = createRestRepository(http);
    await expect(seedIfEmpty(repo, twoSeeds)).resolves.toBe(0);
    expect(calls.map((c) => c.method)).toEqual(['get']);
  });

  it('列表為空時逐筆建立種子', async () => {
    const { http, calls } = fakeHttp((call) => (call.method === 'get' && call.path === WORKFLOWS_PATH ? [] : createEmptyWorkflow()));
    const repo = createRestRepository(http);
    await expect(seedIfEmpty(repo, twoSeeds)).resolves.toBe(2);
    // get(list) + 每筆 save（PATCH 成功即一次呼叫）
    expect(calls.filter((c) => c.method === 'patch')).toHaveLength(2);
  });

  it('無寫入權限（403）時靜默停止、不外拋', async () => {
    const { http } = fakeHttp((call) => (call.method === 'get' && call.path === WORKFLOWS_PATH ? [] : forbidden()));
    const repo = createRestRepository(http);
    await expect(seedIfEmpty(repo, twoSeeds)).resolves.toBe(0);
  });

  it('其他錯誤（如 500）照拋', async () => {
    const { http } = fakeHttp((call) => (call.method === 'get' && call.path === WORKFLOWS_PATH ? [] : new ApiError(500, 'http_500', 'boom')));
    const repo = createRestRepository(http);
    await expect(seedIfEmpty(repo, twoSeeds)).rejects.toMatchObject({ status: 500 });
  });
});
