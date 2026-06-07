import { PrismaClient } from '@prisma/client';

/**
 * 整合測試共用設定（9.1）。
 *
 * 連線策略：使用 DATABASE_URL（必填）連到「可清空」的真實 Postgres。
 * 安全閥：若 URL 不含 localhost/127.0.0.1 且未設 INTEGRATION_ALLOW_REMOTE_DB=1，
 * 直接 fail-fast，避免誤對開發/正式庫 TRUNCATE。
 */
export function createTestPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'integration tests require DATABASE_URL (disposable Postgres, e.g. docker-compose or CI service)',
    );
  }
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  if (!isLocal && process.env.INTEGRATION_ALLOW_REMOTE_DB !== '1') {
    throw new Error(
      'refusing to run integration tests against non-local DATABASE_URL (set INTEGRATION_ALLOW_REMOTE_DB=1 to override)',
    );
  }
  return new PrismaClient({ datasources: { db: { url } } });
}

/**
 * 清空 public schema 下所有資料表（保留 schema 與 _prisma_migrations）。
 * 以單一 TRUNCATE ... CASCADE 處理 FK 相依，RESTART IDENTITY 重置序列。
 */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}
