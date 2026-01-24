/**
 * Owner Service - خدمة المالك
 * جميع العمليات الخاصة بالمالك فقط (SUPER_ADMIN)
 */
import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { RedisService } from "../../common/redis/redis.service";
import { CacheService } from "../../common/cache/cache.service";
import { AdminActionType, UserRole, Prisma } from "@prisma/client";

// ================================
// TYPES & INTERFACES
// ================================

export enum LockdownLevel {
  NONE = "NONE",
  SOFT = "SOFT", // New registrations disabled
  MEDIUM = "MEDIUM", // + Rooms disabled
  HARD = "HARD", // + Messaging disabled
  EMERGENCY = "EMERGENCY", // + Everything disabled
}

export enum PunishmentType {
  WARNING = "WARNING",
  MUTE = "MUTE",
  SHADOW_BAN = "SHADOW_BAN",
  TEMP_BAN = "TEMP_BAN",
  PERMANENT_BAN = "PERMANENT_BAN",
  IP_BAN = "IP_BAN",
  ACCOUNT_FREEZE = "ACCOUNT_FREEZE",
}

export interface SystemSettings {
  maintenanceMode: boolean;
  maintenanceMessage?: string;
  lockdownLevel: LockdownLevel;
  lockdownReason?: string;
  economyFrozen: boolean;
  featureFlags: Record<string, boolean>;
}

export interface OwnerActionResult {
  success: boolean;
  message: string;
  data?: any;
}

@Injectable()
export class OwnerService {
  private readonly logger = new Logger(OwnerService.name);

