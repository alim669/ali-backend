/**
 * Health Service - خدمة فحص صحة النظام
 * تفحص جميع الخدمات والمكونات
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  services: {
    database: ServiceHealth;
    redis: ServiceHealth;
    memory: MemoryHealth;
    disk?: DiskHealth;
  };
}

export interface ServiceHealth {
  status: 'up' | 'down' | 'degraded';
  latency?: number;
  message?: string;
  details?: Record<string, any>;
}

export interface MemoryHealth {
  status: 'up' | 'warning' | 'critical';
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  percentUsed: number;
}

export interface DiskHealth {
  status: 'up' | 'warning' | 'critical';
  free: number;
  total: number;
  percentUsed: number;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private config: ConfigService,
  ) {}

  async getHealth(): Promise<HealthCheckResult> {
    const [database, redis, memory] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkMemory(),
    ]);

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (database.status === 'down') {
      status = 'unhealthy';
    } else if (redis.status === 'down' || memory.status === 'critical') {
      status = 'degraded';
    } else if (redis.status === 'degraded' || memory.status === 'warning') {
      status = 'degraded';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: process.env.npm_package_version || '1.0.0',
      environment: this.config.get<string>('NODE_ENV', 'development'),
      services: {
        database,
        redis,
        memory,
      },
    };
  }

  async checkDatabase(): Promise<ServiceHealth> {
    const start = Date.now();
    
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const latency = Date.now() - start;
      
      // Check connection pool if available
      let poolInfo: any = {};
      try {
        const result = await this.prisma.$queryRaw<any[]>`
          SELECT count(*) as connections 
          FROM pg_stat_activity 
          WHERE datname = current_database()
        `;
        poolInfo.activeConnections = parseInt(result[0]?.connections || '0');
      } catch (e) {
        // Ignore - not all setups support this
      }

      return {
        status: latency > 1000 ? 'degraded' : 'up',
        latency,
        details: poolInfo,
      };
    } catch (error) {
      this.logger.error('Database health check failed:', error.message);
      return {
        status: 'down',
        message: error.message,
      };
    }
  }

  async checkRedis(): Promise<ServiceHealth> {
    if (!this.redis.isEnabled()) {
      return {
        status: 'degraded',
        message: 'Using in-memory fallback',
      };
    }

    const start = Date.now();
    
    try {
      const client = this.redis.getClient();
      if (!client) {
        return {
          status: 'degraded',
          message: 'Redis client not available',
        };
      }

      await client.ping();
      const latency = Date.now() - start;

      // Get Redis info
      let info: any = {};
      try {
        const infoRaw = await client.info('memory');
        const lines = infoRaw.split('\r\n');
        for (const line of lines) {
          if (line.startsWith('used_memory_human:')) {
            info.usedMemory = line.split(':')[1];
          }
        }
      } catch (e) {
        // Ignore
      }

      return {
        status: latency > 500 ? 'degraded' : 'up',
        latency,
        details: info,
      };
    } catch (error) {
      this.logger.error('Redis health check failed:', error.message);
      return {
        status: 'down',
        message: error.message,
      };
    }
  }

  checkMemory(): MemoryHealth {
    const usage = process.memoryUsage();
    const percentUsed = Math.round((usage.heapUsed / usage.heapTotal) * 100);

    let status: 'up' | 'warning' | 'critical' = 'up';
    if (percentUsed > 90) {
      status = 'critical';
    } else if (percentUsed > 75) {
      status = 'warning';
    }

    return {
      status,
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
      rss: Math.round(usage.rss / 1024 / 1024), // MB
      external: Math.round(usage.external / 1024 / 1024), // MB
      percentUsed,
    };
  }

  async ping(): Promise<{ pong: boolean; time: number }> {
    return {
      pong: true,
      time: Date.now(),
    };
  }

  async getLiveness(): Promise<{ status: 'ok' | 'error' }> {
    return { status: 'ok' };
  }

  async getReadiness(): Promise<{ status: 'ok' | 'error'; checks: Record<string, boolean> }> {
    const checks: Record<string, boolean> = {};

    // Check database
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch {
      checks.database = false;
    }

    // Check Redis (optional)
    if (this.redis.isEnabled()) {
      try {
        const client = this.redis.getClient();
        if (client) {
          await client.ping();
          checks.redis = true;
        } else {
          checks.redis = false;
        }
      } catch {
        checks.redis = false;
      }
    } else {
      checks.redis = true; // In-memory fallback is ok
    }

    const allChecksPass = Object.values(checks).every((v) => v);

    return {
      status: allChecksPass ? 'ok' : 'error',
      checks,
    };
  }
}
