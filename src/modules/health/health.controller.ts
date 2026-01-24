import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { HealthService, HealthCheckResult } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Full health check - فحص صحة النظام الكامل' })
  @ApiResponse({ status: 200, description: 'System health status' })
  async check(): Promise<HealthCheckResult> {
    return this.healthService.getHealth();
  }

  @Public()
  @Get('ping')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Simple ping - فحص سريع' })
  async ping() {
    return this.healthService.ping();
  }

  @Public()
  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe - للـ Kubernetes' })
  async liveness() {
    return this.healthService.getLiveness();
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe - للـ Kubernetes' })
  async readiness() {
    const result = await this.healthService.getReadiness();
    return result;
  }
}
