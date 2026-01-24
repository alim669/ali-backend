/**
 * Private Chats Module - وحدة الدردشة الخاصة
 */

import { Module } from "@nestjs/common";
import { PrivateChatsController } from "./private-chats.controller";
import { PrivateChatsService } from "./private-chats.service";

@Module({
  controllers: [PrivateChatsController],
  providers: [PrivateChatsService],
  exports: [PrivateChatsService],
})
export class PrivateChatsModule {}
