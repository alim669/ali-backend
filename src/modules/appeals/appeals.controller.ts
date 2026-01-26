/**
 * Appeals Controller - كونترولر الطعون
 * إدارة طعون المستخدمين على العقوبات
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
  Logger,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { PrismaService } from "../../common/prisma/prisma.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

// DTOs
class CreateAppealDto {
  reason: string;
  type?: "BAN_APPEAL" | "MUTE_APPEAL" | "WARNING_APPEAL" | "OTHER";
}

class ReviewAppealDto {
  status: "APPROVED" | "REJECTED" | "IN_REVIEW";
  response: string;
}

@ApiTags("appeals")
@Controller("appeals")
export class AppealsController {
  private readonly logger = new Logger(AppealsController.name);

  constructor(private readonly prisma: PrismaService) {}

  // ========== User Endpoints ==========

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "تقديم طعن جديد" })
  async createAppeal(
    @CurrentUser("id") userId: string,
    @Body() dto: CreateAppealDto,
  ) {
    this.logger.log(`User ${userId} submitting appeal`);

    // Check if user already has a pending appeal
    const existingAppeal = await this.prisma.appeal.findFirst({
      where: {
        userId,
        status: { in: ["PENDING", "IN_REVIEW"] },
      },
    });

    if (existingAppeal) {
      return {
        success: false,
        message: "لديك طعن قيد المراجعة بالفعل. يرجى انتظار الرد.",
      };
    }

    const appeal = await this.prisma.appeal.create({
      data: {
        userId,
        type: dto.type || "BAN_APPEAL",
        reason: dto.reason,
        status: "PENDING",
      },
    });

    this.logger.log(`Appeal ${appeal.id} created successfully`);

    return {
      success: true,
      message: "تم تقديم الطعن بنجاح. سيتم مراجعته قريباً.",
      data: {
        id: appeal.id,
        status: appeal.status,
        createdAt: appeal.createdAt,
      },
    };
  }

  @Get("my")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "جلب طعوناتي" })
  async getMyAppeals(@CurrentUser("id") userId: string) {
    const appeals = await this.prisma.appeal.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        reason: true,
        status: true,
        response: true,
        reviewedAt: true,
        createdAt: true,
      },
    });

    return { data: appeals };
  }

  // ========== Admin/Owner Endpoints ==========

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN", "SUPER_ADMIN", "MODERATOR")
  @ApiBearerAuth()
  @ApiOperation({ summary: "جلب جميع الطعون" })
  async getAllAppeals(
    @Query("status") status?: string,
    @Query("type") type?: string,
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 20,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (status) where.status = status;
    if (type) where.type = type;

    const [appeals, total] = await Promise.all([
      this.prisma.appeal.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              email: true,
              avatar: true,
              status: true,
              banReason: true,
              bannedAt: true,
              bannedUntil: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: Number(limit),
      }),
      this.prisma.appeal.count({ where }),
    ]);

    return {
      data: appeals,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get("stats")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN", "SUPER_ADMIN")
  @ApiBearerAuth()
  @ApiOperation({ summary: "إحصائيات الطعون" })
  async getAppealsStats() {
    const [pending, approved, rejected, inReview, total] = await Promise.all([
      this.prisma.appeal.count({ where: { status: "PENDING" } }),
      this.prisma.appeal.count({ where: { status: "APPROVED" } }),
      this.prisma.appeal.count({ where: { status: "REJECTED" } }),
      this.prisma.appeal.count({ where: { status: "IN_REVIEW" } }),
      this.prisma.appeal.count(),
    ]);

    return {
      pending,
      approved,
      rejected,
      inReview,
      total,
      approvalRate: total > 0 ? Math.round((approved / total) * 100) : 0,
    };
  }

  @Patch(":id/review")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN", "SUPER_ADMIN", "MODERATOR")
  @ApiBearerAuth()
  @ApiOperation({ summary: "مراجعة طعن" })
  async reviewAppeal(
    @Param("id") appealId: string,
    @CurrentUser("id") reviewerId: string,
    @Body() dto: ReviewAppealDto,
  ) {
    this.logger.log(`Reviewing appeal ${appealId} by ${reviewerId}`);

    const appeal = await this.prisma.appeal.findUnique({
      where: { id: appealId },
      include: { user: true },
    });

    if (!appeal) {
      return { success: false, message: "الطعن غير موجود" };
    }

    // Update appeal
    const updatedAppeal = await this.prisma.appeal.update({
      where: { id: appealId },
      data: {
        status: dto.status,
        response: dto.response,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      },
    });

    // If approved, unban the user
    if (dto.status === "APPROVED" && appeal.type === "BAN_APPEAL") {
      await this.prisma.user.update({
        where: { id: appeal.userId },
        data: {
          status: "ACTIVE",
          banReason: null,
          bannedAt: null,
          bannedUntil: null,
          bannedBy: null,
        },
      });

      // Log the action
      await this.prisma.adminAction.create({
        data: {
          action: "USER_UNBANNED",
          actorId: reviewerId,
          targetId: appeal.userId,
          details: {
            reason: `تمت الموافقة على الطعن: ${dto.response}`,
            appealId: appealId,
          },
        },
      });

      this.logger.log(`User ${appeal.userId} unbanned due to approved appeal`);
    }

    // Create notification for user
    await this.prisma.notification.create({
      data: {
        userId: appeal.userId,
        type: "SYSTEM_MESSAGE",
        title: dto.status === "APPROVED" ? "تمت الموافقة على طعنك ✅" : "تم رفض طعنك ❌",
        body: dto.response,
        data: {
          type: "appeal_result",
          appealId: appealId,
          status: dto.status,
        },
      },
    });

    return {
      success: true,
      message: dto.status === "APPROVED" 
        ? "تمت الموافقة على الطعن ورفع الحظر" 
        : "تم تحديث حالة الطعن",
      data: updatedAppeal,
    };
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN", "SUPER_ADMIN", "MODERATOR")
  @ApiBearerAuth()
  @ApiOperation({ summary: "جلب تفاصيل طعن" })
  async getAppeal(@Param("id") appealId: string) {
    const appeal = await this.prisma.appeal.findUnique({
      where: { id: appealId },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            email: true,
            avatar: true,
            status: true,
            banReason: true,
            bannedAt: true,
            bannedUntil: true,
            role: true,
            createdAt: true,
          },
        },
      },
    });

    if (!appeal) {
      return { success: false, message: "الطعن غير موجود" };
    }

    return { data: appeal };
  }
}
