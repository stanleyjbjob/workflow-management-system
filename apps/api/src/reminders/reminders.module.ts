import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CalendarModule } from '../calendar/calendar.module';
import { ReminderService } from './reminder.service';
import { ReminderSchedulerService } from './reminder-scheduler.service';

/**
 * 提醒與通知模組（issue #22 / §8.3；issue #32 / 7.2 新增每日 SMTP 排程）。
 * imports CalendarModule 以取得行事曆遞延（連假/週末/專案排除日），使提醒時點隨到期日遞延同步調整。
 * ReminderSchedulerService：每日 cron 掃描逐案派送 + EMAIL(SMTP) dispatcher 註冊
 * （SMTP env 未設定時優雅降級僅 IN_APP；需 AppModule 掛 ScheduleModule.forRoot() 使 cron 生效）。
 */
@Module({
  imports: [PrismaModule, CalendarModule],
  providers: [ReminderService, ReminderSchedulerService],
  exports: [ReminderService, ReminderSchedulerService],
})
export class RemindersModule {}