  // In-memory system settings (should be persisted to database in production)
  private systemSettings: SystemSettings = {
    maintenanceMode: false,
    lockdownLevel: LockdownLevel.NONE,
    economyFrozen: false,
    featureFlags: {
      gifts: true,
      rooms: true,
      chat: true,
      agents: true,
      vip: true,
      store: true,
    },
  };

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private cache: CacheService,
  ) {
    this.loadSystemSettings();
  }

  // ================================
  // SYSTEM SETTINGS PERSISTENCE
  // ================================

  private async loadSystemSettings(): Promise<void> {
    try {
      if (this.redis.isEnabled()) {
        const client = this.redis.getClient();
        if (client) {
          const settings = await client.get("system:settings");
          if (settings) {
            this.systemSettings = JSON.parse(settings);
            this.logger.log("System settings loaded from Redis");
          }
        }
      }
    } catch (error) {
      this.logger.warn("Failed to load system settings from Redis:", error);
    }
  }

  private async saveSystemSettings(): Promise<void> {
    try {
      if (this.redis.isEnabled()) {
        const client = this.redis.getClient();
        if (client) {
          await client.set(
            "system:settings",
            JSON.stringify(this.systemSettings),
          );
        }
      }
    } catch (error) {
      this.logger.warn("Failed to save system settings to Redis:", error);
    }
  }

  // ================================
  // HELPER METHODS
  // ================================

  private toBigInt(value: number | bigint): bigint {
    return typeof value === "bigint" ? value : BigInt(value);
  }

  private toNumber(value: number | bigint): number {
    return typeof value === "bigint" ? Number(value) : value;
  }

  // ================================
  // 1. SYSTEM CONTROL
  // ================================

  /**
   * Get current system settings
   */
  async getSystemSettings(): Promise<SystemSettings> {
    return this.systemSettings;
  }

  /**
   * Set maintenance mode
   */
  async setMaintenanceMode(
    ownerId: string,
    enabled: boolean,
    message?: string,
  ): Promise<OwnerActionResult> {
    this.systemSettings.maintenanceMode = enabled;
    this.systemSettings.maintenanceMessage = message;
    await this.saveSystemSettings();

    await this.logOwnerAction(ownerId, "MAINTENANCE_MODE", {
      enabled,
      message,
    });

    // Broadcast to all clients
    await this.broadcastSystemEvent("maintenance_mode", { enabled, message });

    this.logger.log(
      `Maintenance mode ${enabled ? "enabled" : "disabled"} by ${ownerId}`,
    );

    return {
      success: true,
      message: enabled ? "تم تفعيل وضع الصيانة" : "تم إيقاف وضع الصيانة",
      data: { enabled, message },
    };
  }

  /**
   * Set lockdown level
   */
  async setLockdownLevel(
    ownerId: string,
    level: LockdownLevel,
    reason: string,
  ): Promise<OwnerActionResult> {
    this.systemSettings.lockdownLevel = level;
    this.systemSettings.lockdownReason = reason;
    await this.saveSystemSettings();

    await this.logOwnerAction(ownerId, "LOCKDOWN_SET", { level, reason });

    // Broadcast to all clients
    await this.broadcastSystemEvent("lockdown", { level, reason });

    this.logger.log(`Lockdown level set to ${level} by ${ownerId}`);

    return {
      success: true,
      message: this.getLockdownMessage(level),
      data: { level, reason },
    };
  }

  private getLockdownMessage(level: LockdownLevel): string {
    switch (level) {
      case LockdownLevel.NONE:
        return "تم إلغاء الإغلاق";
      case LockdownLevel.SOFT:
        return "تم تفعيل الإغلاق الخفيف";
      case LockdownLevel.MEDIUM:
        return "تم تفعيل الإغلاق المتوسط";
      case LockdownLevel.HARD:
        return "تم تفعيل الإغلاق الصارم";
      case LockdownLevel.EMERGENCY:
        return "تم تفعيل إغلاق الطوارئ";
    }
  }

  /**
   * Toggle feature flag
   */
  async toggleFeature(
    ownerId: string,
    featureKey: string,
    enabled: boolean,
  ): Promise<OwnerActionResult> {
    this.systemSettings.featureFlags[featureKey] = enabled;
    await this.saveSystemSettings();

    await this.logOwnerAction(ownerId, "FEATURE_TOGGLE", { featureKey, enabled });

    this.logger.log(
      `Feature ${featureKey} ${enabled ? "enabled" : "disabled"} by ${ownerId}`,
    );

    return {
      success: true,
      message: `تم ${enabled ? "تفعيل" : "إيقاف"} الميزة: ${featureKey}`,
      data: { featureKey, enabled },
    };
  }

  /**
   * Send global announcement
   */
  async sendGlobalAnnouncement(
    ownerId: string,
    message: string,
    priority: "low" | "normal" | "high" | "urgent" = "normal",
  ): Promise<OwnerActionResult> {
    await this.logOwnerAction(ownerId, "GLOBAL_ANNOUNCEMENT", {
      message,
      priority,
    });

    // Broadcast to all clients
    await this.broadcastSystemEvent("announcement", {
      message,
      priority,
      from: "SYSTEM",
      timestamp: new Date().toISOString(),
    });

    this.logger.log(`Global announcement sent by ${ownerId}: ${message}`);

    return {
      success: true,
      message: "تم إرسال الإعلان العام",
      data: { message, priority },
    };
  }

  // ================================
  // 2. USER AUTHORITY (PUNISHMENTS)
  // ================================

  /**
   * Apply punishment to user
   */
  async punishUser(
    ownerId: string,
    userId: string,
    type: PunishmentType,
    reason: string,
    duration?: number, // hours
  ): Promise<OwnerActionResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException("المستخدم غير موجود");
    }

    if (user.role === "SUPER_ADMIN") {
      throw new ForbiddenException("لا يمكن معاقبة المالك");
    }

    let actionType: AdminActionType;
    let newStatus: "ACTIVE" | "BANNED" | "SUSPENDED" | null = null;

    switch (type) {
      case PunishmentType.WARNING:
        actionType = AdminActionType.SETTINGS_CHANGED; // Log as setting change
        break;
      case PunishmentType.MUTE:
        actionType = AdminActionType.SETTINGS_CHANGED;
        break;
      case PunishmentType.SHADOW_BAN:
        actionType = AdminActionType.USER_SUSPENDED;
        newStatus = "SUSPENDED";
        break;
      case PunishmentType.TEMP_BAN:
        actionType = AdminActionType.USER_SUSPENDED;
        newStatus = "SUSPENDED";
        break;
      case PunishmentType.PERMANENT_BAN:
        actionType = AdminActionType.USER_BANNED;
        newStatus = "BANNED";
        break;
      case PunishmentType.IP_BAN:
        actionType = AdminActionType.USER_BANNED;
        newStatus = "BANNED";
        break;
      case PunishmentType.ACCOUNT_FREEZE:
        actionType = AdminActionType.USER_SUSPENDED;
        newStatus = "SUSPENDED";
        break;
      default:
        actionType = AdminActionType.SETTINGS_CHANGED;
    }

    await this.prisma.$transaction(async (tx) => {
      // Update user status if needed
      if (newStatus) {
        // Calculate ban end date for temp bans
        const bannedUntil = type === PunishmentType.TEMP_BAN && duration
          ? new Date(Date.now() + duration * 60 * 60 * 1000)
          : null;
        
        await tx.user.update({
          where: { id: userId },
          data: { 
            status: newStatus,
            // Store ban details only for ban types
            ...(newStatus === 'BANNED' || newStatus === 'SUSPENDED' ? {
              banReason: reason,
              bannedAt: new Date(),
              bannedUntil,
              bannedBy: ownerId,
            } : {}),
          },
        });
      }

      // For muting, update room member isMuted flag (global mute via all memberships)
      if (type === PunishmentType.MUTE && duration) {
        await tx.roomMember.updateMany({
          where: { userId },
          data: {
            isMuted: true,
            mutedUntil: new Date(Date.now() + duration * 60 * 60 * 1000),
          },
        });
      }

      // Log the action
      await tx.adminAction.create({
        data: {
          actorId: ownerId,
          targetId: userId,
          action: actionType,
          reason,
          details: { type, duration },
        },
      });

      // Revoke tokens if banned
      if (
        type === PunishmentType.PERMANENT_BAN ||
        type === PunishmentType.IP_BAN
      ) {
        await tx.refreshToken.updateMany({
          where: { userId },
          data: { revokedAt: new Date() },
        });
      }
    });

    // Invalidate cache
    await this.cache.invalidate(`cache:user:${userId}`);

    this.logger.log(
      `User ${userId} punished with ${type} by owner ${ownerId}`,
    );

    return {
      success: true,
      message: this.getPunishmentMessage(type),
      data: { userId, type, reason, duration },
    };
  }

  private getPunishmentMessage(type: PunishmentType): string {
    switch (type) {
      case PunishmentType.WARNING:
        return "تم إرسال تحذير للمستخدم";
      case PunishmentType.MUTE:
        return "تم كتم المستخدم";
      case PunishmentType.SHADOW_BAN:
        return "تم الحظر الخفي للمستخدم";
      case PunishmentType.TEMP_BAN:
        return "تم الحظر المؤقت";
      case PunishmentType.PERMANENT_BAN:
        return "تم الحظر الدائم";
      case PunishmentType.IP_BAN:
        return "تم حظر IP المستخدم";
      case PunishmentType.ACCOUNT_FREEZE:
        return "تم تجميد الحساب";
    }
  }

  /**
   * Lift punishment from user
   */
  async liftPunishment(
    ownerId: string,
    userId: string,
    type: PunishmentType,
    reason?: string,
  ): Promise<OwnerActionResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException("المستخدم غير موجود");
    }

    await this.prisma.$transaction(async (tx) => {
      // Restore user status and clear ban details
      await tx.user.update({
        where: { id: userId },
        data: { 
          status: "ACTIVE",
          banReason: null,
          bannedAt: null,
          bannedUntil: null,
          bannedBy: null,
        },
      });

      // Remove mute if exists - unmute all room memberships
      if (type === PunishmentType.MUTE) {
        await tx.roomMember.updateMany({
          where: { userId },
          data: { isMuted: false, mutedUntil: null },
        });
      }

      // Log the action
      await tx.adminAction.create({
        data: {
          actorId: ownerId,
          targetId: userId,
          action: AdminActionType.USER_UNBANNED,
          reason: reason || "رفع العقوبة من قبل المالك",
          details: { originalType: type },
        },
      });
    });

    await this.cache.invalidate(`cache:user:${userId}`);

    this.logger.log(`Punishment ${type} lifted from ${userId} by owner ${ownerId}`);

    return {
      success: true,
      message: "تم رفع العقوبة",
      data: { userId, type },
    };
  }

  // ================================
  // 3. FINANCIAL CONTROL
  // ================================

  /**
   * Get economy overview
   */
  async getEconomyOverview(): Promise<any> {
    const [
      totalWallets,
      totalBalance,
      totalTransactions,
      todayTransactions,
      totalGiftValue,
    ] = await Promise.all([
      this.prisma.wallet.count(),
      this.prisma.wallet.aggregate({ _sum: { balance: true } }),
      this.prisma.walletTransaction.count(),
      this.prisma.walletTransaction.count({
        where: {
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
      this.prisma.giftSend.aggregate({ _sum: { totalPrice: true } }),
    ]);

    return {
      totalWallets,
      totalBalance: this.toNumber(totalBalance._sum.balance || 0),
      totalTransactions,
      todayTransactions,
      totalGiftValue: this.toNumber(totalGiftValue._sum.totalPrice || 0),
      economyFrozen: this.systemSettings.economyFrozen,
    };
  }

  /**
   * Adjust user balance
   */
  async adjustBalance(
    ownerId: string,
    userId: string,
    amount: number,
    reason: string,
  ): Promise<OwnerActionResult> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException("المحفظة غير موجودة");
    }

    const amountBig = this.toBigInt(amount);
    const walletBalance = wallet.balance as unknown as bigint;

    if (amountBig < 0n && walletBalance + amountBig < 0n) {
      throw new BadRequestException("الرصيد غير كافٍ");
    }

    await this.prisma.$transaction(async (tx) => {
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { increment: amount },
          version: { increment: 1 },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "ADMIN_ADJUSTMENT",
          status: "COMPLETED",
          amount: BigInt(Math.abs(amount)),
          balanceBefore: wallet.balance,
          balanceAfter: updatedWallet.balance,
          description: reason,
          metadata: { ownerId, adjustmentType: amount >= 0 ? "ADD" : "REMOVE" },
        },
      });

      await tx.adminAction.create({
        data: {
          actorId: ownerId,
          targetId: userId,
          action: AdminActionType.WALLET_ADJUSTED,
          reason,
          details: {
            amount,
            newBalance: this.toNumber(updatedWallet.balance),
          },
        },
      });
    });

    await this.cache.invalidate(`cache:wallet:${userId}`);

    this.logger.log(
      `Wallet adjusted for ${userId}: ${amount} by owner ${ownerId}`,
    );

    return {
      success: true,
      message: "تم تعديل الرصيد بنجاح",
      data: { userId, amount, reason },
    };
  }

  /**
   * Freeze/unfreeze economy
   */
  async setEconomyFreeze(
    ownerId: string,
    frozen: boolean,
    reason: string,
  ): Promise<OwnerActionResult> {
    this.systemSettings.economyFrozen = frozen;
    await this.saveSystemSettings();

    await this.logOwnerAction(ownerId, "ECONOMY_FREEZE", { frozen, reason });

    this.logger.log(
      `Economy ${frozen ? "frozen" : "unfrozen"} by owner ${ownerId}`,
    );

    return {
      success: true,
      message: frozen ? "تم تجميد الاقتصاد" : "تم رفع التجميد عن الاقتصاد",
      data: { frozen, reason },
    };
  }

  /**
   * Reverse gift transaction
   */
  async reverseGift(
    ownerId: string,
    transactionId: string,
    reason: string,
  ): Promise<OwnerActionResult> {
    const giftSend = await this.prisma.giftSend.findUnique({
      where: { id: transactionId },
      include: { sender: true, receiver: true },
    });

    if (!giftSend) {
      throw new NotFoundException("المعاملة غير موجودة");
    }

    // Reverse the gift
    await this.prisma.$transaction(async (tx) => {
      // Return coins to sender
      await tx.wallet.update({
        where: { userId: giftSend.senderId },
        data: { balance: { increment: giftSend.totalPrice } },
      });

      // Remove coins from receiver
      await tx.wallet.update({
        where: { userId: giftSend.receiverId },
        data: { balance: { decrement: giftSend.totalPrice } },
      });

      // Delete the gift send record (or we could add a 'reversed' column)
      // For now, we just adjust balances and log the action

      // Log the action
      await tx.adminAction.create({
        data: {
          actorId: ownerId,
          action: AdminActionType.WALLET_ADJUSTED,
          reason: `Gift reversed: ${reason}`,
          details: {
            transactionId,
            senderId: giftSend.senderId,
            receiverId: giftSend.receiverId,
            amount: this.toNumber(giftSend.totalPrice),
            type: "GIFT_REVERSE",
          },
        },
      });
    });

    this.logger.log(`Gift ${transactionId} reversed by owner ${ownerId}`);

    return {
      success: true,
      message: "تم عكس الهدية",
      data: { transactionId, reason },
    };
  }

  // ================================
  // 4. ADMIN MANAGEMENT
  // ================================

  /**
   * Get all admins and moderators
   */
  async getAdminsList(): Promise<any[]> {
    const admins = await this.prisma.user.findMany({
      where: {
        role: { in: ["ADMIN", "SUPER_ADMIN", "MODERATOR"] },
      },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatar: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
      },
      orderBy: { role: "asc" },
    });

    return admins;
  }

  /**
   * Set user role
   */
  async setUserRole(
    ownerId: string,
    userId: string,
    role: UserRole,
    reason?: string,
  ): Promise<OwnerActionResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException("المستخدم غير موجود");
    }

    // Prevent changing SUPER_ADMIN role
    if (user.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN") {
      throw new ForbiddenException("لا يمكن تغيير دور المالك");
    }

    const oldRole = user.role;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { role },
      });

      await tx.adminAction.create({
        data: {
          actorId: ownerId,
          targetId: userId,
          action: AdminActionType.SETTINGS_CHANGED, // ROLE_CHANGED - using SETTINGS_CHANGED until prisma generate
          reason,
          details: { oldRole, newRole: role, type: "ROLE_CHANGE" },
        },
      });
    });

    await this.cache.invalidate(`cache:user:${userId}`);

    this.logger.log(
      `User ${userId} role changed from ${oldRole} to ${role} by owner ${ownerId}`,
    );

    return {
      success: true,
      message: `تم تغيير الدور إلى ${role}`,
      data: { userId, oldRole, newRole: role },
    };
  }

  /**
   * Force logout user
   */
  async forceLogout(ownerId: string, userId: string): Promise<OwnerActionResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException("المستخدم غير موجود");
    }

    await this.prisma.$transaction(async (tx) => {
      // Revoke all refresh tokens
      await tx.refreshToken.updateMany({
        where: { userId },
        data: { revokedAt: new Date() },
      });

      // Log the action
      await tx.adminAction.create({
        data: {
          actorId: ownerId,
          targetId: userId,
          action: AdminActionType.SETTINGS_CHANGED, // FORCE_LOGOUT
          details: { type: "FORCE_LOGOUT" },
        },
      });
    });

    // Remove presence from Redis
    if (this.redis.isEnabled()) {
      const client = this.redis.getClient();
      if (client) {
        await client.del(`presence:user:${userId}`);
      }
    }

    this.logger.log(`User ${userId} force logged out by owner ${ownerId}`);

    return {
      success: true,
      message: "تم تسجيل خروج المستخدم",
      data: { userId },
    };
  }

  /**
   * Force logout all users
   */
  async forceLogoutAll(
    ownerId: string,
    exceptRoles?: string[],
  ): Promise<OwnerActionResult> {
    const excludeRoles = exceptRoles || ["SUPER_ADMIN"];

    await this.prisma.$transaction(async (tx) => {
      // Revoke all refresh tokens except for excluded roles
      await tx.refreshToken.updateMany({
        where: {
          user: { role: { notIn: excludeRoles as UserRole[] } },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });

      // Log the action
      await tx.adminAction.create({
        data: {
          actorId: ownerId,
          action: AdminActionType.SETTINGS_CHANGED, // FORCE_LOGOUT_ALL
          details: { exceptRoles: excludeRoles, type: "FORCE_LOGOUT_ALL" },
        },
      });
    });

    // Clear all presence keys from Redis (except owners)
    if (this.redis.isEnabled()) {
      const client = this.redis.getClient();
      if (client) {
        const keys = await client.keys("presence:user:*");
        if (keys.length > 0) {
          await client.del(...keys);
        }
      }
    }

    this.logger.warn(`All users force logged out by owner ${ownerId}`);

    return {
      success: true,
      message: "تم تسجيل خروج جميع المستخدمين",
      data: { exceptRoles: excludeRoles },
    };
  }

  // ================================
  // 5. ROOM SOVEREIGNTY
  // ================================

  /**
   * Delete room
   */
  async deleteRoom(
    ownerId: string,
    roomId: string,
    reason: string,
  ): Promise<OwnerActionResult> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });

    if (!room) {
      throw new NotFoundException("الغرفة غير موجودة");
    }

    await this.prisma.$transaction(async (tx) => {
      // Delete room
      await tx.room.delete({ where: { id: roomId } });

      // Log the action
      await tx.adminAction.create({
        data: {
          actorId: ownerId,
          action: AdminActionType.ROOM_CLOSED, // ROOM_DELETED - using ROOM_CLOSED
          reason,
          details: { roomId, roomName: room.name, type: "ROOM_DELETED" },
        },
      });
    });

    // Broadcast room deletion
    await this.broadcastSystemEvent("room_deleted", { roomId, reason });

    this.logger.log(`Room ${roomId} deleted by owner ${ownerId}`);

    return {
      success: true,
      message: "تم حذف الغرفة",
      data: { roomId },
    };
  }

  /**
   * Transfer room ownership
   */
  async transferRoomOwnership(
    ownerId: string,
    roomId: string,
    newOwnerId: string,
    reason: string,
  ): Promise<OwnerActionResult> {
    const [room, newOwner] = await Promise.all([
      this.prisma.room.findUnique({ where: { id: roomId } }),
      this.prisma.user.findUnique({ where: { id: newOwnerId } }),
    ]);

    if (!room) {
      throw new NotFoundException("الغرفة غير موجودة");
    }

    if (!newOwner) {
      throw new NotFoundException("المالك الجديد غير موجود");
    }

    const oldOwnerId = room.ownerId;

    await this.prisma.$transaction(async (tx) => {
      await tx.room.update({
        where: { id: roomId },
        data: { ownerId: newOwnerId },
      });

      await tx.adminAction.create({
        data: {
          actorId: ownerId,
          action: AdminActionType.SETTINGS_CHANGED, // ROOM_OWNERSHIP_TRANSFERRED
          reason,
          details: { roomId, oldOwnerId, newOwnerId, type: "ROOM_OWNERSHIP_TRANSFERRED" },
        },
      });
    });

    this.logger.log(
      `Room ${roomId} ownership transferred to ${newOwnerId} by owner ${ownerId}`,
    );

    return {
      success: true,
      message: "تم نقل ملكية الغرفة",
      data: { roomId, oldOwnerId, newOwnerId },
    };
  }

  // ================================
  // 6. SECURITY & LOGGING
  // ================================

  /**
   * Get security logs
   */
  async getSecurityLogs(
    page = 1,
    limit = 100,
    filters?: { action?: string; userId?: string },
  ): Promise<any> {
    const skip = (page - 1) * limit;
    const where: Prisma.AdminActionWhereInput = {};

    if (filters?.action) {
      where.action = filters.action as AdminActionType;
    }

    if (filters?.userId) {
      where.OR = [{ actorId: filters.userId }, { targetId: filters.userId }];
    }

    const [logs, total] = await Promise.all([
      this.prisma.adminAction.findMany({
        where,
        include: {
          actor: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
          target: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.adminAction.count({ where }),
    ]);

    return {
      data: logs,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Get user login history
   */
  async getUserLoginHistory(userId: string): Promise<any[]> {
    const sessions = await this.prisma.refreshToken.findMany({
      where: { userId },
      select: {
        id: true,
        createdAt: true,
        revokedAt: true,
        deviceInfo: true,
        ipAddress: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return sessions;
  }

  // ================================
  // HELPER METHODS
  // ================================

  private async logOwnerAction(
    ownerId: string,
    action: string,
    details: any,
  ): Promise<void> {
    // Log to database as a generic action
    try {
      await this.prisma.adminAction.create({
        data: {
          actorId: ownerId,
          action: AdminActionType.SETTINGS_CHANGED,
          details: { actionType: action, ...details },
        },
      });
    } catch (error) {
      this.logger.error("Failed to log owner action:", error);
    }
  }

  private async broadcastSystemEvent(event: string, data: any): Promise<void> {
    try {
      if (this.redis.isEnabled()) {
        const client = this.redis.getClient();
        if (client) {
          await client.publish(
            "system_events",
            JSON.stringify({ event, data, timestamp: new Date().toISOString() }),
          );
        }
      }
    } catch (error) {
      this.logger.error("Failed to broadcast system event:", error);
    }
  }
}
