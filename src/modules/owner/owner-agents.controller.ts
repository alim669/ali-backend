/**
 * Owner Agents Controller - كونترولر الوكلاء للمالك
 * Routes تحت /api/v1/owner/agents/...
 *
 * هذا الـ controller يوفر نفس الـ endpoints الموجودة في AgentsController
 * لكن تحت مسار /owner/agents/ للتوافق مع التطبيق
 */
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from "@nestjs/common";
import { AgentsService } from "../agents/agents.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";

@Controller("owner/agents")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("SUPER_ADMIN", "ADMIN")
export class OwnerAgentsController {
  private readonly logger = new Logger(OwnerAgentsController.name);

  constructor(private readonly agentsService: AgentsService) {}

  /**
   * GET /api/v1/owner/agents/requests/pending
   * الطلبات المعلقة فقط
   */
  @Get("requests/pending")
  async getPendingRequests() {
    this.logger.log("Owner: Getting pending agent requests");
    return this.agentsService.getPendingRequests();
  }

  /**
   * GET /api/v1/owner/agents/requests
   * جميع طلبات الوكلاء
   */
  @Get("requests")
  async getAllRequests(@Query("status") status?: string) {
    this.logger.log(`Owner: Getting all requests, status filter: ${status}`);
    return this.agentsService.getAllRequests(status);
  }

  /**
   * POST /api/v1/owner/agents/requests/:id/approve
   * الموافقة على طلب
   */
  @Post("requests/:id/approve")
  @HttpCode(HttpStatus.OK)
  async approveRequest(
    @Param("id") requestId: string,
    @CurrentUser("id") reviewerId: string,
  ) {
    this.logger.log(`Owner: Approving request ${requestId} by ${reviewerId}`);
    return this.agentsService.reviewRequest(requestId, reviewerId, {
      status: "APPROVED",
    });
  }

  /**
   * POST /api/v1/owner/agents/requests/:id/reject
   * رفض طلب
   */
  @Post("requests/:id/reject")
  @HttpCode(HttpStatus.OK)
  async rejectRequest(
    @Param("id") requestId: string,
    @CurrentUser("id") reviewerId: string,
    @Body() body: { reason?: string },
  ) {
    this.logger.log(`Owner: Rejecting request ${requestId} by ${reviewerId}`);
    return this.agentsService.reviewRequest(requestId, reviewerId, {
      status: "REJECTED",
      rejectionReason: body.reason || "تم الرفض من قبل المالك",
    });
  }

  /**
   * GET /api/v1/owner/agents/:agentId
   * تفاصيل وكيل محدد
   */
  @Get(":agentId")
  async getAgentDetails(@Param("agentId") agentId: string) {
    this.logger.log(`Owner: Getting agent details for ${agentId}`);
    return this.agentsService.getAgentDetails(agentId);
  }

  /**
   * POST /api/v1/owner/agents/:agentId/suspend
   * إيقاف وكيل
   */
  @Post(":agentId/suspend")
  @HttpCode(HttpStatus.OK)
  async suspendAgent(
    @Param("agentId") agentId: string,
    @Body() body: { reason?: string },
  ) {
    this.logger.log(`Owner: Suspending agent ${agentId}`);
    return this.agentsService.suspendAgent(agentId, body.reason);
  }

  /**
   * POST /api/v1/owner/agents/:agentId/activate
   * تفعيل وكيل
   */
  @Post(":agentId/activate")
  @HttpCode(HttpStatus.OK)
  async activateAgent(@Param("agentId") agentId: string) {
    this.logger.log(`Owner: Activating agent ${agentId}`);
    return this.agentsService.activateAgent(agentId);
  }

  /**
   * POST /api/v1/owner/agents/:agentId/unsuspend
   * إلغاء إيقاف وكيل (نفس activate للتوافق مع التطبيق)
   */
  @Post(":agentId/unsuspend")
  @HttpCode(HttpStatus.OK)
  async unsuspendAgent(@Param("agentId") agentId: string) {
    this.logger.log(`Owner: Unsuspending agent ${agentId}`);
    return this.agentsService.activateAgent(agentId);
  }

  /**
   * POST /api/v1/owner/agents/:agentId/remove
   * إزالة وكيل
   */
  @Post(":agentId/remove")
  @HttpCode(HttpStatus.OK)
  async removeAgent(@Param("agentId") agentId: string) {
    this.logger.log(`Owner: Removing agent ${agentId}`);
    return this.agentsService.removeAgent(agentId);
  }

  /**
   * GET /api/v1/owner/agents/stats
   * إحصائيات الوكلاء
   */
  @Get("stats")
  async getAgentsStats() {
    this.logger.log("Owner: Getting agents statistics");
    return this.agentsService.getAgentsStats();
  }
}
