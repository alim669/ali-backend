import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';

@Injectable()
export class NameIconsService {
  constructor(
    private prisma: PrismaService,
    private walletsService: WalletsService,
  ) {}

  // ==================== PUBLIC METHODS ====================

  /**
   * الحصول على جميع الأيقونات المتاحة للشراء
   */
  async getAvailableIcons() {
    return this.prisma.nameIcon.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * الحصول على أيقونة المستخدم النشطة
   */
  async getUserActiveIcon(userId: string) {
    const userIcon = await this.prisma.userNameIcon.findFirst({
      where: {
        userId,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      include: { icon: true },
    });

    if (!userIcon) return null;

    return {
      id: userIcon.id,
      iconId: userIcon.iconId,
      name: userIcon.icon.name,
      displayName: userIcon.icon.displayName,
      assetPath: userIcon.icon.assetPath,
      expiresAt: userIcon.expiresAt,
      remainingDays: Math.ceil(
        (userIcon.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      ),
    };
  }

  /**
   * الحصول على جميع أيقونات المستخدم
   */
  async getUserIcons(userId: string) {
    const userIcons = await this.prisma.userNameIcon.findMany({
      where: { userId },
      include: { icon: true },
      orderBy: { createdAt: 'desc' },
    });

    return userIcons.map((ui: { id: string; iconId: string; icon: { name: string; displayName: string; assetPath: string }; isActive: boolean; expiresAt: Date }) => ({
      id: ui.id,
      iconId: ui.iconId,
      name: ui.icon.name,
      displayName: ui.icon.displayName,
      assetPath: ui.icon.assetPath,
      isActive: ui.isActive,
      expiresAt: ui.expiresAt,
      isExpired: ui.expiresAt < new Date(),
      remainingDays: Math.max(
        0,
        Math.ceil((ui.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
      ),
    }));
  }

  /**
   * شراء أيقونة
   */
  async purchaseIcon(userId: string, iconId: string) {
    // الحصول على الأيقونة
    const icon = await this.prisma.nameIcon.findUnique({
      where: { id: iconId },
    });

    if (!icon) {
      throw new NotFoundException('الأيقونة غير موجودة');
    }

    if (!icon.isActive) {
      throw new BadRequestException('هذه الأيقونة غير متاحة حالياً');
    }

    // التحقق من رصيد المستخدم
    const wallet = await this.walletsService.getWallet(userId);
    if (!wallet || Number(wallet.balance) < icon.price) {
      throw new BadRequestException(
        `رصيدك غير كافي. تحتاج ${icon.price} نقطة`,
      );
    }

    // التحقق إذا كان لديه نفس الأيقونة نشطة
    const existingIcon = await this.prisma.userNameIcon.findFirst({
      where: {
        userId,
        iconId,
        expiresAt: { gt: new Date() },
      },
    });

    // خصم النقاط
    await this.walletsService.deduct(userId, {
      amount: icon.price,
      type: 'coins',
      reason: 'شراء أيقونة الاسم',
    });

    if (existingIcon) {
      // تمديد المدة
      const newExpiresAt = new Date(existingIcon.expiresAt);
      newExpiresAt.setDate(newExpiresAt.getDate() + icon.durationDays);

      // إلغاء تفعيل الأيقونات الأخرى
      await this.prisma.userNameIcon.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false },
      });

      const updated = await this.prisma.userNameIcon.update({
        where: { id: existingIcon.id },
        data: {
          expiresAt: newExpiresAt,
          isActive: true,
        },
        include: { icon: true },
      });

      return {
        success: true,
        message: `تم تمديد ${icon.displayName} لمدة ${icon.durationDays} يوم إضافي`,
        userIcon: {
          id: updated.id,
          name: updated.icon.name,
          displayName: updated.icon.displayName,
          assetPath: updated.icon.assetPath,
          expiresAt: updated.expiresAt,
        },
      };
    } else {
      // إنشاء أيقونة جديدة
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + icon.durationDays);

      // إلغاء تفعيل الأيقونات الأخرى
      await this.prisma.userNameIcon.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false },
      });

      const userIcon = await this.prisma.userNameIcon.create({
        data: {
          userId,
          iconId,
          expiresAt,
          isActive: true,
        },
        include: { icon: true },
      });

      return {
        success: true,
        message: `تم شراء ${icon.displayName} لمدة ${icon.durationDays} يوم`,
        userIcon: {
          id: userIcon.id,
          name: userIcon.icon.name,
          displayName: userIcon.icon.displayName,
          assetPath: userIcon.icon.assetPath,
          expiresAt: userIcon.expiresAt,
        },
      };
    }
  }

  /**
   * تفعيل/إلغاء تفعيل أيقونة
   */
  async toggleIcon(userId: string, userIconId: string) {
    const userIcon = await this.prisma.userNameIcon.findFirst({
      where: {
        id: userIconId,
        userId,
      },
      include: { icon: true },
    });

    if (!userIcon) {
      throw new NotFoundException('الأيقونة غير موجودة');
    }

    if (userIcon.expiresAt < new Date()) {
      throw new BadRequestException('انتهت صلاحية هذه الأيقونة');
    }

    if (userIcon.isActive) {
      // إلغاء التفعيل
      await this.prisma.userNameIcon.update({
        where: { id: userIconId },
        data: { isActive: false },
      });

      return {
        success: true,
        message: 'تم إلغاء تفعيل الأيقونة',
        isActive: false,
      };
    } else {
      // تفعيل وإلغاء الأخرى
      await this.prisma.userNameIcon.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false },
      });

      await this.prisma.userNameIcon.update({
        where: { id: userIconId },
        data: { isActive: true },
      });

      return {
        success: true,
        message: `تم تفعيل ${userIcon.icon.displayName}`,
        isActive: true,
      };
    }
  }

  // ==================== ADMIN METHODS ====================

  /**
   * إضافة أيقونة جديدة (للأدمن)
   */
  async createIcon(data: {
    name: string;
    displayName: string;
    assetPath: string;
    price?: number;
    durationDays?: number;
    sortOrder?: number;
  }) {
    return this.prisma.nameIcon.create({
      data: {
        name: data.name,
        displayName: data.displayName,
        assetPath: data.assetPath,
        price: data.price || 80000,
        durationDays: data.durationDays || 30,
        sortOrder: data.sortOrder || 0,
      },
    });
  }

  /**
   * تعديل أيقونة (للأدمن)
   */
  async updateIcon(
    iconId: string,
    data: {
      displayName?: string;
      price?: number;
      durationDays?: number;
      isActive?: boolean;
      sortOrder?: number;
    },
  ) {
    return this.prisma.nameIcon.update({
      where: { id: iconId },
      data,
    });
  }

  /**
   * حذف أيقونة (للأدمن)
   */
  async deleteIcon(iconId: string) {
    return this.prisma.nameIcon.delete({
      where: { id: iconId },
    });
  }

  /**
   * إضافة الأيقونات الافتراضية
   */
  async seedDefaultIcons() {
    const existingIcons = await this.prisma.nameIcon.count();
    if (existingIcons > 0) {
      return { message: 'الأيقونات موجودة مسبقاً' };
    }

    const defaultIcons = [
      {
        name: 'crown',
        displayName: 'التاج الملكي 👑',
        assetPath: 'assets/name_icons/crown.gif',
        price: 80000,
        durationDays: 30,
        sortOrder: 1,
      },
    ];

    for (const icon of defaultIcons) {
      await this.prisma.nameIcon.create({ data: icon });
    }

    return { message: 'تم إضافة الأيقونات الافتراضية', count: defaultIcons.length };
  }
}
