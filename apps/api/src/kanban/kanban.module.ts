import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RbacModule } from '../rbac/rbac.module';
import { CalendarModule } from '../calendar/calendar.module';
import { AuthModule } from '../auth/auth.module';
import { KanbanService } from './kanban.service';
import { KanbanController } from './kanban.controller';

/**
 * 任務看板模組（issue 6.1 / §8）。
 * 依賴：PrismaModule（資料）、RbacModule（AccessScopeService 可見範圍 + PermissionsGuard）、
 * CalendarModule（遞延/工作日計算）、AuthModule（SessionAuthGuard）。
 */
@Module({
  imports: [PrismaModule, RbacModule, CalendarModule, AuthModule],
  controllers: [KanbanController],
  providers: [KanbanService],
  exports: [KanbanService],
})
export class KanbanModule {}
