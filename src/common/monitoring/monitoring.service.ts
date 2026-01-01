/**
 * Ali Backend - Monitoring Service
 * خدمة المراقبة والإحصائيات
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import * as os from 'os';

export interface SystemMetrics {
  cpu: {
    usage: number;
    cores: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  uptime: number;
  processUptime: number;
}

export interface RequestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  requestsPerMinute: number;
}

export interface EndpointMetrics {
  path: string;
  method: string;
  count: number;
  avgDuration: number;
  errors: number;
}

@Injectable()
export class MonitoringService implements OnModuleInit {
  private readonly logger = new Logger(MonitoringService.name);
  private startTime = Date.now();
  
  // In-memory metrics
  private requestCounts = new Map<string, number>();
  private responseTimes: number[] = [];
  private errorCounts = new Map<string, number>();
  private endpointStats = new Map<string, { count: number; totalDuration: number; errors: number }>();

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    // Log startup
    this.logger.log('📊 Monitoring service initialized');
    
    // Start periodic metrics collection
    setInterval(() => this.collectSystemMetrics(), 60000); // Every minute
  }

  /**
   * تسجيل طلب جديد
   */
  async recordRequest(
    method: string,
    path: string,
    statusCode: number,
    duration: number,
    userId?: string,
  ): Promise<void> {
    const key = `${method}:${path}`;
    const today = new Date().toISOString().split('T')[0];
    const hour = new Date().getHours().toString().padStart(2, '0');

    // Update in-memory stats
    this.responseTimes.push(duration);
    if (this.responseTimes.length > 1000) {
      this.responseTimes.shift();
    }

    // Endpoint stats
    const stats = this.endpointStats.get(key) || { count: 0, totalDuration: 0, errors: 0 };
    stats.count++;
    stats.totalDuration += duration;
    if (statusCode >= 400) stats.errors++;
    this.endpointStats.set(key, stats);

    // Store in Redis
    if (this.redis.isEnabled()) {
      const pipeline = this.redis.getClient()?.pipeline();
      
      if (pipeline) {
        // Total requests
        pipeline.incr(`metrics:requests:total:${today}`);
        pipeline.expire(`metrics:requests:total:${today}`, 86400 * 7);
        
        // Hourly breakdown
        pipeline.incr(`metrics:requests:hourly:${today}:${hour}`);
        pipeline.expire(`metrics:requests:hourly:${today}:${hour}`, 86400 * 2);
        
        // By status code
        pipeline.incr(`metrics:status:${statusCode}:${today}`);
        pipeline.expire(`metrics:status:${statusCode}:${today}`, 86400 * 7);
        
        // Response time (store last 100 for avg)
        pipeline.lpush(`metrics:response_times:${today}`, duration.toString());
        pipeline.ltrim(`metrics:response_times:${today}`, 0, 99);
        pipeline.expire(`metrics:response_times:${today}`, 86400 * 2);
        
        // Endpoint stats
        pipeline.hincrby(`metrics:endpoints:${today}`, key, 1);
        pipeline.expire(`metrics:endpoints:${today}`, 86400 * 7);
        
        await pipeline.exec();
      }
    }
  }

  /**
   * تسجيل خطأ
   */
  async recordError(
    method: string,
    path: string,
    error: any,
    userId?: string,
  ): Promise<void> {
    const errorType = error.name || 'UnknownError';
    const key = `${errorType}:${method}:${path}`;
    
    this.errorCounts.set(key, (this.errorCounts.get(key) || 0) + 1);

    if (this.redis.isEnabled()) {
      const today = new Date().toISOString().split('T')[0];
      await this.redis.incr(`metrics:errors:${today}`);
      await this.redis.hincrby(`metrics:error_types:${today}`, errorType, 1);
    }

    // Log error details
    this.logger.error(`❌ Error in ${method} ${path}:`, {
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      userId,
    });
  }

  /**
   * الحصول على مقاييس النظام
   */
  getSystemMetrics(): SystemMetrics {
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    // Calculate CPU usage
    let totalIdle = 0;
    let totalTick = 0;
    
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += (cpu.times as any)[type];
      }
      totalIdle += cpu.times.idle;
    }
    
    const cpuUsage = 100 - (100 * totalIdle) / totalTick;

    return {
      cpu: {
        usage: Math.round(cpuUsage * 100) / 100,
        cores: cpus.length,
      },
      memory: {
        total: totalMemory,
        used: usedMemory,
        free: freeMemory,
        usagePercent: Math.round((usedMemory / totalMemory) * 100 * 100) / 100,
      },
      uptime: os.uptime(),
      processUptime: process.uptime(),
    };
  }

  /**
   * الحصول على مقاييس الطلبات
   */
  async getRequestMetrics(): Promise<RequestMetrics> {
    const today = new Date().toISOString().split('T')[0];
    
    if (this.redis.isEnabled()) {
      const [total, errors, responseTimes] = await Promise.all([
        this.redis.get(`metrics:requests:total:${today}`),
        this.redis.get(`metrics:errors:${today}`),
        this.redis.lrange(`metrics:response_times:${today}`, 0, -1),
      ]);

      const totalCount = parseInt(total || '0');
      const errorCount = parseInt(errors || '0');
      const avgTime = responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + parseInt(b), 0) / responseTimes.length
        : 0;

      return {
        totalRequests: totalCount,
        successfulRequests: totalCount - errorCount,
        failedRequests: errorCount,
        averageResponseTime: Math.round(avgTime * 100) / 100,
        requestsPerMinute: Math.round(totalCount / (new Date().getHours() * 60 + new Date().getMinutes() + 1)),
      };
    }

    // Fallback
    const avgTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
      : 0;
    
    const totalErrors = Array.from(this.errorCounts.values()).reduce((a, b) => a + b, 0);
    const totalRequests = Array.from(this.endpointStats.values()).reduce((a, b) => a + b.count, 0);

    return {
      totalRequests,
      successfulRequests: totalRequests - totalErrors,
      failedRequests: totalErrors,
      averageResponseTime: Math.round(avgTime * 100) / 100,
      requestsPerMinute: Math.round(totalRequests / Math.max(1, (Date.now() - this.startTime) / 60000)),
    };
  }

  /**
   * الحصول على إحصائيات نقاط النهاية
   */
  async getEndpointMetrics(): Promise<EndpointMetrics[]> {
    const metrics: EndpointMetrics[] = [];

    for (const [key, stats] of this.endpointStats) {
      const [method, ...pathParts] = key.split(':');
      metrics.push({
        path: pathParts.join(':'),
        method,
        count: stats.count,
        avgDuration: Math.round((stats.totalDuration / stats.count) * 100) / 100,
        errors: stats.errors,
      });
    }

    return metrics.sort((a, b) => b.count - a.count).slice(0, 20);
  }

  /**
   * الحصول على جميع المقاييس
   */
  async getAllMetrics(): Promise<any> {
    return {
      system: this.getSystemMetrics(),
      requests: await this.getRequestMetrics(),
      endpoints: await this.getEndpointMetrics(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * جمع مقاييس النظام دورياً
   */
  private async collectSystemMetrics(): Promise<void> {
    const metrics = this.getSystemMetrics();
    
    // Alert if resources are high
    if (metrics.cpu.usage > 80) {
      this.logger.warn(`⚠️ High CPU usage: ${metrics.cpu.usage}%`);
    }
    
    if (metrics.memory.usagePercent > 85) {
      this.logger.warn(`⚠️ High memory usage: ${metrics.memory.usagePercent}%`);
    }

    // Store in Redis
    if (this.redis.isEnabled()) {
      const timestamp = Date.now();
      await this.redis.zadd(
        'metrics:system:history',
        timestamp,
        JSON.stringify({ ...metrics, timestamp }),
      );
      // Keep only last 24 hours
      await this.redis.zremrangebyscore('metrics:system:history', 0, timestamp - 86400000);
    }
  }

  /**
   * إعادة تعيين المقاييس
   */
  resetMetrics(): void {
    this.requestCounts.clear();
    this.responseTimes.length = 0;
    this.errorCounts.clear();
    this.endpointStats.clear();
    this.logger.log('📊 Metrics reset');
  }
}
