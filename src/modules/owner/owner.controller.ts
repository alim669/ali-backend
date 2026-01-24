/**
 * Owner Controller - كونترولر المالك
 * جميع الـ endpoints الخاصة بالمالك فقط (SUPER_ADMIN)
 * Routes تحت /api/v1/owner/...
 */
import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { OwnerService, LockdownLevel, PunishmentType } from "./owner.service";
import { UserRole } from "@prisma/client";

// ================================
// DTOs
// ================================

class MaintenanceModeDto {
  enabled: boolean;
  message?: string;
}

class LockdownDto {
  level: LockdownLevel;
  reason: string;
}

class FeatureToggleDto {
  featureKey: string;
  enabled: boolean;
}

class AnnouncementDto {
  message: string;
  priority?: "low" | "normal" | "high" | "urgent";
}

class PunishUserDto {
  userId: string;
  type: PunishmentType;
  reason: string;
  duration?: number; // hours
}

class LiftPunishmentDto {
  userId: string;
  type: PunishmentType;
  reason?: string;
}

class AdjustBalanceDto {
  userId: string;
  amount: number;
  reason: string;
}

class EconomyFreezeDto {
  frozen: boolean;
  reason: string;
}

class ReverseGiftDto {
  transactionId: string;
  reason: string;
}

class SetUserRoleDto {
  userId: string;
  role: UserRole;
  reason?: string;
}

class TransferRoomOwnershipDto {
  roomId: string;
  newOwnerId: string;
  reason: string;
}

@ApiTags("owner")
@Controller("owner")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("SUPER_ADMIN")
@ApiBearerAuth()
export class OwnerController {
  private readonly logger = new Logger(OwnerController.name);

  constructor(private readonly ownerService: OwnerService) {}

  // ================================
  // SYSTEM CONTROL
  // ================================

  @Get("system/settings")
  @ApiOperation({ summary: "الحصول على إعدادات النظام" })
  async getSystemSettings() {
    this.logger.log("Owner: Getting system settings");
    return this.ownerService.getSystemSettings();
  }

