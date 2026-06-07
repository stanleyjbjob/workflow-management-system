import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuthModule } from '../auth/auth.module';
import { CalendarService } from './calendar.service';
import { CalendarController } from './calendar.controller';

/**
 * 行事曆模組（4.1/7.1 服務 + 8.1 REST controller）。
 * imports RbacModule（PermissionsGuard）+ AuthModule（SessionAuthGuard）供 controller 守衛依賴。
 */
@Module({
  imports: [PrismaModule, RbacModule, AuthModule],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
