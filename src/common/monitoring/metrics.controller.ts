/**
 * Ali Backend - Metrics Controller
 * API للحصول على المقاييس
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MonitoringService, SystemMetrics, RequestMetrics, EndpointMetrics } from './monitoring.service';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../modules/auth/guards/roles.guard';
import { Roles } from '../../modules/auth/decorators/roles.decorator';
import { Public } from '../../modules/auth/decorators/public.decorator';

@ApiTags('monitoring')
@Controller('monitoring')
export class MetricsController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('health')
  @Public()
  @ApiOperation({ summary: 'Basic health check' })
  healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  @Get('metrics')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get all system metrics (Admin only)' })
  async getMetrics() {
    return this.monitoring.getAllMetrics();
  }

  @Get('metrics/system')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get system metrics (Admin only)' })
  getSystemMetrics() {
    return this.monitoring.getSystemMetrics();
  }

  @Get('metrics/requests')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get request metrics (Admin only)' })
  async getRequestMetrics() {
    return this.monitoring.getRequestMetrics();
  }

  @Get('metrics/endpoints')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get endpoint metrics (Admin only)' })
  async getEndpointMetrics() {
    return this.monitoring.getEndpointMetrics();
  }
}
