/**
 * Follows Controller - واجهة API للمتابعة
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from "@nestjs/swagger";
import { FollowsService } from "./follows.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

@ApiTags("follows")
@Controller("follows")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FollowsController {
  constructor(private followsService: FollowsService) {}

  @Post(":userId")
  @ApiOperation({ summary: "متابعة مستخدم" })
  async follow(
    @Param("userId") userId: string,
    @CurrentUser("id") currentUserId: string,
  ) {
    return this.followsService.follow(currentUserId, userId);
  }

  @Delete(":userId")
  @ApiOperation({ summary: "إلغاء متابعة مستخدم" })
  async unfollow(
    @Param("userId") userId: string,
    @CurrentUser("id") currentUserId: string,
  ) {
    return this.followsService.unfollow(currentUserId, userId);
  }

  @Get(":userId/check")
  @ApiOperation({ summary: "التحقق من المتابعة" })
  async checkFollowing(
    @Param("userId") userId: string,
    @CurrentUser("id") currentUserId: string,
  ) {
    const isFollowing = await this.followsService.isFollowing(
      currentUserId,
      userId,
    );
    return { isFollowing };
  }

  @Get(":userId/followers")
  @ApiOperation({ summary: "الحصول على المتابعين" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async getFollowers(
    @Param("userId") userId: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    return this.followsService.getFollowers(userId, page || 1, limit || 20);
  }

  @Get(":userId/following")
  @ApiOperation({ summary: "الحصول على المتابَعين" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async getFollowing(
    @Param("userId") userId: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    return this.followsService.getFollowing(userId, page || 1, limit || 20);
  }

  @Get(":userId/counts")
  @ApiOperation({ summary: "عدد المتابعين والمتابَعين" })
  async getFollowCounts(@Param("userId") userId: string) {
    return this.followsService.getFollowCounts(userId);
  }

  @Get("my/followers")
  @ApiOperation({ summary: "متابعيني" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async getMyFollowers(
    @CurrentUser("id") userId: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    return this.followsService.getFollowers(userId, page || 1, limit || 20);
  }

  @Get("my/following")
  @ApiOperation({ summary: "من أتابعهم" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async getMyFollowing(
    @CurrentUser("id") userId: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    return this.followsService.getFollowing(userId, page || 1, limit || 20);
  }
}
