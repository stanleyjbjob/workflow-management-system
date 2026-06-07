import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SalesModule } from '../sales/sales.module';
import { CalendarModule } from '../calendar/calendar.module';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [PrismaModule, SalesModule, CalendarModule],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
