/**
 * Agents Controller - كونترولر الوكلاء
 * Route مخصص لشاشة "تقديم طلب وكيل" والإدارة
 *
 * Endpoints:
 * - POST /api/v1/agents/request - تقديم طلب وكيل جديد
 * - GET /api/v1/agents/my-status - حالة طلب المستخدم الحالي
 * - GET /api/v1/agents/check/:userId - التحقق إذا المستخدم وكيل
 * - GET /api/v1/agents/request/status/:userId - حالة طلب مستخدم معين
 * - GET /api/v1/agents - قائمة الوكلاء المعتمدين (عام)
 * - GET /api/v1/agents/requests - جميع الطلبات (للمالك)
 * - GET /api/v1/agents/requests/pending - الطلبات المعلقة (للمالك)
 * - POST /api/v1/agents/requests/:id/approve - الموافقة على طلب (للمالك)
 * - POST /api/v1/agents/requests/:id/reject - رفض طلب (للمالك)
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
  Logger,
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
  private readonly logger = new Logger(AgentsController.name);

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
    @Body() body: any,
  ) {
    // دعم كلا الصيغتين: snake_case و camelCase
    const fullName = body.fullName || body.full_name;
    const country = body.country;
    const province = body.province;
    const region = body.region;
    const email = body.email;
    const phone = body.phone;
    const telegram = body.telegram;
    const message = body.message;

    this.logger.log(`Agent request received: ${JSON.stringify({ fullName, country, province, region, email, phone, telegram })}`);

    // Validation - التحقق من الحقول المطلوبة
    if (!fullName || fullName.trim().length < 3) {
      throw new BadRequestException("الاسم الثلاثي مطلوب (3 أحرف على الأقل)");
    }
    if (!country || country.trim().length < 2) {
      throw new BadRequestException("الدولة مطلوبة");
    }
    if (!province || province.trim().length < 2) {
      throw new BadRequestException("المحافظة مطلوبة");
    }
    if (!region || region.trim().length < 2) {
      throw new BadRequestException("المنطقة مطلوبة");
    }
    if (!email || !this.isValidEmail(email)) {
      throw new BadRequestException("البريد الإلكتروني غير صحيح");
    }
    if (!phone || phone.trim().length < 8) {
      throw new BadRequestException("رقم الهاتف مطلوب (8 أرقام على الأقل)");
    }

    return this.agentsService.createAgentRequest(userId, {
      fullName: fullName.trim(),
      country: country.trim(),
      province: province.trim(),
      region: region.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      telegram: telegram?.trim() || undefined,
      message: message?.trim() || undefined,
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
   * GET /api/v1/agents/check/:userId
   * التحقق إذا كان المستخدم وكيل - للتطبيق
   */
  @Get("check/:userId")
  @UseGuards(JwtAuthGuard)
  async checkIfAgent(@Param("userId") userId: string) {
    this.logger.log(`Checking agent status for user: ${userId}`);
    return this.agentsService.checkIfAgent(userId);
  }

  /**
   * GET /api/v1/agents/request/status/:userId
   * حالة طلب مستخدم معين
   */
  @Get("request/status/:userId")
  @UseGuards(JwtAuthGuard)
  async getRequestStatus(@Param("userId") userId: string) {
    this.logger.log(`Getting request status for user: ${userId}`);
    return this.agentsService.getRequestStatus(userId);
  }

  /**
   * GET /api/v1/agents/requests/pending
   * الطلبات المعلقة فقط - للمالك
   */
  @Get("requests/pending")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  async getPendingRequests() {
    this.logger.log("Getting pending agent requests");
    return this.agentsService.getPendingRequests();
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
  @Roles("SUPER_ADMIN", "ADMIN")
  async getAllRequests(@Query("status") status?: string) {
    return this.agentsService.getAllRequests(status);
  }

  /**
   * PATCH /api/v1/agents/requests/:id/review
   * مراجعة طلب وكيل - للمالك فقط
   */
  @Patch("requests/:id/review")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
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

  /**
   * POST /api/v1/agents/requests/:id/approve
   * الموافقة على طلب - للمالك فقط (مسار بديل للتطبيق)
   */
  @Post("requests/:id/approve")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @HttpCode(HttpStatus.OK)
  async approveRequest(
    @Param("id") requestId: string,
    @CurrentUser("id") reviewerId: string,
  ) {
    this.logger.log(`Approving request: ${requestId} by ${reviewerId}`);
    return this.agentsService.reviewRequest(requestId, reviewerId, {
      status: "APPROVED",
    });
  }

  /**
   * POST /api/v1/agents/requests/:id/reject
   * رفض طلب - للمالك فقط (مسار بديل للتطبيق)
   */
  @Post("requests/:id/reject")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @HttpCode(HttpStatus.OK)
  async rejectRequest(
    @Param("id") requestId: string,
    @CurrentUser("id") reviewerId: string,
    @Body() body: { reason?: string },
  ) {
    this.logger.log(`Rejecting request: ${requestId} by ${reviewerId}`);
    return this.agentsService.reviewRequest(requestId, reviewerId, {
      status: "REJECTED",
      rejectionReason: body.reason || "تم الرفض من قبل المالك",
    });
  }

  // Helper: التحقق من صحة البريد الإلكتروني
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}
