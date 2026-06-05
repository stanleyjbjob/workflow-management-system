import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * 全域 PrismaModule，匯出 PrismaService 供各功能模組注入。
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
