import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuthModule } from '../auth/auth.module';
import { IsoTrailService } from './iso-trail.service';
import { IsoTrailController } from './iso-trail.controller';

/**
 * ISO 27001 文件化軌跡模組（issue 6.2 / §11）。
 * 依賴：PrismaModule（資料）、RbacModule（AccessScopeService 可見範圍 + PermissionsGuard）、
 * AuthModule（SessionAuthGuard）。
 */
@Module({
  imports: [PrismaModule, RbacModule, AuthModule],
  controllers: [IsoTrailController],
  providers: [IsoTrailService],
  exports: [IsoTrailService],
})
export class IsoTrailModule {}
