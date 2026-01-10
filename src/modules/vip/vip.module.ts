/**
 * VIP Module - وحدة العضويات المميزة
 */

import { Module } from "@nestjs/common";
import { VIPController } from "./vip.controller";
import { VIPService } from "./vip.service";
import { PrismaModule } from "../../common/prisma/prisma.module";
import { RedisModule } from "../../common/redis/redis.module";
import { CacheModule } from "../../common/cache/cache.module";

@Module({
  imports: [PrismaModule, RedisModule, CacheModule],
  controllers: [VIPController],
  providers: [VIPService],
  exports: [VIPService],
})
export class VIPModule {}
