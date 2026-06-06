import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectService } from './project.service';

@Module({
  imports: [PrismaModule],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectsModule {}
