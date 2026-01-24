/**
 * Verification Controller - وحدة تحكم التوثيق
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { VerificationService } from "./verification.service";
import {
  BuyVerificationDto,
  VerificationResponseDto,
  VerificationPackageDto,
  VerificationType,
} from "./dto/verification.dto";

@ApiTags("Verification - التوثيق")
@Controller("verification")
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  // ================================
  // PUBLIC ENDPOINTS
  // ================================

  @Get("packages")
  @ApiOperation({ summary: "الحصول على باقات التوثيق المتاحة" })
  @ApiResponse({
    status: 200,
    description: "قائمة باقات التوثيق",
    type: [VerificationPackageDto],
  })
  getPackages(): VerificationPackageDto[] {
    return this.verificationService.getPackages();
  }

  // ================================
  // AUTHENTICATED ENDPOINTS
  // ================================

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "الحصول على حالة التوثيق الخاصة بي" })
  @ApiResponse({
    status: 200,
    description: "بيانات التوثيق",
    type: VerificationResponseDto,
  })
  async getMyVerification(
    @CurrentUser("id") userId: string,
  ): Promise<VerificationResponseDto | null> {
    return this.verificationService.getUserVerification(userId);
  }

  @Get("user/:userId")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "الحصول على حالة التوثيق لمستخدم معين" })
  @ApiResponse({
    status: 200,
    description: "بيانات التوثيق",
    type: VerificationResponseDto,
  })
  async getUserVerification(
    @Param("userId") userId: string,
  ): Promise<VerificationResponseDto | null> {
    return this.verificationService.getUserVerification(userId);
  }

  @Post("buy")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "شراء توثيق جديد" })
  @ApiResponse({
    status: 200,
    description: "تم شراء التوثيق بنجاح",
    type: VerificationResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "رصيد غير كافٍ أو نوع توثيق غير صالح",
  })
  @ApiResponse({
    status: 409,
    description: "لديك توثيق فعال بالفعل",
  })
  async buyVerification(
    @CurrentUser("id") userId: string,
    @Body() dto: BuyVerificationDto,
  ): Promise<VerificationResponseDto> {
    return this.verificationService.buyVerification(
      userId,
      dto.type,
      dto.idempotencyKey,
    );
  }

  // ================================
  // ADMIN ENDPOINTS
  // ================================

  @Post("admin/grant/:userId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN", "OWNER")
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "[Admin] منح توثيق لمستخدم" })
  @ApiResponse({
    status: 200,
    description: "تم منح التوثيق بنجاح",
    type: VerificationResponseDto,
  })
  async adminGrantVerification(
    @CurrentUser("id") adminId: string,
    @Param("userId") targetUserId: string,
    @Body() body: { type: VerificationType; durationDays?: number },
  ): Promise<VerificationResponseDto> {
    return this.verificationService.adminGrantVerification(
      targetUserId,
      body.type,
      body.durationDays || 30,
      adminId,
    );
  }

  @Post("admin/revoke/:userId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN", "OWNER")
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "[Admin] إلغاء توثيق مستخدم" })
  @ApiResponse({
    status: 200,
    description: "تم إلغاء التوثيق بنجاح",
  })
  async adminRevokeVerification(
    @CurrentUser("id") adminId: string,
    @Param("userId") targetUserId: string,
    @Body() body: { reason?: string },
  ): Promise<{ success: boolean; message: string }> {
    await this.verificationService.adminRevokeVerification(
      targetUserId,
      adminId,
      body.reason,
    );
    return { success: true, message: "تم إلغاء التوثيق بنجاح" };
  }
}
