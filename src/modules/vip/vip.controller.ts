/**
 * VIP Controller - إدارة عضويات VIP
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from "@nestjs/swagger";
import { VIPService, VIP_PACKAGES } from "./vip.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/security/guards/roles.guard";
import { Roles } from "../../common/security/guards/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import {
  PurchaseVIPDto,
  GrantVIPDto,
  RevokeVIPDto,
  VIPPackageResponseDto,
  VIPStatusResponseDto,
} from "./dto";

@ApiTags("vip")
@Controller("vip")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class VIPController {
  constructor(private readonly vipService: VIPService) {}

  // ================================
  // USER ENDPOINTS
  // ================================

  @Get("packages")
  @ApiOperation({ summary: "Get available VIP packages" })
  @ApiResponse({ status: 200, type: [VIPPackageResponseDto] })
  getPackages() {
    return {
      packages: VIP_PACKAGES,
    };
  }

  @Get("status")
  @ApiOperation({ summary: "Get my VIP status" })
  @ApiResponse({ status: 200, type: VIPStatusResponseDto })
  async getMyStatus(@CurrentUser() user: any) {
    return this.vipService.getVIPStatus(user.id);
  }

  @Get("status/:userId")
  @ApiOperation({ summary: "Get user VIP status" })
  @ApiResponse({ status: 200, type: VIPStatusResponseDto })
  async getUserStatus(@Param("userId") userId: string) {
    return this.vipService.getVIPStatus(userId);
  }

  @Post("purchase")
  @ApiOperation({ summary: "Purchase VIP package" })
  async purchaseVIP(
    @CurrentUser() user: any,
    @Body() body: PurchaseVIPDto,
  ) {
    return this.vipService.purchaseVIP(user.id, body.packageId);
  }

  // ================================
  // ADMIN ENDPOINTS
  // ================================

  @Get("users")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "SUPER_ADMIN")
  @ApiOperation({ summary: "Get all VIP users (Admin)" })
  async getVIPUsers(
    @Query("page") page = 1,
    @Query("limit") limit = 20,
  ) {
    return this.vipService.getVIPUsers(+page, +limit);
  }

  @Post("grant/:userId")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "SUPER_ADMIN")
  @ApiOperation({ summary: "Grant VIP to user (Admin)" })
  async grantVIP(
    @Param("userId") userId: string,
    @Body() body: GrantVIPDto,
    @CurrentUser() admin: any,
  ) {
    return this.vipService.grantVIP(userId, body.days, admin.id, body.reason);
  }

  @Patch("revoke/:userId")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "SUPER_ADMIN")
  @ApiOperation({ summary: "Revoke VIP from user (Admin)" })
  async revokeVIP(
    @Param("userId") userId: string,
    @Body() body: RevokeVIPDto,
    @CurrentUser() admin: any,
  ) {
    return this.vipService.revokeVIP(userId, admin.id, body.reason);
  }

  @Post("check-expired")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "SUPER_ADMIN")
  @ApiOperation({ summary: "Check and expire VIPs (Admin)" })
  async checkExpired() {
    const count = await this.vipService.checkExpiredVIPs();
    return {
      message: `تم إلغاء ${count} اشتراك منتهي`,
      expiredCount: count,
    };
  }
}
