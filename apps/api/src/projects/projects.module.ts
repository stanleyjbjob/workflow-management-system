import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CalendarModule } from '../calendar/calendar.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuthModule } from '../auth/auth.module';
import { ProjectService } from './project.service';
import { GanttService } from './gantt.service';
import { ExclusionService } from './exclusion.service';
import { DelayService } from './delay.service';
import { ProjectsController } from './projects.controller';

/**
 * 專案管理模組（5.1~5.4 服務 + 8.1 REST controller）。
 * 依賴：PrismaModule（資料）、CalendarModule（行事曆遞延/工作日）、
 * RbacModule（PermissionsGuard）、AuthModule（SessionAuthGuard）。
 */
@Module({
  imports: [PrismaModule, CalendarModule, RbacModule, AuthModule],
  controllers: [ProjectsController],
  providers: [ProjectService, GanttService, DelayService, ExclusionService],
  exports: [ProjectService, GanttService, DelayService, ExclusionService],
})
export class ProjectsModule {}
