import { Module } from '@nestjs/common';
import { WorkflowService } from './workflow.service';

/**
 * 流程引擎模組：提供 WorkflowService，供案件建立／推進／退回。
 * PrismaModule 為全域模組，已提供 PrismaService，故此處毋須再匯入。
 */
@Module({
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
