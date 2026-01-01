/**
 * Ali Backend - Monitoring Module
 * وحدة المراقبة والتسجيل
 */
import { Module, Global } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { MetricsController } from './metrics.controller';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { PerformanceInterceptor } from './interceptors/performance.interceptor';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MonitoringService,
    LoggingInterceptor,
    PerformanceInterceptor,
  ],
  exports: [
    MonitoringService,
    LoggingInterceptor,
    PerformanceInterceptor,
  ],
})
export class MonitoringModule {}
