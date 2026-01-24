/**
 * Verification Module - وحدة التوثيق
 */

import { Module } from "@nestjs/common";
import { VerificationController } from "./verification.controller";
import { VerificationService } from "./verification.service";
import { PrismaModule } from "../../common/prisma/prisma.module";
import { RedisModule } from "../../common/redis/redis.module";
import { CacheModule } from "../../common/cache/cache.module";

@Module({
  imports: [PrismaModule, RedisModule, CacheModule],
  controllers: [VerificationController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
