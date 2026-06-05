import { Module } from '@nestjs/common';
import { AuthConfigService } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EntraClient } from './entra.client';
import { SessionAuthGuard } from './session-auth.guard';

/**
 * 認證模組：Microsoft 365 / Entra ID SSO。
 * PrismaService 由全域 PrismaModule 提供。
 */
@Module({
  controllers: [AuthController],
  providers: [AuthConfigService, EntraClient, AuthService, SessionAuthGuard],
  exports: [AuthService, AuthConfigService, SessionAuthGuard],
})
export class AuthModule {}
