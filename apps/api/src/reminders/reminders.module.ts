import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CalendarModule } from '../calendar/calendar.module';
import { ReminderService } from './reminder.service';

/**
 * 提醒與通知模組（issue #22 / §8.3）。
 * imports CalendarModule 以取得行事曆遞延（連假/週末/專案排除日），使提醒時點隨到期日遞延同步調整。
 */
@Module({
  imports: [PrismaModule, CalendarModule],
  providers: [ReminderService],
  exports: [ReminderService],
})
export class RemindersModule {}
