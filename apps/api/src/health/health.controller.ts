import { Controller, Get } from '@nestjs/common';

export interface HealthStatus {
  status: 'ok';
  service: string;
  timestamp: string;
}

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthStatus {
    return {
      status: 'ok',
      service: 'wfms-api',
      timestamp: new Date().toISOString(),
    };
  }
}
