import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectService } from './project.service';
import { GanttService } from './gantt.service';

@Module({
  imports: [PrismaModule],
  providers: [ProjectService, GanttService],
  exports: [ProjectService, GanttService],
})
export class ProjectsModule {}