  @Post("system/maintenance")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "تفعيل/إيقاف وضع الصيانة" })
  async setMaintenanceMode(
    @CurrentUser("id") ownerId: string,
    @Body() dto: MaintenanceModeDto,
  ) {
    this.logger.log(`Owner: Setting maintenance mode: ${dto.enabled}`);
    return this.ownerService.setMaintenanceMode(
      ownerId,
      dto.enabled,
      dto.message,
    );
  }

  @Post("system/lockdown")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "تفعيل الإغلاق الطارئ" })
  async setLockdownLevel(
    @CurrentUser("id") ownerId: string,
    @Body() dto: LockdownDto,
  ) {
    this.logger.log(`Owner: Setting lockdown level: ${dto.level}`);
    return this.ownerService.setLockdownLevel(ownerId, dto.level, dto.reason);
  }

  @Post("system/feature")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "تفعيل/إيقاف ميزة" })
  async toggleFeature(
    @CurrentUser("id") ownerId: string,
    @Body() dto: FeatureToggleDto,
  ) {
    this.logger.log(`Owner: Toggling feature: ${dto.featureKey}`);
    return this.ownerService.toggleFeature(
      ownerId,
      dto.featureKey,
      dto.enabled,
    );
  }

  @Post("system/announcement")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "إرسال إعلان عام" })
  async sendAnnouncement(
    @CurrentUser("id") ownerId: string,
    @Body() dto: AnnouncementDto,
  ) {
    this.logger.log(`Owner: Sending announcement`);
    return this.ownerService.sendGlobalAnnouncement(
      ownerId,
      dto.message,
      dto.priority,
    );
  }

  // ================================
  // USER AUTHORITY (PUNISHMENTS)
  // ================================

  @Post("users/punish")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "معاقبة مستخدم" })
  async punishUser(
    @CurrentUser("id") ownerId: string,
    @Body() dto: PunishUserDto,
  ) {
    this.logger.log(`Owner: Punishing user ${dto.userId} with ${dto.type}`);
    return this.ownerService.punishUser(
      ownerId,
      dto.userId,
      dto.type,
      dto.reason,
      dto.duration,
    );
  }

  @Post("users/lift-punishment")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "رفع العقوبة عن مستخدم" })
  async liftPunishment(
    @CurrentUser("id") ownerId: string,
    @Body() dto: LiftPunishmentDto,
  ) {
    this.logger.log(`Owner: Lifting ${dto.type} from user ${dto.userId}`);
    return this.ownerService.liftPunishment(
      ownerId,
      dto.userId,
      dto.type,
      dto.reason,
    );
  }

  @Post("users/:userId/ban")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "حظر مستخدم" })
  async banUser(
    @CurrentUser("id") ownerId: string,
    @Param("userId") userId: string,
    @Body() body: { reason?: string; durationHours?: number },
  ) {
    this.logger.log(`Owner: Banning user ${userId}`);
    return this.ownerService.punishUser(
      ownerId,
      userId,
      PunishmentType.PERMANENT_BAN,
      body.reason || "حظر من قبل المالك",
      body.durationHours, // ساعات الحظر (اختياري)
    );
  }

  @Post("users/:userId/unban")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "رفع الحظر عن مستخدم" })
  async unbanUser(
    @CurrentUser("id") ownerId: string,
    @Param("userId") userId: string,
  ) {
    this.logger.log(`Owner: Unbanning user ${userId}`);
    return this.ownerService.liftPunishment(
      ownerId,
      userId,
      PunishmentType.PERMANENT_BAN,
    );
  }

  @Post("users/:userId/mute")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "كتم مستخدم" })
  async muteUser(
    @CurrentUser("id") ownerId: string,
    @Param("userId") userId: string,
    @Body() body: { reason: string; duration: number },
  ) {
    this.logger.log(`Owner: Muting user ${userId}`);
    return this.ownerService.punishUser(
      ownerId,
      userId,
      PunishmentType.MUTE,
      body.reason,
      body.duration,
    );
  }

  @Post("users/:userId/unmute")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "رفع الكتم عن مستخدم" })
  async unmuteUser(
    @CurrentUser("id") ownerId: string,
    @Param("userId") userId: string,
  ) {
    this.logger.log(`Owner: Unmuting user ${userId}`);
    return this.ownerService.liftPunishment(ownerId, userId, PunishmentType.MUTE);
  }

  // ================================
  // FINANCIAL CONTROL
  // ================================

  @Get("economy/overview")
  @ApiOperation({ summary: "نظرة عامة على الاقتصاد" })
  async getEconomyOverview() {
    this.logger.log("Owner: Getting economy overview");
    return this.ownerService.getEconomyOverview();
  }

  @Post("economy/adjust-balance")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "تعديل رصيد مستخدم" })
  async adjustBalance(
    @CurrentUser("id") ownerId: string,
    @Body() dto: AdjustBalanceDto,
  ) {
    this.logger.log(`Owner: Adjusting balance for ${dto.userId}: ${dto.amount}`);
    return this.ownerService.adjustBalance(
      ownerId,
      dto.userId,
      dto.amount,
      dto.reason,
    );
  }

  @Post("economy/freeze")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "تجميد/رفع تجميد الاقتصاد" })
  async setEconomyFreeze(
    @CurrentUser("id") ownerId: string,
    @Body() dto: EconomyFreezeDto,
  ) {
    this.logger.log(`Owner: Setting economy freeze: ${dto.frozen}`);
    return this.ownerService.setEconomyFreeze(ownerId, dto.frozen, dto.reason);
  }

  @Post("economy/reverse-gift")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "عكس هدية" })
  async reverseGift(
    @CurrentUser("id") ownerId: string,
    @Body() dto: ReverseGiftDto,
  ) {
    this.logger.log(`Owner: Reversing gift ${dto.transactionId}`);
    return this.ownerService.reverseGift(
      ownerId,
      dto.transactionId,
      dto.reason,
    );
  }

  // ================================
  // ADMIN MANAGEMENT
  // ================================

  @Get("admins")
  @ApiOperation({ summary: "قائمة المشرفين" })
  async getAdminsList() {
    this.logger.log("Owner: Getting admins list");
    return this.ownerService.getAdminsList();
  }

  @Post("users/role")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "تغيير دور مستخدم" })
  async setUserRole(
    @CurrentUser("id") ownerId: string,
    @Body() dto: SetUserRoleDto,
  ) {
    this.logger.log(`Owner: Setting role for ${dto.userId} to ${dto.role}`);
    return this.ownerService.setUserRole(
      ownerId,
      dto.userId,
      dto.role,
      dto.reason,
    );
  }

  @Patch("users/:userId/role")
  @ApiOperation({ summary: "تغيير دور مستخدم (بديل)" })
  async updateUserRole(
    @CurrentUser("id") ownerId: string,
    @Param("userId") userId: string,
    @Body() body: { role: UserRole; reason?: string },
  ) {
    this.logger.log(`Owner: Updating role for ${userId} to ${body.role}`);
    return this.ownerService.setUserRole(ownerId, userId, body.role, body.reason);
  }

  @Post("users/:userId/force-logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "تسجيل خروج إجباري لمستخدم" })
  async forceLogout(
    @CurrentUser("id") ownerId: string,
    @Param("userId") userId: string,
  ) {
    this.logger.log(`Owner: Force logout user ${userId}`);
    return this.ownerService.forceLogout(ownerId, userId);
  }

  @Post("users/force-logout-all")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "تسجيل خروج إجباري لجميع المستخدمين" })
  async forceLogoutAll(
    @CurrentUser("id") ownerId: string,
    @Body() body: { exceptRoles?: string[] },
  ) {
    this.logger.log("Owner: Force logout all users");
    return this.ownerService.forceLogoutAll(ownerId, body.exceptRoles);
  }

  // ================================
  // ROOM SOVEREIGNTY
  // ================================

  @Post("rooms/:roomId/delete")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "حذف غرفة" })
  async deleteRoom(
    @CurrentUser("id") ownerId: string,
    @Param("roomId") roomId: string,
    @Body("reason") reason: string,
  ) {
    this.logger.log(`Owner: Deleting room ${roomId}`);
    return this.ownerService.deleteRoom(ownerId, roomId, reason);
  }

  @Post("rooms/transfer-ownership")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "نقل ملكية غرفة" })
  async transferRoomOwnership(
    @CurrentUser("id") ownerId: string,
    @Body() dto: TransferRoomOwnershipDto,
  ) {
    this.logger.log(`Owner: Transferring room ${dto.roomId} to ${dto.newOwnerId}`);
    return this.ownerService.transferRoomOwnership(
      ownerId,
      dto.roomId,
      dto.newOwnerId,
      dto.reason,
    );
  }

  // ================================
  // SECURITY & LOGS
  // ================================

  @Get("security/logs")
  @ApiOperation({ summary: "سجلات الأمان" })
  async getSecurityLogs(
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 100,
    @Query("action") action?: string,
    @Query("userId") userId?: string,
  ) {
    this.logger.log("Owner: Getting security logs");
    return this.ownerService.getSecurityLogs(page, limit, { action, userId });
  }

  @Get("users/:userId/login-history")
  @ApiOperation({ summary: "سجل تسجيلات دخول المستخدم" })
  async getUserLoginHistory(@Param("userId") userId: string) {
    this.logger.log(`Owner: Getting login history for ${userId}`);
    return this.ownerService.getUserLoginHistory(userId);
  }
}
