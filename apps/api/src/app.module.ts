import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { FormsModule } from './forms/forms.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RbacModule } from './rbac/rbac.module';
import { WorkflowModule } from './workflow/workflow.module';

@Module({
  imports: [PrismaModule, AuthModule, RbacModule, WorkflowModule, FormsModule],
  controllers: [HealthController],
})
export class AppModule {}
