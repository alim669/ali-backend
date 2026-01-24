import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { NameIconsService } from './name-icons.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { UserRole } from '@prisma/client';

@Controller('name-icons')
export class NameIconsController {
  constructor(private readonly nameIconsService: NameIconsService) {}

  // ==================== PUBLIC ENDPOINTS ====================

  /**
   * GET /api/v1/name-icons
   * الحصول على جميع الأيقونات المتاحة
   */
  @Public()
  @Get()
  async getAvailableIcons() {
    const icons = await this.nameIconsService.getAvailableIcons();
    return {
      success: true,
      data: icons,
    };
  }

  /**
   * GET /api/v1/name-icons/user/:userId
   * الحصول على أيقونة مستخدم معين (للعرض العام)
   */
  @Public()
  @Get('user/:userId')
  async getUserIcon(@Param('userId') userId: string) {
    const icon = await this.nameIconsService.getUserActiveIcon(userId);
    return {
      success: true,
      data: icon,
    };
  }

  // ==================== AUTHENTICATED ENDPOINTS ====================

  /**
   * GET /api/v1/name-icons/my
   * الحصول على أيقونتي النشطة
   */
  @Get('my')
  @UseGuards(JwtAuthGuard)
  async getMyActiveIcon(@Req() req: any) {
    const icon = await this.nameIconsService.getUserActiveIcon(req.user.id);
    return {
      success: true,
      data: icon,
    };
  }

  /**
   * GET /api/v1/name-icons/my/all
   * الحصول على جميع أيقوناتي
   */
  @Get('my/all')
  @UseGuards(JwtAuthGuard)
  async getMyIcons(@Req() req: any) {
    const icons = await this.nameIconsService.getUserIcons(req.user.id);
    return {
      success: true,
      data: icons,
    };
  }

  /**
   * POST /api/v1/name-icons/purchase/:iconId
   * شراء أيقونة
   */
  @Post('purchase/:iconId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async purchaseIcon(@Req() req: any, @Param('iconId') iconId: string) {
    const result = await this.nameIconsService.purchaseIcon(req.user.id, iconId);
    return result;
  }

  /**
   * PUT /api/v1/name-icons/toggle/:userIconId
   * تفعيل/إلغاء تفعيل أيقونة
   */
  @Put('toggle/:userIconId')
  @UseGuards(JwtAuthGuard)
  async toggleIcon(@Req() req: any, @Param('userIconId') userIconId: string) {
    const result = await this.nameIconsService.toggleIcon(req.user.id, userIconId);
    return result;
  }

  // ==================== ADMIN ENDPOINTS ====================

  /**
   * POST /api/v1/name-icons/admin/create
   * إنشاء أيقونة جديدة
   */
  @Post('admin/create')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async createIcon(
    @Body()
    body: {
      name: string;
      displayName: string;
      assetPath: string;
      price?: number;
      durationDays?: number;
      sortOrder?: number;
    },
  ) {
    const icon = await this.nameIconsService.createIcon(body);
    return {
      success: true,
      data: icon,
    };
  }

  /**
   * PUT /api/v1/name-icons/admin/:iconId
   * تعديل أيقونة
   */
  @Put('admin/:iconId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async updateIcon(
    @Param('iconId') iconId: string,
    @Body()
    body: {
      displayName?: string;
      price?: number;
      durationDays?: number;
      isActive?: boolean;
      sortOrder?: number;
    },
  ) {
    const icon = await this.nameIconsService.updateIcon(iconId, body);
    return {
      success: true,
      data: icon,
    };
  }

  /**
   * DELETE /api/v1/name-icons/admin/:iconId
   * حذف أيقونة
   */
  @Delete('admin/:iconId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async deleteIcon(@Param('iconId') iconId: string) {
    await this.nameIconsService.deleteIcon(iconId);
    return {
      success: true,
      message: 'تم حذف الأيقونة',
    };
  }

  /**
   * POST /api/v1/name-icons/admin/seed
   * إضافة الأيقونات الافتراضية
   */
  @Post('admin/seed')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async seedDefaultIcons() {
    const result = await this.nameIconsService.seedDefaultIcons();
    return {
      success: true,
      ...result,
    };
  }
}
