import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomizationService } from './customization.service';

@Module({
  imports: [PrismaModule],
  providers: [CustomizationService],
  exports: [CustomizationService],
})
export class CustomizationModule {}
