import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { CalendarModule } from './calendar/calendar.module';
import { CasesModule } from './cases/cases.module';
import { CustomizationModule } from './customization/customization.module';
import { EnvironmentModule } from './environment/environment.module';
import { FormsModule } from './forms/forms.module';
import { HealthController } from './health/health.controller';
import { IsoTrailModule } from './iso-trail/iso-trail.module';
import { KanbanModule } from './kanban/kanban.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { RbacModule } from './rbac/rbac.module';
import { RemindersModule } from './reminders/reminders.module';
import { SalesModule } from './sales/sales.module';
import { TemplatesModule } from './templates/templates.module';
import { WorkflowModule } from './workflow/workflow.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    RbacModule,
    WorkflowModule,
    CasesModule,
    FormsModule,
    TemplatesModule,
    AttachmentsModule,
    SalesModule,
    OnboardingModule,
    EnvironmentModule,
    CustomizationModule,
    CalendarModule,
    RemindersModule,
    ProjectsModule,
    KanbanModule,
    IsoTrailModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
