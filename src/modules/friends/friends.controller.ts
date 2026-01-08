/**
 * Friends Controller - واجهة API للأصدقاء
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { FriendsService } from "./friends.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

@ApiTags("friends")
@Controller("friends")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FriendsController {
  constructor(private friendsService: FriendsService) {}

  // ==================== FRIEND REQUESTS ====================

  @Post("requests")
  @ApiOperation({ summary: "إرسال طلب صداقة" })
  async sendFriendRequest(
    @CurrentUser("id") userId: string,
    @Body("toUserId") toUserId: string,
  ) {
    return this.friendsService.sendFriendRequest(userId, toUserId);
  }

  @Post("requests/by-custom-id")
  @ApiOperation({ summary: "إرسال طلب صداقة بالـ Custom ID" })
  async sendFriendRequestByCustomId(
    @CurrentUser("id") userId: string,
    @Body("customId") customId: number,
  ) {
    return this.friendsService.sendFriendRequestByCustomId(userId, customId);
  }

  @Get("requests/pending")
  @ApiOperation({ summary: "جلب طلبات الصداقة المعلقة" })
  async getPendingRequests(@CurrentUser("id") userId: string) {
    return this.friendsService.getPendingRequests(userId);
  }

  @Get("requests/sent")
  @ApiOperation({ summary: "جلب طلبات الصداقة المرسلة" })
  async getSentRequests(@CurrentUser("id") userId: string) {
    return this.friendsService.getSentRequests(userId);
  }

  @Post("requests/:requestId/accept")
  @ApiOperation({ summary: "قبول طلب صداقة" })
  async acceptFriendRequest(
    @Param("requestId") requestId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.friendsService.acceptFriendRequest(requestId, userId);
  }

  @Post("requests/:requestId/reject")
  @ApiOperation({ summary: "رفض طلب صداقة" })
  async rejectFriendRequest(
    @Param("requestId") requestId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.friendsService.rejectFriendRequest(requestId, userId);
  }

  // ==================== FRIENDS LIST ====================

  @Get()
  @ApiOperation({ summary: "جلب قائمة الأصدقاء" })
  async getFriends(@CurrentUser("id") userId: string) {
    return this.friendsService.getFriends(userId);
  }

  @Delete(":friendId")
  @ApiOperation({ summary: "إزالة صديق" })
  async removeFriend(
    @Param("friendId") friendId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.friendsService.removeFriend(userId, friendId);
  }

  @Get(":friendId/check")
  @ApiOperation({ summary: "التحقق من الصداقة" })
  async checkFriendship(
    @Param("friendId") friendId: string,
    @CurrentUser("id") userId: string,
  ) {
    const areFriends = await this.friendsService.areFriends(userId, friendId);
    return { areFriends };
  }
}
