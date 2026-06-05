import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RbacModule } from './rbac/rbac.module';

@Module({
  imports: [PrismaModule, AuthModule, RbacModule],
  controllers: [HealthController],
})
export class AppModule {}
