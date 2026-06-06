import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SalesService } from './sales.service';

@Module({
  imports: [PrismaModule],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
