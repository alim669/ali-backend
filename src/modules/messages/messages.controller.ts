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
import { SkipThrottle } from "@nestjs/throttler";
import { MessagesService } from "./messages.service";
import { SendMessageDto, MessageQueryDto } from "./dto/messages.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

@ApiTags("messages")
@Controller("rooms/:roomId/messages")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  @ApiOperation({ summary: "إرسال رسالة" })
  async send(
    @Param("roomId") roomId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser("id") userId: string,
  ): Promise<any> {
    return this.messagesService.send(roomId, userId, dto);
  }

  @Get()
  @SkipThrottle()
  @ApiOperation({ summary: "جلب الرسائل" })
  async getMessages(
    @Param("roomId") roomId: string,
    @Query() query: MessageQueryDto,
    @CurrentUser("id") userId: string,
  ): Promise<any> {
    return this.messagesService.getMessages(roomId, userId, query);
  }

  @Delete(":messageId")
  @ApiOperation({ summary: "حذف رسالة" })
  async delete(
    @Param("messageId") messageId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.messagesService.delete(messageId, userId);
  }

  @Post("typing")
  @ApiOperation({ summary: "بدء الكتابة" })
  async startTyping(
    @Param("roomId") roomId: string,
    @CurrentUser("id") userId: string,
  ) {
    await this.messagesService.setTyping(roomId, userId);
    return { success: true };
  }

  @Delete("typing")
  @ApiOperation({ summary: "إيقاف الكتابة" })
  async stopTyping(
    @Param("roomId") roomId: string,
    @CurrentUser("id") userId: string,
  ) {
    await this.messagesService.stopTyping(roomId, userId);
    return { success: true };
  }

  @Get("typing")
  @ApiOperation({ summary: "من يكتب الآن" })
  async getTyping(@Param("roomId") roomId: string) {
    const users = await this.messagesService.getTypingUsers(roomId);
    return { users };
  }
}
