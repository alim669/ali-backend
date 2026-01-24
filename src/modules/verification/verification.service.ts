/**
 * Verification Service - خدمة توثيق الحسابات
 * نظام شارات التوثيق الاحترافي
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { RedisService } from "../../common/redis/redis.service";
import { CacheService } from "../../common/cache/cache.service";
import {
  VerificationType,
  VerificationResponseDto,
  VerificationPackageDto,
} from "./dto/verification.dto";
import { TransactionType, TransactionStatus } from "@prisma/client";

// باقات التوثيق المتاحة
export const VERIFICATION_PACKAGES: VerificationPackageDto[] = [
  {
    id: "verification_blue",
    type: VerificationType.BLUE,
    name: "التوثيق الأزرق",
    description: "علامة التوثيق الرسمية - للحسابات الموثوقة",
    price: 5000,
    duration: 30,
    color: "#1E88E5",
    features: [
      "علامة ✓ زرقاء متحركة بجانب الاسم",
      "ظهور في جميع الغرف والدردشات",
      "شارة رسمية في الملف الشخصي",
      "أولوية في نتائج البحث",
    ],
  },
  {
    id: "verification_gold",
    type: VerificationType.GOLD,
    name: "التوثيق الذهبي VIP",
    description: "شارة VIP الذهبية الفاخرة - للمستخدمين المميزين",
    price: 15000,
    duration: 30,
    color: "#FFB300",
    features: [
      "شارة ذهبية متوهجة بجانب الاسم",
      "تأثيرات shimmer و glow فاخرة",
      "ظهور مميز في قائمة الأعضاء",
      "إطار ذهبي في الملف الشخصي",
      "أولوية قصوى في البحث",
    ],
  },
  {
    id: "verification_purple",
    type: VerificationType.PURPLE,
    name: "التوثيق الملكي",
    description: "الشارة الملكية البنفسجية - للنخبة",
    price: 25000,
    duration: 30,
    color: "#9C27B0",
    features: [
      "شارة ملكية بنفسجية متحركة",
      "هالة طاقة ملكية حول الشارة",
      "ظهور حصري في أعلى القوائم",
      "إطار ملكي في الملف الشخصي",
      "دعم أولوية من الإدارة",
    ],
  },
  {
    id: "verification_diamond",
    type: VerificationType.DIAMOND,
    name: "التوثيق الماسي",
    description: "الشارة الأسطورية الماسية - للأساطير فقط",
    price: 50000,
    duration: 30,
    color: "#00BCD4",
    features: [
      "شارة ماسية متلألئة بتأثيرات sparkle",
      "انعكاسات ضوئية ديناميكية",
      "ظهور أسطوري في جميع الواجهات",
      "إطار ماسي حصري",
      "شارة نادرة ومميزة",
      "دعم VIP حصري",
    ],
  },
  {
    id: "verification_vip",
    type: VerificationType.VIP,
    name: "توثيق VIP",
    description: "شارة VIP متحركة حصرية",
    price: 60000,
    duration: 30,
    color: "#FF6B00",
    features: [
      "🎬 شارة VIP متحركة بالفيديو",
      "تصميم حصري ومميز",
      "ظهور مميز جداً في الغرف",
      "تأثيرات بصرية مذهلة",
      "أولوية VIP في كل مكان",
    ],
  },
  {
    id: "verification_verified",
    type: VerificationType.VERIFIED,
    name: "التوثيق الرسمي",
    description: "علامة التوثيق الأصلية مثل فيسبوك وانستغرام",
    price: 75000,
    duration: 30,
    color: "#0095F6",
    features: [
      "✓ علامة التوثيق الكلاسيكية الزرقاء",
      "تصميم احترافي مثل فيسبوك وانستغرام",
      "ظهور مميز في كل مكان",
      "مصداقية عالية للحساب",
      "أولوية في الظهور والبحث",
    ],
  },
  {
    id: "verification_official",
    type: VerificationType.OFFICIAL,
    name: "الحساب الرسمي",
    description: "للمؤسسات والشركات والحسابات الرسمية",
    price: 100000,
    duration: 30,
    color: "#6C757D",
    features: [
      "🏢 شارة الحساب الرسمي",
      "علامة مميزة للمؤسسات",
      "ظهور احترافي في كل مكان",
      "مصداقية مؤسسية",
      "دعم أولوية للحسابات الرسمية",
    ],
  },
  {
    id: "verification_celebrity",
    type: VerificationType.CELEBRITY,
    name: "توثيق المشاهير",
    description: "للمشاهير والشخصيات العامة",
    price: 150000,
    duration: 30,
    color: "#E91E63",
    features: [
      "⭐ شارة المشاهير الحصرية",
      "تصميم فريد للشخصيات العامة",
      "ظهور في أعلى القوائم",
      "إطار مميز في الملف الشخصي",
      "دعم VIP حصري للمشاهير",
      "ميزات خاصة للتفاعل مع المعجبين",
    ],
  },
];

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

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
  // GET VERIFICATION PACKAGES
  // ================================

  getPackages(): VerificationPackageDto[] {
    return VERIFICATION_PACKAGES;
  }

  getPackageByType(type: VerificationType): VerificationPackageDto | undefined {
    return VERIFICATION_PACKAGES.find((p) => p.type === type);
  }

  // ================================
  // GET USER VERIFICATION
  // ================================

  async getUserVerification(
    userId: string,
  ): Promise<VerificationResponseDto | null> {
    // Try cache first
    const cacheKey = `verification:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as VerificationResponseDto;
    }

    const verification = await this.prisma.verification.findUnique({
      where: { userId },
    });

    if (!verification) {
      return null;
    }

    const now = new Date();
    const isActive = verification.expiresAt > now;
    const daysRemaining = isActive
      ? Math.ceil(
          (verification.expiresAt.getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : 0;

    const response: VerificationResponseDto = {
      id: verification.id,
      userId: verification.userId,
      type: verification.type as VerificationType,
      expiresAt: verification.expiresAt,
      isActive,
      daysRemaining,
      createdAt: verification.createdAt,
    };

    // Cache for 5 minutes if active
    if (isActive) {
      await this.redis.set(cacheKey, JSON.stringify(response), 300);
    }

    return response;
  }

  // ================================
  // BUY VERIFICATION
  // ================================

  async buyVerification(
    userId: string,
    type: VerificationType,
    idempotencyKey?: string,
  ): Promise<VerificationResponseDto> {
    // Check idempotency
    if (idempotencyKey) {
      const existingKey = `verification:idempotency:${idempotencyKey}`;
      const exists = await this.redis.get(existingKey);
      if (exists) {
        throw new ConflictException("هذا الطلب تم معالجته مسبقاً");
      }
    }

    // Get package
    const packageInfo = this.getPackageByType(type);
    if (!packageInfo) {
      throw new BadRequestException("نوع التوثيق غير صالح");
    }

    // Check if user already has active verification
    const existingVerification = await this.prisma.verification.findUnique({
      where: { userId },
    });

    if (existingVerification && existingVerification.expiresAt > new Date()) {
      throw new ConflictException(
        "لديك توثيق فعال بالفعل. انتظر حتى انتهاء صلاحيته للتجديد.",
      );
    }

    // Get user wallet
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException("المحفظة غير موجودة");
    }

    const price = this.toBigInt(packageInfo.price);
    const priceInput = this.toPrismaBigInt(price);
    if (wallet.balance < price) {
      throw new BadRequestException(
        `رصيد غير كافٍ. تحتاج ${packageInfo.price} نقطة ولديك ${this.toNumber(wallet.balance)} نقطة فقط.`,
      );
    }

    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + packageInfo.duration);

    // Transaction: Deduct balance + Create/Update verification
    const result = await this.prisma.$transaction(async (tx) => {
      // Deduct from wallet
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { decrement: priceInput },
          version: { increment: 1 },
        },
      });

      // Create wallet transaction
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: TransactionType.PURCHASE,
          status: TransactionStatus.COMPLETED,
          amount: this.toPrismaBigInt(-price),
          balanceBefore: wallet.balance,
          balanceAfter: updatedWallet.balance,
          description: `شراء ${packageInfo.name}`,
          metadata: {
            verificationType: type,
            duration: packageInfo.duration,
          },
        },
      });

      // Upsert verification (create or update)
      const verification = await tx.verification.upsert({
        where: { userId },
        create: {
          userId,
          type,
          price: packageInfo.price,
          expiresAt,
        },
        update: {
          type,
          price: packageInfo.price,
          expiresAt,
        },
      });

      return { verification, wallet: updatedWallet };
    });

    // Store idempotency key
    if (idempotencyKey) {
      await this.redis.set(
        `verification:idempotency:${idempotencyKey}`,
        "1",
        86400,
      );
    }

    // Clear cache
    await this.redis.del(`verification:${userId}`);
    await this.cache.invalidateUser(userId);

    // Publish verification update event
    await this.redis.publish("verification:updated", {
      type: "verification_updated",
      data: {
        userId,
        verificationType: type,
        expiresAt: expiresAt.toISOString(),
        newBalance: this.toNumber(result.wallet.balance),
      },
    });

    this.logger.log(
      `✅ Verification purchased: ${type} for user ${userId}, expires: ${expiresAt.toISOString()}`,
    );

    return {
      id: result.verification.id,
      userId: result.verification.userId,
      type: result.verification.type as VerificationType,
      expiresAt: result.verification.expiresAt,
      isActive: true,
      daysRemaining: packageInfo.duration,
      createdAt: result.verification.createdAt,
    };
  }

  // ================================
  // CLEANUP EXPIRED VERIFICATIONS
  // ================================

  async cleanupExpiredVerifications(): Promise<number> {
    const now = new Date();

    // Get expired verifications for socket notification
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

    // Clear cache and notify for each expired verification
    for (const verification of expiredVerifications) {
      await this.redis.del(`verification:${verification.userId}`);
      await this.cache.invalidateUser(verification.userId);

      // Publish expiration event
      await this.redis.publish("verification:expired", {
        type: "verification_expired",
        data: {
          userId: verification.userId,
          verificationType: verification.type,
        },
      });
    }

    this.logger.log(
      `🧹 Cleaned up ${result.count} expired verifications`,
    );

    return result.count;
  }

  // ================================
  // CHECK IF USER IS VERIFIED
  // ================================

  async isUserVerified(userId: string): Promise<boolean> {
    const verification = await this.getUserVerification(userId);
    return verification !== null && verification.isActive;
  }

  // ================================
  // GET VERIFICATION TYPE FOR USER
  // ================================

  async getVerificationType(
    userId: string,
  ): Promise<VerificationType | null> {
    const verification = await this.getUserVerification(userId);
    return verification?.isActive ? verification.type : null;
  }

  // ================================
  // ADMIN: GRANT VERIFICATION
  // ================================

  async adminGrantVerification(
    targetUserId: string,
    type: VerificationType,
    durationDays: number,
    adminId: string,
  ): Promise<VerificationResponseDto> {
    // Verify target user exists
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!user) {
      throw new NotFoundException("المستخدم غير موجود");
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    const verification = await this.prisma.$transaction(async (tx) => {
      const result = await tx.verification.upsert({
        where: { userId: targetUserId },
        create: {
          userId: targetUserId,
          type,
          price: 0, // Granted by admin
          expiresAt,
        },
        update: {
          type,
          price: 0,
          expiresAt,
        },
      });

      // Log admin action
      await tx.adminAction.create({
        data: {
          actorId: adminId,
          targetId: targetUserId,
          action: "SETTINGS_CHANGED",
          details: {
            eventType: "VERIFICATION_GRANTED",
            type,
            durationDays,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });

      return result;
    });

    // Clear cache
    await this.redis.del(`verification:${targetUserId}`);
    await this.cache.invalidateUser(targetUserId);

    // Publish event
    await this.redis.publish("verification:updated", {
      type: "verification_updated",
      data: {
        userId: targetUserId,
        verificationType: type,
        expiresAt: expiresAt.toISOString(),
        grantedBy: adminId,
      },
    });

    this.logger.log(
      `✅ Admin ${adminId} granted ${type} verification to ${targetUserId}`,
    );

    return {
      id: verification.id,
      userId: verification.userId,
      type: verification.type as VerificationType,
      expiresAt: verification.expiresAt,
      isActive: true,
      daysRemaining: durationDays,
      createdAt: verification.createdAt,
    };
  }

  // ================================
  // ADMIN: REVOKE VERIFICATION
  // ================================

  async adminRevokeVerification(
    targetUserId: string,
    adminId: string,
    reason?: string,
  ): Promise<void> {
    const verification = await this.prisma.verification.findUnique({
      where: { userId: targetUserId },
    });

    if (!verification) {
      throw new NotFoundException("التوثيق غير موجود");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.verification.delete({
        where: { userId: targetUserId },
      });

      await tx.adminAction.create({
        data: {
          actorId: adminId,
          targetId: targetUserId,
          action: "SETTINGS_CHANGED",
          reason,
          details: {
            eventType: "VERIFICATION_REVOKED",
            previousType: verification.type,
            previousExpiry: verification.expiresAt.toISOString(),
          },
        },
      });
    });

    // Clear cache
    await this.redis.del(`verification:${targetUserId}`);
    await this.cache.invalidateUser(targetUserId);

    // Publish event
    await this.redis.publish("verification:revoked", {
      type: "verification_revoked",
      data: {
        userId: targetUserId,
        revokedBy: adminId,
        reason,
      },
    });

    this.logger.log(
      `❌ Admin ${adminId} revoked verification from ${targetUserId}`,
    );
  }
}
