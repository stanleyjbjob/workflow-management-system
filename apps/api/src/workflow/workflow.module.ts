import { Module } from '@nestjs/common';
import { WorkflowDefinitionsController } from './workflow-definitions.controller';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { WorkflowService } from './workflow.service';

/**
 * 流程模組：
 * - WorkflowService：案件建立／推進／退回（引擎編排）。
 * - WorkflowDefinitionsService + Controller：流程定義 CRUD REST（issue 8.6 #41）。
 * PrismaModule 為全域模組，已提供 PrismaService，故此處毋須再匯入。
 */
@Module({
  controllers: [WorkflowDefinitionsController],
  providers: [WorkflowService, WorkflowDefinitionsService],
  exports: [WorkflowService, WorkflowDefinitionsService],
})
export class WorkflowModule {}
