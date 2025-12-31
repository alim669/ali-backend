/**
 * Cache Module
 * وحدة التخزين المؤقت
 */

import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { RedisModule } from '../redis/redis.module';

@Global()
@Module({
  imports: [RedisModule],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
