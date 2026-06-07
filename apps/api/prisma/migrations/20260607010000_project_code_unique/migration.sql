-- 補建 Project.code 的 UNIQUE 索引（schema 上已宣告 @unique，init migration 漏建）
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");
