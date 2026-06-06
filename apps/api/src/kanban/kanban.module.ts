import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RbacModule } from '../rbac/rbac.module';
import { CalendarModule } from '../calendar/calendar.module';
import { KanbanService } from './kanban.service';

/**
 * 任務看板模組（issue 6.1 / §8）。
 * 依賴：PrismaModule（資料）、RbacModule（AccessScopeService 可見範圍）、CalendarModule（遞延計算）。
 */
@Module({
  imports: [PrismaModule, RbacModule, CalendarModule],
  providers: [KanbanService],
  exports: [KanbanService],
})
export class KanbanModule {}
