/**
 * VIP Service - خدمة العضويات المميزة
 * إدارة اشتراكات VIP للمستخدمين
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { RedisService } from "../../common/redis/redis.service";
import { CacheService } from "../../common/cache/cache.service";
import { Prisma } from "@prisma/client";

export interface VIPPackage {
  id: string;
  name: string;
  duration: number; // أيام
  price: number;
  features: string[];
}

// باقات VIP المتاحة
export const VIP_PACKAGES: VIPPackage[] = [
  {
    id: "vip_weekly",
    name: "أسبوعي",
    duration: 7,
    price: 100,
    features: [
      "رسائل خاصة غير محدودة",
      "شارة VIP",
      "أولوية في الغرف",
      "إخفاء حالة الاتصال",
    ],
  },
  {
    id: "vip_monthly",
    name: "شهري",
    duration: 30,
    price: 350,
    features: [
      "رسائل خاصة غير محدودة",
      "شارة VIP ذهبية",
      "أولوية في الغرف",
      "إخفاء حالة الاتصال",
      "هدايا حصرية",
      "خصم 10% على الهدايا",
    ],
  },
  {
    id: "vip_quarterly",
    name: "ربع سنوي",
    duration: 90,
    price: 900,
    features: [
      "جميع مزايا الشهري",
      "شارة VIP بلاتينية",
      "خصم 20% على الهدايا",
      "دعم أولوية",
    ],
  },
  {
    id: "vip_yearly",
    name: "سنوي",
    duration: 365,
    price: 3000,
    features: [
      "جميع مزايا الربع سنوي",
      "شارة VIP ماسية",
      "خصم 30% على الهدايا",
      "هدية ترحيبية 500 عملة",
    ],
  },
];

@Injectable()
export class VIPService {
  private readonly logger = new Logger(VIPService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private cache: CacheService,
  ) {}
  
  private toBigInt(amount: number) {
    if (!Number.isFinite(amount)) {
      throw new BadRequestException("قيمة غير صالحة");
    }
    return BigInt(Math.trunc(amount));
  }
  
  private toNumber(value: bigint | number | null | undefined) {
    if (value === null || value === undefined) return 0;
    return typeof value === "bigint" ? Number(value) : value;
  }

  private toPrismaBigInt(value: bigint) {
    return value as unknown as number;
  }

  // ================================
  // GET VIP PACKAGES
  // ================================

  getPackages(): VIPPackage[] {
    return VIP_PACKAGES;
  }

  getPackageById(packageId: string): VIPPackage | undefined {
    return VIP_PACKAGES.find((p) => p.id === packageId);
  }

  // ================================
  // CHECK VIP STATUS
  // ================================

  async getVIPStatus(userId: string) {
    // Try cache first
    const cacheKey = `vip:status:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isVIP: true,
        vipExpiresAt: true,
        role: true,
      },
    });

    if (!user) {
      throw new NotFoundException("المستخدم غير موجود");
    }

    const now = new Date();
    const isActive =
      user.isVIP && (!user.vipExpiresAt || new Date(user.vipExpiresAt) > now);
    const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";

    const status = {
      isVIP: isActive || isAdmin,
      isAdmin,
      expiresAt: user.vipExpiresAt,
      daysRemaining: user.vipExpiresAt
        ? Math.max(
            0,
            Math.ceil(
              (new Date(user.vipExpiresAt).getTime() - now.getTime()) /
                (1000 * 60 * 60 * 24),
            ),
          )
        : null,
    };

    // Cache for 5 minutes
    await this.redis.set(cacheKey, JSON.stringify(status), 300);

    return status;
  }

  // ================================
  // PURCHASE VIP
  // ================================

  async purchaseVIP(userId: string, packageId: string) {
    const pkg = this.getPackageById(packageId);
    if (!pkg) {
      throw new BadRequestException("الباقة غير موجودة");
    }

    // Get user's wallet
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException("المحفظة غير موجودة");
    }
    const price = this.toBigInt(pkg.price);
    const priceInput = this.toPrismaBigInt(price);
    if (wallet.balance < price) {
      throw new BadRequestException("رصيد غير كافي");
    }

    // Calculate new expiry date
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isVIP: true, vipExpiresAt: true },
    });

    let newExpiryDate: Date;
    if (user?.isVIP && user.vipExpiresAt && new Date(user.vipExpiresAt) > new Date()) {
      // Extend existing VIP
      newExpiryDate = new Date(user.vipExpiresAt);
      newExpiryDate.setDate(newExpiryDate.getDate() + pkg.duration);
    } else {
      // New VIP subscription
      newExpiryDate = new Date();
      newExpiryDate.setDate(newExpiryDate.getDate() + pkg.duration);
    }

    // Transaction: deduct balance and activate VIP
    const result = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Deduct from wallet
        const updatedWallet = await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: { decrement: priceInput },
            version: { increment: 1 },
          },
        });

        // Record transaction
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "PURCHASE",
            status: "COMPLETED",
            amount: this.toPrismaBigInt(-price),
            balanceBefore: wallet.balance,
            balanceAfter: updatedWallet.balance,
            description: `شراء باقة VIP: ${pkg.name}`,
            metadata: {
              packageId: pkg.id,
              packageName: pkg.name,
              duration: pkg.duration,
            },
          },
        });

        // Activate VIP
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: {
            isVIP: true,
            vipExpiresAt: newExpiryDate,
          },
          select: {
            id: true,
            isVIP: true,
            vipExpiresAt: true,
          },
        });

        return { wallet: updatedWallet, user: updatedUser };
      },
    );

    // Clear cache
    await this.redis.del(`vip:status:${userId}`);
    await this.cache.invalidateUser(userId);

    this.logger.log(
      `User ${userId} purchased VIP package ${pkg.name} until ${newExpiryDate}`,
    );

    return {
      success: true,
      message: `تم تفعيل باقة ${pkg.name} بنجاح`,
      newBalance: this.toNumber(result.wallet.balance),
      vipExpiresAt: result.user.vipExpiresAt,
      package: pkg,
    };
  }

  // ================================
  // GRANT VIP (Admin)
  // ================================

  async grantVIP(userId: string, days: number, adminId: string, reason?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isVIP: true, vipExpiresAt: true },
    });

    if (!user) {
      throw new NotFoundException("المستخدم غير موجود");
    }

    let newExpiryDate: Date;
    if (user.isVIP && user.vipExpiresAt && new Date(user.vipExpiresAt) > new Date()) {
      newExpiryDate = new Date(user.vipExpiresAt);
      newExpiryDate.setDate(newExpiryDate.getDate() + days);
    } else {
      newExpiryDate = new Date();
      newExpiryDate.setDate(newExpiryDate.getDate() + days);
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          isVIP: true,
          vipExpiresAt: newExpiryDate,
        },
      }),
      this.prisma.adminAction.create({
        data: {
          actorId: adminId,
          targetId: userId,
          action: "WALLET_ADJUSTED", // Using existing action type
          reason: reason || `منح VIP لمدة ${days} يوم`,
          details: { type: "VIP_GRANT", days, newExpiryDate },
        },
      }),
    ]);

    // Clear cache
    await this.redis.del(`vip:status:${userId}`);
    await this.cache.invalidateUser(userId);

    this.logger.log(`Admin ${adminId} granted ${days} days VIP to user ${userId}`);

    return {
      success: true,
      message: `تم منح VIP لمدة ${days} يوم`,
      vipExpiresAt: newExpiryDate,
    };
  }

  // ================================
  // REVOKE VIP (Admin)
  // ================================

  async revokeVIP(userId: string, adminId: string, reason?: string) {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          isVIP: false,
          vipExpiresAt: null,
        },
      }),
      this.prisma.adminAction.create({
        data: {
          actorId: adminId,
          targetId: userId,
          action: "WALLET_ADJUSTED",
          reason: reason || "إلغاء VIP",
          details: { type: "VIP_REVOKE" },
        },
      }),
    ]);

    // Clear cache
    await this.redis.del(`vip:status:${userId}`);
    await this.cache.invalidateUser(userId);

    this.logger.log(`Admin ${adminId} revoked VIP from user ${userId}`);

    return {
      success: true,
      message: "تم إلغاء VIP",
    };
  }

  // ================================
  // CHECK EXPIRED VIPs (Cron job)
  // ================================

  async checkExpiredVIPs(): Promise<number> {
    const result = await this.prisma.user.updateMany({
      where: {
        isVIP: true,
        vipExpiresAt: {
          lt: new Date(),
        },
      },
      data: {
        isVIP: false,
      },
    });

    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} VIP subscriptions`);
    }

    return result.count;
  }

  // ================================
  // GET VIP USERS (Admin)
  // ================================

  async getVIPUsers(page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          isVIP: true,
        },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatar: true,
          isVIP: true,
          vipExpiresAt: true,
          createdAt: true,
        },
        orderBy: { vipExpiresAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where: { isVIP: true } }),
    ]);

    return {
      users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
