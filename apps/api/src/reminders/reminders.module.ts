import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CalendarModule } from '../calendar/calendar.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuthModule } from '../auth/auth.module';
import { ReminderService } from './reminder.service';
import { ReminderSchedulerService } from './reminder-scheduler.service';
import { RemindersController } from './reminders.controller';

/**
 * 提醒與通知模組（issue #22 / §8.3；issue #32 / 7.2 新增每日 SMTP 排程；issue #33 / 8.1 REST）。
 * imports CalendarModule 以取得行事曆遞延（連假/週末/專案排除日），使提醒時點隨到期日遞延同步調整。
 * ReminderSchedulerService：每日 cron 掃描逐案派送 + EMAIL(SMTP) dispatcher 註冊
 * （SMTP env 未設定時優雅降級僅 IN_APP；需 AppModule 掛 ScheduleModule.forRoot() 使 cron 生效）。
 * RemindersController（8.1）：收件匣／預覽／手動派送／sweep REST 端點；
 * imports RbacModule + AuthModule 供守衛依賴。
 */
@Module({
  imports: [PrismaModule, CalendarModule, RbacModule, AuthModule],
  controllers: [RemindersController],
  providers: [ReminderService, ReminderSchedulerService],
  exports: [ReminderService, ReminderSchedulerService],
})
export class RemindersModule {}
