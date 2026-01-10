/**
 * Scheduled Tasks Service - المهام المجدولة
 * يدير جميع الـ Cron Jobs في التطبيق
 */

import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression, SchedulerRegistry } from "@nestjs/schedule";
import { CleanupService } from "../cleanup/cleanup.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

@Injectable()
export class ScheduledTasksService {
  private readonly logger = new Logger(ScheduledTasksService.name);

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly cleanupService: CleanupService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ================================
  // CLEANUP JOBS
  // ================================

  /**
   * تنظيف يومي - 3:00 صباحاً
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: "dailyCleanup" })
  async handleDailyCleanup(): Promise<void> {
    this.logger.log("🧹 Starting daily cleanup...");

    try {
      const results = await Promise.allSettled([
        this.cleanupService.cleanupExpiredRefreshTokens(),
        this.cleanupService.cleanupOldNotifications(),
        this.cleanupService.cleanupExpiredBans(),
        this.cleanupService.cleanupExpiredMutes(),
        this.cleanupService.cleanupExpiredVIPs(),
      ]);

      const successful = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      this.logger.log(
        `✅ Daily cleanup completed: ${successful} successful, ${failed} failed`,
      );
    } catch (error) {
      this.logger.error("❌ Daily cleanup failed", error);
    }
  }

  /**
   * تنظيف أسبوعي - كل أحد 4:00 صباحاً
   */
  @Cron(CronExpression.EVERY_WEEK, { name: "weeklyCleanup" })
  async handleWeeklyCleanup(): Promise<void> {
    this.logger.log("🧹 Starting weekly cleanup...");

    try {
      const results = await Promise.allSettled([
        this.cleanupService.cleanupSoftDeletedMessages(),
        this.cleanupService.cleanupRedisKeys(),
      ]);

      const successful = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      this.logger.log(
        `✅ Weekly cleanup completed: ${successful} successful, ${failed} failed`,
      );
    } catch (error) {
      this.logger.error("❌ Weekly cleanup failed", error);
    }
  }

  /**
   * تنظيف كل 6 ساعات
   */
  @Cron(CronExpression.EVERY_6_HOURS, { name: "regularCleanup" })
  async handleRegularCleanup(): Promise<void> {
    try {
      await this.cleanupService.cleanupExpiredAgentRequests();
      this.logger.debug("Regular cleanup completed");
    } catch (error) {
      this.logger.error("Regular cleanup failed", error);
    }
  }

  // ================================
  // HEALTH MONITORING JOBS
  // ================================

  /**
   * فحص صحة النظام كل 5 دقائق
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: "healthCheck" })
  async handleHealthCheck(): Promise<void> {
    try {
      // فحص قاعدة البيانات
      const dbStart = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      const dbLatency = Date.now() - dbStart;

      // فحص Redis
      const redisStart = Date.now();
      await this.redis.ping();
      const redisLatency = Date.now() - redisStart;

      // تسجيل إذا كان هناك بطء
      if (dbLatency > 100) {
        this.logger.warn(`⚠️ Database latency high: ${dbLatency}ms`);
      }

      if (redisLatency > 50) {
        this.logger.warn(`⚠️ Redis latency high: ${redisLatency}ms`);
      }

      // تخزين في Redis للـ monitoring
      await this.redis.set(
        "health:last_check",
        JSON.stringify({
          timestamp: new Date().toISOString(),
          database: { latency: dbLatency, status: "ok" },
          redis: { latency: redisLatency, status: "ok" },
        }),
        600, // 10 minutes TTL
      );
    } catch (error) {
      this.logger.error("❌ Health check failed", error);
    }
  }

  // ================================
  // STATISTICS JOBS
  // ================================

  /**
   * تحديث إحصائيات المستخدمين كل ساعة
   */
  @Cron(CronExpression.EVERY_HOUR, { name: "updateStats" })
  async handleUpdateStats(): Promise<void> {
    try {
      // إحصائيات المستخدمين
      const [totalUsers, activeUsers, vipUsers, onlineUsers] =
        await Promise.all([
          this.prisma.user.count(),
          this.prisma.user.count({
            where: {
              lastLoginAt: {
                gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
              },
            },
          }),
          this.prisma.user.count({
            where: {
              isVIP: true,
              vipExpiresAt: { gt: new Date() },
            },
          }),
          this.redis.smembers("online:users").then((m) => m.length),
        ]);

      // إحصائيات الغرف
      const [totalRooms, activeRooms] = await Promise.all([
        this.prisma.room.count(),
        this.prisma.room.count({
          where: {
            status: "ACTIVE",
          },
        }),
      ]);

      const stats = {
        timestamp: new Date().toISOString(),
        users: {
          total: totalUsers,
          active24h: activeUsers,
          vip: vipUsers,
          online: onlineUsers,
        },
        rooms: {
          total: totalRooms,
          active: activeRooms,
        },
      };

      // تخزين في Redis
      await this.redis.set("stats:hourly", JSON.stringify(stats), 3600);

      this.logger.log(`📊 Stats updated: ${onlineUsers} online users`);
    } catch (error) {
      this.logger.error("Stats update failed", error);
    }
  }

  // ================================
  // UTILITY METHODS
  // ================================

  /**
   * الحصول على معلومات المهام المجدولة
   */
  getScheduledJobs(): {
    name: string;
    running: boolean;
    lastExecution?: Date;
  }[] {
    const jobs = this.schedulerRegistry.getCronJobs();
    return Array.from(jobs.entries()).map(([name, job]) => ({
      name,
      running: (job as any).running ?? false,
      lastExecution: job.lastDate() ?? undefined,
    }));
  }

  /**
   * إيقاف مهمة مؤقتاً
   */
  stopJob(name: string): void {
    const job = this.schedulerRegistry.getCronJob(name);
    job.stop();
    this.logger.log(`Stopped job: ${name}`);
  }

  /**
   * استئناف مهمة
   */
  startJob(name: string): void {
    const job = this.schedulerRegistry.getCronJob(name);
    job.start();
    this.logger.log(`Started job: ${name}`);
  }
}
