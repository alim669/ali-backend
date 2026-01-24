/**
 * Private Chats Controller - متحكم الدردشة الخاصة
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { PrivateChatsService } from "./private-chats.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

@ApiTags("private-chats")
@Controller("private-chats")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PrivateChatsController {
  constructor(private readonly privateChatsService: PrivateChatsService) {}

  @Post("messages")
  @ApiOperation({ summary: "إرسال رسالة خاصة" })
  async sendMessage(
    @Body() body: { toUserId: string; text: string; type?: string; imageUrl?: string; duration?: string },
    @CurrentUser("id") userId: string
  ) {
    return this.privateChatsService.sendMessage(
      userId,
      body.toUserId,
      body.text,
      body.type || "text",
      body.imageUrl,
      body.duration
    );
  }

  @Get()
  @ApiOperation({ summary: "جلب قائمة المحادثات" })
  async getChats(@CurrentUser("id") userId: string) {
    return this.privateChatsService.getChats(userId);
  }

  @Get("unread-count")
  @ApiOperation({ summary: "إجمالي الرسائل غير المقروءة" })
  async getTotalUnreadCount(@CurrentUser("id") userId: string) {
    const count = await this.privateChatsService.getTotalUnreadCount(userId);
    return { success: true, count };
  }

  @Get(":chatId/messages")
  @ApiOperation({ summary: "جلب رسائل محادثة" })
  async getMessages(
    @Param("chatId") chatId: string,
    @Query("limit") limit: string,
    @Query("before") before: string,
    @CurrentUser("id") userId: string
  ) {
    return this.privateChatsService.getMessages(
      chatId,
      userId,
      parseInt(limit) || 100,
      before
    );
  }

  @Post(":chatId/read")
  @ApiOperation({ summary: "تحديد الرسائل كمقروءة" })
  async markAsRead(
    @Param("chatId") chatId: string,
    @CurrentUser("id") userId: string
  ) {
    return this.privateChatsService.markAsRead(chatId, userId);
  }

  @Get(":chatId/unread-count")
  @ApiOperation({ summary: "عدد الرسائل غير المقروءة" })
  async getUnreadCount(
    @Param("chatId") chatId: string,
    @CurrentUser("id") userId: string
  ) {
    const count = await this.privateChatsService.getUnreadCount(chatId, userId);
    return { success: true, count };
  }

  @Delete(":chatId")
  @ApiOperation({ summary: "حذف محادثة" })
  async deleteChat(
    @Param("chatId") chatId: string,
    @CurrentUser("id") userId: string
  ) {
    return this.privateChatsService.deleteChat(chatId, userId);
  }

  @Delete(":chatId/messages/:messageId")
  @ApiOperation({ summary: "حذف رسالة" })
  async deleteMessage(
    @Param("chatId") chatId: string,
    @Param("messageId") messageId: string,
    @CurrentUser("id") userId: string
  ) {
    return this.privateChatsService.deleteMessage(chatId, messageId, userId);
  }
}
