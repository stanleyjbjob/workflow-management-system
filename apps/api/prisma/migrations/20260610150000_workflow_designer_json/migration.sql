-- issue 8.6 #41：WorkflowDefinition 增加 designer Json 欄位，
-- 保存流程設計器完整草稿（trigger / calendar / 步驟 forms+isoMapping 等設計層資訊），
-- 以滿足草稿 round-trip 不失真；正規化步驟仍寫入 StepDefinition 供案件引擎使用。
ALTER TABLE "WorkflowDefinition" ADD COLUMN "designer" JSONB;
