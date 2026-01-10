/**
 * Scheduled Tasks Module - وحدة المهام المجدولة
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { ScheduledTasksService } from "./scheduled-tasks.service";
import { ScheduledTasksController } from "./scheduled-tasks.controller";
import { CleanupModule } from "../cleanup/cleanup.module";
import { PrismaModule } from "../prisma/prisma.module";
import { RedisModule } from "../redis/redis.module";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    CleanupModule,
    PrismaModule,
    RedisModule,
  ],
  controllers: [ScheduledTasksController],
  providers: [ScheduledTasksService],
  exports: [ScheduledTasksService],
})
export class ScheduledTasksModule {}
