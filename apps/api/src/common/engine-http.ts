import { BadRequestException, HttpException } from '@nestjs/common';

/**
 * 將領域引擎錯誤轉為 HTTP 400 的共用 guard（issue 8.1 #33）。
 *
 * 各流程引擎（SalesEngineError / OnboardingEngineError / EnvironmentEngineError /
 * CustomizationEngineError…）皆以「帶 snake_case `code` 的 Error」表達業務驗證失敗，
 * 沿用既有「guard()→HTTP 例外（保留 code 供前端判讀）」慣例，在 controller 層統一轉換：
 *
 * - 已是 HttpException（如 Service 丟出的 NotFoundException）→ 原樣重拋。
 * - Error 且 `code` 符合 snake_case（/^[a-z][a-z0-9_]*$/）→ 視為引擎業務錯誤，
 *   轉 BadRequestException({ code, message })。以樣式區分 Prisma 錯誤碼（P2002…），
 *   避免把基礎設施錯誤誤轉為 400。
 * - 其他 → 原樣重拋（由 Nest 預設轉 500）。
 */
const ENGINE_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

export async function guardEngine<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpException) throw err;
    const code = (err as { code?: unknown } | null)?.code;
    if (err instanceof Error && typeof code === 'string' && ENGINE_CODE_PATTERN.test(code)) {
      throw new BadRequestException({ code, message: err.message });
    }
    throw err;
  }
}
