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
  Body,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiBody,
} from "@nestjs/swagger";
import { NotificationsService } from "./notifications.service";
import { PushNotificationService } from "./push-notification.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

// DTOs for device registration
class RegisterDeviceDto {
  token: string;
  platform: 'android' | 'ios' | 'web';
  provider?: string;
}

class UnregisterDeviceDto {
  token: string;
}

class TopicDto {
  token: string;
  topic: string;
}

@ApiTags("notifications")
@Controller("notifications")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationsController {
  constructor(
    private notificationsService: NotificationsService,
    private pushService: PushNotificationService,
  ) {}

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

  // ========================================
  // Device Token Management (FCM)
  // ========================================

  @Post("register-device")
  @ApiOperation({ summary: "تسجيل جهاز للإشعارات" })
  @ApiBody({ type: RegisterDeviceDto })
  async registerDevice(
    @CurrentUser("id") userId: string,
    @Body() body: RegisterDeviceDto,
  ) {
    const platform = body.platform.toUpperCase() as 'ANDROID' | 'IOS' | 'WEB';
    await this.pushService.registerToken(userId, body.token, platform);
    return { message: "تم تسجيل الجهاز بنجاح" };
  }

  @Post("unregister-device")
  @ApiOperation({ summary: "إلغاء تسجيل جهاز" })
  @ApiBody({ type: UnregisterDeviceDto })
  async unregisterDevice(@Body() body: UnregisterDeviceDto) {
    await this.pushService.deactivateToken(body.token);
    return { message: "تم إلغاء تسجيل الجهاز" };
  }

  @Post("subscribe-topic")
  @ApiOperation({ summary: "الاشتراك في موضوع" })
  @ApiBody({ type: TopicDto })
  async subscribeToTopic(@Body() body: TopicDto) {
    await this.pushService.subscribeToTopic(body.token, body.topic);
    return { message: `تم الاشتراك في ${body.topic}` };
  }

  @Post("unsubscribe-topic")
  @ApiOperation({ summary: "إلغاء الاشتراك من موضوع" })
  @ApiBody({ type: TopicDto })
  async unsubscribeFromTopic(@Body() body: TopicDto) {
    await this.pushService.unsubscribeFromTopic(body.token, body.topic);
    return { message: `تم إلغاء الاشتراك من ${body.topic}` };
  }
}
