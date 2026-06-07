/**
 * 整合測試（9.1）jest 設定：對「真實 Postgres」驗證 *.service.ts 的 DB 行為。
 *
 * - 測試檔命名 `*.int-spec.ts`，與單元測試（`*.spec.ts`，rootDir=src）分流；
 *   預設 `pnpm test` 不會撈到整合測試，CI 由獨立 job 啟動 DB 後執行。
 * - 需要環境變數 DATABASE_URL 指向可清空的測試資料庫
 *   （CI: postgres service；本機: docker-compose 之 wfms DB 或任一拋棄式 DB）。
 * - runInBand／maxWorkers=1：測試間以 TRUNCATE 清庫，不可平行。
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/integration/.*\\.int-spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  maxWorkers: 1,
  testTimeout: 30000,
};
