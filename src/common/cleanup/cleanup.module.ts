/**
 * Cleanup Module - وحدة التنظيف الدوري
 */

import { Module } from "@nestjs/common";
import { CleanupService } from "./cleanup.service";
import { CleanupController } from "./cleanup.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { RedisModule } from "../redis/redis.module";

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [CleanupController],
  providers: [CleanupService],
  exports: [CleanupService],
})
export class CleanupModule {}
