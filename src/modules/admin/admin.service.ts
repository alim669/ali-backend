/**
 * Admin Service - خدمة إدارة النظام
 * تحتوي على جميع العمليات الإدارية
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { CacheService } from '../../common/cache/cache.service';
import { UserStatus, UserRole, AdminActionType, Prisma } from '@prisma/client';

export interface DashboardStats {
  users: {
    total: number;
    active: number;
    banned: number;
    suspended: number;
    newToday: number;
    newThisWeek: number;
  };
  rooms: {
    total: number;
    active: number;
    closed: number;
  };
  messages: {
    total: number;
    today: number;
  };
  gifts: {
    total: number;
    today: number;
    totalValue: number;
  };
  revenue: {
    today: number;
    thisWeek: number;
    thisMonth: number;
  };
}

export interface UserQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  status?: UserStatus;
  role?: UserRole;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private cache: CacheService,
  ) {}

  private toBigInt(amount: number) {
    if (!Number.isFinite(amount)) {
      throw new BadRequestException('قيمة غير صالحة');
    }
    return BigInt(Math.trunc(amount));
  }

  private toNumber(value: bigint | number | null | undefined) {
    if (value === null || value === undefined) return 0;
    return typeof value === 'bigint' ? Number(value) : value;
  }

  private toPrismaBigInt(value: bigint) {
    return value as unknown as number;
  }

  // ================================
  // DASHBOARD
  // ================================

  async getDashboardStats(): Promise<DashboardStats> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const [
      totalUsers,
      activeUsers,
      bannedUsers,
      suspendedUsers,
      newUsersToday,
      newUsersThisWeek,
      totalRooms,
      activeRooms,
      closedRooms,
      totalMessages,
      messagesToday,
      totalGifts,
      giftsToday,
      totalGiftValue,
      revenueToday,
      revenueThisWeek,
      revenueThisMonth,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { status: 'BANNED' } }),
      this.prisma.user.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.user.count({ where: { createdAt: { gte: today } } }),
      this.prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      this.prisma.room.count(),
      this.prisma.room.count({ where: { status: 'ACTIVE' } }),
      this.prisma.room.count({ where: { status: 'CLOSED' } }),
      this.prisma.message.count(),
      this.prisma.message.count({ where: { createdAt: { gte: today } } }),
      this.prisma.giftSend.count(),
      this.prisma.giftSend.count({ where: { createdAt: { gte: today } } }),
      this.prisma.giftSend.aggregate({ _sum: { totalPrice: true } }),
      this.prisma.walletTransaction.aggregate({
        where: {
          type: { in: ['DEPOSIT', 'PURCHASE'] },
          status: 'COMPLETED',
          createdAt: { gte: today },
        },
        _sum: { amount: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: {
          type: { in: ['DEPOSIT', 'PURCHASE'] },
          status: 'COMPLETED',
          createdAt: { gte: weekAgo },
        },
        _sum: { amount: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: {
          type: { in: ['DEPOSIT', 'PURCHASE'] },
          status: 'COMPLETED',
          createdAt: { gte: monthAgo },
        },
        _sum: { amount: true },
      }),
    ]);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        banned: bannedUsers,
        suspended: suspendedUsers,
        newToday: newUsersToday,
        newThisWeek: newUsersThisWeek,
      },
      rooms: {
        total: totalRooms,
        active: activeRooms,
        closed: closedRooms,
      },
      messages: {
        total: totalMessages,
        today: messagesToday,
      },
      gifts: {
        total: totalGifts,
        today: giftsToday,
        totalValue: totalGiftValue._sum.totalPrice || 0,
      },
      revenue: {
        today: this.toNumber(revenueToday._sum.amount),
        thisWeek: this.toNumber(revenueThisWeek._sum.amount),
        thisMonth: this.toNumber(revenueThisMonth._sum.amount),
      },
    };
  }

  // ================================
  // USER MANAGEMENT
  // ================================

  async getUsers(query: UserQueryDto) {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      role,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const skip = (page - 1) * limit;
    const where: Prisma.UserWhereInput = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.status = status;
    }

    if (role) {
      where.role = role;
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          numericId: true,
          email: true,
          username: true,
          displayName: true,
          avatar: true,
          role: true,
          status: true,
          isVIP: true,
          vipExpiresAt: true,
          emailVerified: true,
          lastLoginAt: true,
          createdAt: true,
          _count: {
            select: {
              ownedRooms: true,
              giftsSent: true,
              giftsReceived: true,
            },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users.map((user) => ({
        ...user,
        numericId: user.numericId.toString(),
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallet: true,
        _count: {
          select: {
            ownedRooms: true,
            giftsSent: true,
            giftsReceived: true,
            following: true,
            followers: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    return {
      ...user,
      numericId: user.numericId.toString(),
    };
  }

  async banUser(
    adminId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    if (user.role === 'SUPER_ADMIN') {
      throw new ForbiddenException('لا يمكن حظر مدير عام');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: 'BANNED' },
      });

      await tx.adminAction.create({
        data: {
          actorId: adminId,
          targetId: userId,
          action: AdminActionType.USER_BANNED,
          reason,
        },
      });

      // Revoke all refresh tokens
      await tx.refreshToken.updateMany({
        where: { userId },
        data: { revokedAt: new Date() },
      });
    });

    // Invalidate cache
    await this.cache.invalidate(`cache:user:${userId}`);

    this.logger.log(`User ${userId} banned by admin ${adminId}`);
  }

  async unbanUser(adminId: string, userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: 'ACTIVE' },
      });

      await tx.adminAction.create({
        data: {
          actorId: adminId,
          targetId: userId,
          action: AdminActionType.USER_UNBANNED,
        },
      });
    });

    await this.cache.invalidate(`cache:user:${userId}`);

    this.logger.log(`User ${userId} unbanned by admin ${adminId}`);
  }

  async suspendUser(
    adminId: string,
    userId: string,
    reason: string,
    duration: number, // hours
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
      throw new ForbiddenException('لا يمكن تعليق مدير');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: 'SUSPENDED' },
      });

      await tx.adminAction.create({
        data: {
          actorId: adminId,
          targetId: userId,
          action: AdminActionType.USER_SUSPENDED,
          reason,
          details: { duration },
        },
      });
    });

    await this.cache.invalidate(`cache:user:${userId}`);

    this.logger.log(`User ${userId} suspended for ${duration}h by admin ${adminId}`);
  }

  async updateUserRole(
    adminId: string,
    userId: string,
    newRole: UserRole,
  ): Promise<void> {
    const [admin, user] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: adminId } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);

    if (!admin) {
      throw new NotFoundException('المدير غير موجود');
    }

    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    // Only SUPER_ADMIN can change roles
    if (admin.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('فقط المدير العام يمكنه تغيير الصلاحيات');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { role: newRole },
    });

    await this.cache.invalidate(`cache:user:${userId}`);

    this.logger.log(`User ${userId} role changed to ${newRole} by admin ${adminId}`);
  }

  // ================================
  // WALLET MANAGEMENT
  // ================================

  async adjustUserBalance(
    adminId: string,
    userId: string,
    amount: number,
    reason: string,
  ): Promise<void> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('المحفظة غير موجودة');
    }

    const amountBig = this.toBigInt(amount);
    const walletBalance = wallet.balance as unknown as bigint;
    if (amountBig < 0n && walletBalance + amountBig < 0n) {
      throw new BadRequestException('الرصيد غير كافٍ');
    }

    await this.prisma.$transaction(async (tx) => {
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { increment: this.toPrismaBigInt(amountBig) },
          version: { increment: 1 },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'ADMIN_ADJUSTMENT',
          status: 'COMPLETED',
          amount: this.toPrismaBigInt(amountBig),
          balanceBefore: wallet.balance,
          balanceAfter: updatedWallet.balance,
          description: reason,
          metadata: { adminId },
        },
      });

      await tx.adminAction.create({
        data: {
          actorId: adminId,
          targetId: userId,
          action: AdminActionType.WALLET_ADJUSTED,
          reason,
          details: { amount, newBalance: this.toNumber(updatedWallet.balance) },
        },
      });
    });

    await this.cache.invalidate(`cache:wallet:${userId}`);

    this.logger.log(`Wallet adjusted for user ${userId}: ${amount} by admin ${adminId}`);
  }

  // ================================
  // ROOM MANAGEMENT
  // ================================

  async closeRoom(adminId: string, roomId: string, reason: string): Promise<void> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      throw new NotFoundException('الغرفة غير موجودة');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.room.update({
        where: { id: roomId },
        data: { status: 'CLOSED' },
      });

      await tx.adminAction.create({
        data: {
          actorId: adminId,
          action: AdminActionType.ROOM_CLOSED,
          reason,
          details: { roomId, roomName: room.name },
        },
      });
    });

    // Notify room members via Redis pub/sub
    if (this.redis.isEnabled()) {
      await this.redis.publish('room_events', JSON.stringify({
        type: 'room_closed',
        roomId,
        reason,
      }));
    }

    this.logger.log(`Room ${roomId} closed by admin ${adminId}`);
  }

  // ================================
  // ADMIN ACTIONS LOG
  // ================================

  async getAdminActions(page = 1, limit = 50, actorId?: string, action?: AdminActionType) {
    const skip = (page - 1) * limit;
    const where: Prisma.AdminActionWhereInput = {};

    if (actorId) {
      where.actorId = actorId;
    }

    if (action) {
      where.action = action;
    }

    const [actions, total] = await Promise.all([
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
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.adminAction.count({ where }),
    ]);

    return {
      data: actions,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ================================
  // ONLINE USERS
  // ================================

  async getOnlineUsers() {
    let onlineCount = 0;
    let onlineUserIds: string[] = [];

    if (this.redis.isEnabled()) {
      const client = this.redis.getClient();
      if (client) {
        const keys = await client.keys('presence:user:*');
        onlineCount = keys.length;
        onlineUserIds = keys.map((key) => key.replace('presence:user:', ''));
      }
    }

    return {
      onlineCount,
      onlineUserIds: onlineUserIds.slice(0, 100), // Limit to 100
    };
  }

  // ================================
  // REPORTS
  // ================================

  async getPendingReports(page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [reports, total] = await Promise.all([
      this.prisma.report.findMany({
        where: { status: 'PENDING' },
        include: {
          reporter: {
            select: {
              id: true,
              username: true,
              displayName: true,
            },
          },
          reportedUser: {
            select: {
              id: true,
              username: true,
              displayName: true,
            },
          },
          reportedRoom: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.report.count({ where: { status: 'PENDING' } }),
    ]);

    return {
      data: reports,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async resolveReport(
    adminId: string,
    reportId: string,
    resolution: string,
    status: 'RESOLVED' | 'DISMISSED',
  ): Promise<void> {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundException('البلاغ غير موجود');
    }

    await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status,
        resolution,
        resolvedById: adminId,
        resolvedAt: new Date(),
      },
    });

    this.logger.log(`Report ${reportId} ${status} by admin ${adminId}`);
  }
}
