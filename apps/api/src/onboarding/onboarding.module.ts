import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SalesModule } from '../sales/sales.module';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [PrismaModule, SalesModule],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
