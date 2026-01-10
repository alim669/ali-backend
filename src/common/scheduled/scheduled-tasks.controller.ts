/**
 * Scheduled Tasks Controller - إدارة المهام المجدولة
 */

import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../modules/auth/guards/jwt-auth.guard";
import { RolesGuard } from "../security/guards/roles.guard";
import { Roles } from "../security/guards/roles.decorator";
import { ScheduledTasksService } from "./scheduled-tasks.service";

@ApiTags("admin/scheduled-tasks")
@Controller("admin/scheduled-tasks")
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ScheduledTasksController {
  constructor(private readonly scheduledTasksService: ScheduledTasksService) {}

  @Get()
  @Roles("OWNER", "ADMIN")
  @ApiOperation({ summary: "الحصول على قائمة المهام المجدولة" })
  getJobs() {
    return {
      success: true,
      data: this.scheduledTasksService.getScheduledJobs(),
    };
  }

  @Post(":name/stop")
  @Roles("OWNER")
  @ApiOperation({ summary: "إيقاف مهمة مجدولة" })
  stopJob(@Param("name") name: string) {
    this.scheduledTasksService.stopJob(name);
    return {
      success: true,
      message: `تم إيقاف المهمة: ${name}`,
    };
  }

  @Post(":name/start")
  @Roles("OWNER")
  @ApiOperation({ summary: "تشغيل مهمة مجدولة" })
  startJob(@Param("name") name: string) {
    this.scheduledTasksService.startJob(name);
    return {
      success: true,
      message: `تم تشغيل المهمة: ${name}`,
    };
  }
}
