import { Module } from '@nestjs/common';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { CustomizationModule } from './customization/customization.module';
import { EnvironmentModule } from './environment/environment.module';
import { FormsModule } from './forms/forms.module';
import { HealthController } from './health/health.controller';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PrismaModule } from './prisma/prisma.module';
import { RbacModule } from './rbac/rbac.module';
import { SalesModule } from './sales/sales.module';
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
    AttachmentsModule,
    SalesModule,
    OnboardingModule,
    EnvironmentModule,
    CustomizationModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
