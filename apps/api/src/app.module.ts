import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { FormsModule } from './forms/forms.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RbacModule } from './rbac/rbac.module';
import { TemplatesModule } from './templates/templates.module';
import { WorkflowModule } from './workflow/workflow.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    RbacModule,
    WorkflowModule,
    FormsModule,
    TemplatesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
