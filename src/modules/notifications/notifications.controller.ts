/**
 * Notifications Controller - واجهة API للإشعارات
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
import { NotificationsService } from "./notifications.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

@ApiTags("notifications")
@Controller("notifications")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "الحصول على الإشعارات" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "unreadOnly", required: false, type: Boolean })
  async getNotifications(
    @CurrentUser("id") userId: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
    @Query("unreadOnly") unreadOnly?: boolean,
  ): Promise<any> {
    return this.notificationsService.findByUser(
      userId,
      page || 1,
      limit || 20,
      unreadOnly === true,
    );
  }

  @Get("unread-count")
  @ApiOperation({ summary: "عدد الإشعارات غير المقروءة" })
  async getUnreadCount(@CurrentUser("id") userId: string) {
    const count = await this.notificationsService.getUnreadCount(userId);
    return { unreadCount: count };
  }

  @Post(":id/read")
  @ApiOperation({ summary: "تحديد الإشعار كمقروء" })
  async markAsRead(
    @Param("id") notificationId: string,
    @CurrentUser("id") userId: string,
  ) {
    await this.notificationsService.markAsRead(notificationId, userId);
    return { message: "تم تحديد الإشعار كمقروء" };
  }

  @Post("read-all")
  @ApiOperation({ summary: "تحديد كل الإشعارات كمقروءة" })
  async markAllAsRead(@CurrentUser("id") userId: string) {
    await this.notificationsService.markAllAsRead(userId);
    return { message: "تم تحديد كل الإشعارات كمقروءة" };
  }

  @Delete("all")
  @ApiOperation({ summary: "حذف كل الإشعارات" })
  async deleteAllNotifications(@CurrentUser("id") userId: string) {
    const result = await this.notificationsService.deleteAll(userId);
    return { 
      message: "تم حذف كل الإشعارات", 
      deletedCount: result.count 
    };
  }

  @Delete(":id")
  @ApiOperation({ summary: "حذف إشعار" })
  async deleteNotification(
    @Param("id") notificationId: string,
    @CurrentUser("id") userId: string,
  ) {
    await this.notificationsService.delete(notificationId, userId);
    return { message: "تم حذف الإشعار" };
  }
}
