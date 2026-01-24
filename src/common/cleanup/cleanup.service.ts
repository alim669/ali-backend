/**
 * Cleanup Service - خدمة تنظيف البيانات
 * تشغيل مهام الصيانة الدورية
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class CleanupService implements OnModuleInit {
  private readonly logger = new Logger(CleanupService.name);
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private config: ConfigService,
  ) {}

  async onModuleInit() {
    const enabled = this.config.get<string>("CLEANUP_ENABLED", "true");
    if (enabled === "true") {
      // Run cleanup every hour
      this.cleanupInterval = setInterval(
        () => this.runAllCleanupTasks(),
        60 * 60 * 1000, // 1 hour
      );

      // Run initial cleanup after 1 minute
      setTimeout(() => this.runAllCleanupTasks(), 60 * 1000);

      this.logger.log("🧹 Cleanup service initialized");
    }
  }

  // ================================
  // RUN ALL CLEANUP TASKS
  // ================================

  async runAllCleanupTasks(): Promise<Record<string, number>> {
    this.logger.log("Starting cleanup tasks...");

    const results: Record<string, number> = {};

    try {
      results.expiredTokens = await this.cleanupExpiredRefreshTokens();
      results.expiredVIPs = await this.cleanupExpiredVIPs();
      results.expiredVerifications = await this.cleanupExpiredVerifications();
      results.oldNotifications = await this.cleanupOldNotifications();
      results.expiredBans = await this.cleanupExpiredBans();
      results.expiredMutes = await this.cleanupExpiredMutes();
      results.expiredAgentRequests = await this.cleanupExpiredAgentRequests();
      results.oldMessages = await this.cleanupSoftDeletedMessages();

      this.logger.log(`Cleanup completed: ${JSON.stringify(results)}`);
    } catch (error) {
      this.logger.error(`Cleanup failed: ${error.message}`);
    }

    return results;
  }

  // ================================
  // CLEANUP EXPIRED REFRESH TOKENS
  // ================================

  async cleanupExpiredRefreshTokens(): Promise<number> {
    try {
      const result = await this.prisma.refreshToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            {
              revokedAt: {
                lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
              },
            },
          ],
        },
      });

      if (result.count > 0) {
        this.logger.log(`Cleaned up ${result.count} expired refresh tokens`);
      }

      return result.count;
    } catch (error) {
      this.logger.error(`Failed to cleanup refresh tokens: ${error.message}`);
      return 0;
    }
  }

  // ================================
  // CLEANUP EXPIRED VIPs
  // ================================

  async cleanupExpiredVIPs(): Promise<number> {
    try {
      const result = await this.prisma.user.updateMany({
        where: {
          isVIP: true,
          vipExpiresAt: { lt: new Date() },
        },
        data: {
          isVIP: false,
        },
      });

      if (result.count > 0) {
        this.logger.log(`Expired ${result.count} VIP subscriptions`);
      }

      return result.count;
    } catch (error) {
      this.logger.error(`Failed to cleanup VIPs: ${error.message}`);
      return 0;
    }
  }

  // ================================
  // CLEANUP EXPIRED VERIFICATIONS
  // ================================

  async cleanupExpiredVerifications(): Promise<number> {
    try {
      const now = new Date();

      // Get expired verifications for logging
      const expiredVerifications = await this.prisma.verification.findMany({
        where: {
          expiresAt: { lt: now },
        },
        select: {
          id: true,
          userId: true,
          type: true,
        },
      });

      if (expiredVerifications.length === 0) {
        return 0;
      }

      // Delete expired verifications
      const result = await this.prisma.verification.deleteMany({
        where: {
          expiresAt: { lt: now },
        },
      });

      // Clear cache for each expired verification
      for (const verification of expiredVerifications) {
        await this.redis.del(`verification:${verification.userId}`);
        // Publish expiration event
        await this.redis.publish("verification:expired", {
          type: "verification_expired",
          data: {
            userId: verification.userId,
            verificationType: verification.type,
          },
        });
      }

      if (result.count > 0) {
        this.logger.log(`Expired ${result.count} verifications`);
      }

      return result.count;
    } catch (error) {
      this.logger.error(`Failed to cleanup verifications: ${error.message}`);
      return 0;
    }
  }

  // ================================
  // CLEANUP OLD NOTIFICATIONS
  // ================================

  async cleanupOldNotifications(): Promise<number> {
    try {
      // Delete read notifications older than 30 days
      const readResult = await this.prisma.notification.deleteMany({
        where: {
          isRead: true,
          createdAt: {
            lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
      });

      // Delete unread notifications older than 90 days
      const unreadResult = await this.prisma.notification.deleteMany({
        where: {
          isRead: false,
          createdAt: {
            lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
          },
        },
      });

      const total = readResult.count + unreadResult.count;
      if (total > 0) {
        this.logger.log(`Cleaned up ${total} old notifications`);
      }

      return total;
    } catch (error) {
      this.logger.error(`Failed to cleanup notifications: ${error.message}`);
      return 0;
    }
  }

  // ================================
  // CLEANUP EXPIRED BANS
  // ================================

  async cleanupExpiredBans(): Promise<number> {
    try {
      const result = await this.prisma.roomMember.updateMany({
        where: {
          isBanned: true,
          bannedUntil: { lt: new Date() },
        },
        data: {
          isBanned: false,
          bannedUntil: null,
        },
      });

      if (result.count > 0) {
        this.logger.log(`Unbanned ${result.count} expired room bans`);
      }

      return result.count;
    } catch (error) {
      this.logger.error(`Failed to cleanup bans: ${error.message}`);
      return 0;
    }
  }

  // ================================
  // CLEANUP EXPIRED MUTES
  // ================================

  async cleanupExpiredMutes(): Promise<number> {
    try {
      const result = await this.prisma.roomMember.updateMany({
        where: {
          isMuted: true,
          mutedUntil: { lt: new Date() },
        },
        data: {
          isMuted: false,
          mutedUntil: null,
        },
      });

      if (result.count > 0) {
        this.logger.log(`Unmuted ${result.count} expired mutes`);
      }

      return result.count;
    } catch (error) {
      this.logger.error(`Failed to cleanup mutes: ${error.message}`);
      return 0;
    }
  }

  // ================================
  // CLEANUP EXPIRED AGENT REQUESTS
  // ================================

  async cleanupExpiredAgentRequests(): Promise<number> {
    try {
      const result = await this.prisma.agentRequest.updateMany({
        where: {
          status: "PENDING",
          expiresAt: { lt: new Date() },
        },
        data: {
          status: "REJECTED",
          rejectionReason: "انتهت صلاحية الطلب",
        },
      });

      if (result.count > 0) {
        this.logger.log(`Expired ${result.count} agent requests`);
      }

      return result.count;
    } catch (error) {
      this.logger.error(`Failed to cleanup agent requests: ${error.message}`);
      return 0;
    }
  }

  // ================================
  // CLEANUP SOFT-DELETED MESSAGES
  // ================================

  async cleanupSoftDeletedMessages(): Promise<number> {
    try {
      // Hard delete messages that were soft-deleted 30+ days ago
      const result = await this.prisma.message.deleteMany({
        where: {
          isDeleted: true,
          deletedAt: {
            lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
      });

      if (result.count > 0) {
        this.logger.log(`Hard deleted ${result.count} old soft-deleted messages`);
      }

      return result.count;
    } catch (error) {
      this.logger.error(`Failed to cleanup messages: ${error.message}`);
      return 0;
    }
  }

  // ================================
  // CLEANUP PRIVATE MESSAGES (Optional)
  // ================================

  async cleanupOldPrivateMessages(): Promise<number> {
    try {
      // Delete soft-deleted private messages older than 30 days
      const result = await this.prisma.$executeRaw`
        DELETE FROM "PrivateMessage" 
        WHERE "isDeleted" = true 
        AND "deletedAt" < NOW() - INTERVAL '30 days'
      `;

      if (result > 0) {
        this.logger.log(`Deleted ${result} old private messages`);
      }

      return result;
    } catch (error) {
      // Table might not exist yet
      this.logger.debug(`Private messages cleanup skipped: ${error.message}`);
      return 0;
    }
  }

  // ================================
  // REDIS CLEANUP
  // ================================

  async cleanupRedisKeys(): Promise<number> {
    try {
      // Clean up old presence data
      const onlineKey = "online:users";
      const members = await this.redis.smembers(onlineKey);

      let cleaned = 0;
      for (const memberId of members) {
        // Check if presence data is stale (no heartbeat in 5 minutes)
        const lastSeen = await this.redis.get(`presence:${memberId}:lastSeen`);
        if (lastSeen) {
          const lastSeenTime = parseInt(lastSeen, 10);
          if (Date.now() - lastSeenTime > 5 * 60 * 1000) {
            await this.redis.srem(onlineKey, memberId);
            cleaned++;
          }
        }
      }

      if (cleaned > 0) {
        this.logger.log(`Cleaned ${cleaned} stale presence entries`);
      }

      return cleaned;
    } catch (error) {
      this.logger.error(`Failed to cleanup Redis: ${error.message}`);
      return 0;
    }
  }

  // ================================
  // MANUAL TRIGGER (Admin)
  // ================================

  async triggerCleanup(): Promise<Record<string, number>> {
    this.logger.log("Manual cleanup triggered");
    return this.runAllCleanupTasks();
  }

  // ================================
  // GET CLEANUP STATS
  // ================================

  async getCleanupStats(): Promise<Record<string, number>> {
    try {
      const [
        expiredTokens,
        expiredVIPs,
        oldNotificationsRead,
        oldNotificationsUnread,
        expiredBans,
        expiredMutes,
        expiredAgentRequests,
        softDeletedMessages,
      ] = await Promise.all([
        this.prisma.refreshToken.count({
          where: {
            OR: [
              { expiresAt: { lt: new Date() } },
              { revokedAt: { not: null } },
            ],
          },
        }),
        this.prisma.user.count({
          where: {
            isVIP: true,
            vipExpiresAt: { lt: new Date() },
          },
        }),
        this.prisma.notification.count({
          where: {
            isRead: true,
            createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        }),
        this.prisma.notification.count({
          where: {
            isRead: false,
            createdAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
          },
        }),
        this.prisma.roomMember.count({
          where: {
            isBanned: true,
            bannedUntil: { lt: new Date() },
          },
        }),
        this.prisma.roomMember.count({
          where: {
            isMuted: true,
            mutedUntil: { lt: new Date() },
          },
        }),
        this.prisma.agentRequest.count({
          where: {
            status: "PENDING",
            expiresAt: { lt: new Date() },
          },
        }),
        this.prisma.message.count({
          where: {
            isDeleted: true,
            deletedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        }),
      ]);

      return {
        expiredTokens,
        expiredVIPs,
        oldNotificationsRead,
        oldNotificationsUnread,
        expiredBans,
        expiredMutes,
        expiredAgentRequests,
        softDeletedMessages,
      };
    } catch (error) {
      this.logger.error(`Failed to get cleanup stats: ${error.message}`);
      return {};
    }
  }
}
