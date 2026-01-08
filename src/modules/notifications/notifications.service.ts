/**
 * Notifications Service - خدمة الإشعارات
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { RedisService } from "../../common/redis/redis.service";
import { NotificationType } from "@prisma/client";

export interface CreateNotificationDto {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: any;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  // ================================
  // CREATE NOTIFICATION
  // ================================

  async create(dto: CreateNotificationDto): Promise<any> {
    const notification = await this.prisma.notification.create({
      data: {
        userId: dto.userId,
        type: dto.type,
        title: dto.title,
        body: dto.body,
        data: dto.data,
      },
    });

    // Publish to Redis for real-time delivery
    await this.redis.publish(
      "notifications:new",
      JSON.stringify({
        userId: dto.userId,
        notification,
      }),
    );

    this.logger.log(`Notification created for user ${dto.userId}: ${dto.type}`);

    return notification;
  }

  // ================================
  // BULK CREATE (for broadcasting)
  // ================================

  async createMany(
    userIds: string[],
    dto: Omit<CreateNotificationDto, "userId">,
  ) {
    const notifications = await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: dto.type,
        title: dto.title,
        body: dto.body,
        data: dto.data,
      })),
    });

    this.logger.log(
      `${notifications.count} notifications created for ${dto.type}`,
    );

    return notifications;
  }

  // ================================
  // GET USER NOTIFICATIONS
  // ================================

  async findByUser(userId: string, page = 1, limit = 20, unreadOnly = false): Promise<any> {
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (unreadOnly) {
      where.isRead = false;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      data: notifications,
      meta: {
        total,
        unreadCount,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ================================
  // GET UNREAD COUNT
  // ================================

  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  // ================================
  // MARK AS READ
  // ================================

  async markAsRead(notificationId: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  // ================================
  // MARK ALL AS READ
  // ================================

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  // ================================
  // DELETE NOTIFICATION
  // ================================

  async delete(notificationId: string, userId: string) {
    return this.prisma.notification.deleteMany({
      where: { id: notificationId, userId },
    });
  }

  // ================================
  // DELETE OLD NOTIFICATIONS
  // ================================

  async deleteOld(daysOld = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const result = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    this.logger.log(`Deleted ${result.count} old notifications`);
    return result;
  }

  // ================================
  // HELPER: Create Gift Notification
  // ================================

  async notifyGiftReceived(
    receiverId: string,
    senderName: string,
    giftName: string,
    roomId?: string,
  ): Promise<any> {
    return this.create({
      userId: receiverId,
      type: "GIFT_RECEIVED",
      title: "🎁 هدية جديدة!",
      body: `أرسل لك ${senderName} هدية ${giftName}`,
      data: { roomId },
    });
  }

  // ================================
  // HELPER: Create Follow Notification
  // ================================

  async notifyNewFollower(
    userId: string,
    followerName: string,
    followerId: string,
  ): Promise<any> {
    return this.create({
      userId,
      type: "NEW_FOLLOWER",
      title: "👤 متابع جديد!",
      body: `بدأ ${followerName} بمتابعتك`,
      data: { followerId },
    });
  }

  // ================================
  // HELPER: Create Room Invite Notification
  // ================================

  async notifyRoomInvite(
    userId: string,
    roomName: string,
    roomId: string,
    inviterName: string,
  ): Promise<any> {
    return this.create({
      userId,
      type: "ROOM_INVITE",
      title: "📩 دعوة للانضمام",
      body: `دعاك ${inviterName} للانضمام إلى غرفة "${roomName}"`,
      data: { roomId },
    });
  }
}
