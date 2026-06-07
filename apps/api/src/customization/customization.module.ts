import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { CustomizationController } from './customization.controller';
import { CustomizationService } from './customization.service';

@Module({
  imports: [PrismaModule, RbacModule, AuthModule],
  controllers: [CustomizationController],
  providers: [CustomizationService],
  exports: [CustomizationService],
})
export class CustomizationModule {}
