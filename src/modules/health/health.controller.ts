import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Health check' })
  async check() {
    const checks: Record<string, string> = {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };

    // Check Database
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch (e) {
      checks.database = 'error';
      checks.status = 'degraded';
    }

    // Check Redis
    try {
      await this.redis.ping();
      checks.redis = 'ok';
    } catch (e) {
      checks.redis = 'error';
      checks.status = 'degraded';
    }

    return checks;
  }

  @Get('ping')
  @ApiOperation({ summary: 'Simple ping' })
  ping() {
    return { pong: true, time: Date.now() };
  }
}
