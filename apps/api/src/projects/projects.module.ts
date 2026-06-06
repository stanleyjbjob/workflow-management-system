import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CalendarModule } from '../calendar/calendar.module';
import { ProjectService } from './project.service';
import { GanttService } from './gantt.service';
import { ExclusionService } from './exclusion.service';
import { DelayService } from './delay.service';

@Module({
  imports: [PrismaModule, CalendarModule],
  providers: [ProjectService, GanttService, DelayService, ExclusionService],
  exports: [ProjectService, GanttService, DelayService, ExclusionService],
})
export class ProjectsModule {}
