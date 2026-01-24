/**
 * Owner Module - مودول المالك
 * يجمع جميع الـ routes الخاصة بالمالك
 */
import { Module } from "@nestjs/common";
import { OwnerController } from "./owner.controller";
import { OwnerAgentsController } from "./owner-agents.controller";
import { OwnerService } from "./owner.service";
import { AgentsModule } from "../agents/agents.module";
import { PrismaModule } from "../../common/prisma/prisma.module";
import { RedisModule } from "../../common/redis/redis.module";
import { CacheModule } from "../../common/cache/cache.module";

@Module({
  imports: [AgentsModule, PrismaModule, RedisModule, CacheModule],
  controllers: [OwnerController, OwnerAgentsController],
  providers: [OwnerService],
  exports: [OwnerService],
})
export class OwnerModule {}
