/**
 * Agents Controller - كونترولر الوكلاء
 * Route مخصص لشاشة "تقديم طلب وكيل" والإدارة
 *
 * Endpoints:
 * - POST /api/v1/agents/request - تقديم طلب وكيل جديد
 * - GET /api/v1/agents/my-status - حالة طلب المستخدم الحالي
 * - GET /api/v1/agents - قائمة الوكلاء المعتمدين (عام)
 * - GET /api/v1/agents/requests - جميع الطلبات (للمالك)
 * - PATCH /api/v1/agents/requests/:id/review - مراجعة طلب (للمالك)
 */
import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseGuards,
} from "@nestjs/common";
import {
  AgentsService,
  CreateAgentRequestDto,
  ReviewAgentRequestDto,
} from "./agents.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";

@Controller("agents")
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  /**
   * =====================================================
   * POST /api/v1/agents/request
   * Route مخصص لشاشة "تقديم طلب وكيل"
   * يستقبل بيانات نموذج التقديم ويحفظها
   * =====================================================
   */
  @Post("request")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async submitAgentRequest(
    @CurrentUser("id") userId: string,
    @Body() body: CreateAgentRequestDto,
  ) {
    // Validation - التحقق من الحقول المطلوبة
    if (!body.fullName || body.fullName.trim().length < 3) {
      throw new BadRequestException("الاسم الثلاثي مطلوب (3 أحرف على الأقل)");
    }
    if (!body.country || body.country.trim().length < 2) {
      throw new BadRequestException("الدولة مطلوبة");
    }
    if (!body.province || body.province.trim().length < 2) {
      throw new BadRequestException("المحافظة مطلوبة");
    }
    if (!body.region || body.region.trim().length < 2) {
      throw new BadRequestException("المنطقة مطلوبة");
    }
    if (!body.email || !this.isValidEmail(body.email)) {
      throw new BadRequestException("البريد الإلكتروني غير صحيح");
    }
    if (!body.phone || body.phone.trim().length < 8) {
      throw new BadRequestException("رقم الهاتف مطلوب (8 أرقام على الأقل)");
    }

    return this.agentsService.createAgentRequest(userId, {
      fullName: body.fullName.trim(),
      country: body.country.trim(),
      province: body.province.trim(),
      region: body.region.trim(),
      email: body.email.trim().toLowerCase(),
      phone: body.phone.trim(),
      message: body.message?.trim() || undefined,
    });
  }

  /**
   * GET /api/v1/agents/my-status
   * الحصول على حالة طلب المستخدم الحالي
   */
  @Get("my-status")
  @UseGuards(JwtAuthGuard)
  async getMyAgentStatus(@CurrentUser("id") userId: string) {
    return this.agentsService.getMyAgentStatus(userId);
  }

  /**
   * GET /api/v1/agents
   * قائمة الوكلاء المعتمدين - متاح للجميع
   */
  @Public()
  @Get()
  async getApprovedAgents() {
    return this.agentsService.getApprovedAgents();
  }

  /**
   * GET /api/v1/agents/requests
   * جميع طلبات الوكلاء - للمالك فقط
   */
  @Get("requests")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  async getAllRequests(@Query("status") status?: string) {
    return this.agentsService.getAllRequests(status);
  }

  /**
   * PATCH /api/v1/agents/requests/:id/review
   * مراجعة طلب وكيل - للمالك فقط
   */
  @Patch("requests/:id/review")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  @HttpCode(HttpStatus.OK)
  async reviewRequest(
    @Param("id") requestId: string,
    @CurrentUser("id") reviewerId: string,
    @Body() body: ReviewAgentRequestDto,
  ) {
    if (!body.status || !["APPROVED", "REJECTED"].includes(body.status)) {
      throw new BadRequestException(
        "يجب تحديد حالة صحيحة (APPROVED أو REJECTED)",
      );
    }

    if (body.status === "REJECTED" && !body.rejectionReason) {
      throw new BadRequestException("يجب تحديد سبب الرفض");
    }

    return this.agentsService.reviewRequest(requestId, reviewerId, body);
  }

  // Helper: التحقق من صحة البريد الإلكتروني
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}
