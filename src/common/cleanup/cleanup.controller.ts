/**
 * Cleanup Controller - نقاط التحكم في التنظيف (Admin فقط)
 */

import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { CleanupService } from "./cleanup.service";
import { JwtAuthGuard } from "../../modules/auth/guards/jwt-auth.guard";
import { RolesGuard } from "../security/guards/roles.guard";
import { Roles } from "../security/guards/roles.decorator";

@ApiTags("cleanup")
@Controller("admin/cleanup")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
@ApiBearerAuth()
export class CleanupController {
  constructor(private readonly cleanupService: CleanupService) {}

  @Get("stats")
  @ApiOperation({ summary: "Get cleanup statistics" })
  async getStats() {
    return this.cleanupService.getCleanupStats();
  }

  @Post("run")
  @ApiOperation({ summary: "Trigger manual cleanup" })
  async runCleanup() {
    const results = await this.cleanupService.triggerCleanup();
    return {
      success: true,
      message: "تم تشغيل التنظيف بنجاح",
      results,
    };
  }
}
