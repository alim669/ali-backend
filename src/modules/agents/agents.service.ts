/**
 * Agents Service - خدمة الوكلاء
 * يدير منطق العمل الخاص بطلبات الوكلاء
 */
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";

// DTO لإنشاء طلب وكيل
export interface CreateAgentRequestDto {
  fullName: string;
  country: string;
  province: string;
  region: string;
  email: string;
  phone: string;
  telegram?: string;
  message?: string;
}

// DTO للموافقة/الرفض
export interface ReviewAgentRequestDto {
  status: "APPROVED" | "REJECTED";
  rejectionReason?: string;
}

@Injectable()
export class AgentsService {
  constructor(private prisma: PrismaService) {}

  /**
   * إنشاء طلب وكيل جديد
   * Route مخصص لشاشة "تقديم طلب وكيل"
   */
  async createAgentRequest(userId: string, dto: CreateAgentRequestDto) {
    // التحقق من وجود طلب معلق للمستخدم
    const existingRequest = await this.prisma.agentRequest.findFirst({
      where: {
        userId,
        status: "PENDING",
      },
    });

    if (existingRequest) {
      throw new BadRequestException(
        "لديك طلب معلق بالفعل. انتظر حتى تتم مراجعته.",
      );
    }

    // التحقق هل المستخدم وكيل بالفعل
    const existingAgent = await this.prisma.agent.findUnique({
      where: { userId },
    });

    if (existingAgent) {
      throw new BadRequestException("أنت وكيل معتمد بالفعل.");
    }

    // إنشاء طلب جديد
    const request = await this.prisma.agentRequest.create({
      data: {
        userId,
        fullName: dto.fullName,
        country: dto.country,
        province: dto.province,
        region: dto.region,
        email: dto.email,
        phone: dto.phone,
        telegram: dto.telegram,
        message: dto.message,
      },
    });

    return {
      success: true,
      message: "تم تقديم طلبك بنجاح. سيتم مراجعته خلال 7 أيام.",
      data: {
        id: request.id,
        status: request.status,
        createdAt: request.createdAt,
      },
    };
  }

  /**
   * الحصول على حالة طلب المستخدم الحالي
   */
  async getMyAgentStatus(userId: string) {
    // التحقق هل المستخدم وكيل
    const agent = await this.prisma.agent.findUnique({
      where: { userId },
    });

    if (agent) {
      return {
        isAgent: true,
        status: "APPROVED",
        agent: {
          id: agent.id,
          fullName: agent.fullName,
          country: agent.country,
          province: agent.province,
          region: agent.region,
          phone: agent.phone,
        },
      };
    }

    // التحقق من وجود طلب
    const request = await this.prisma.agentRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    if (!request) {
      return {
        isAgent: false,
        status: null,
        canApply: true,
      };
    }

    return {
      isAgent: false,
      status: request.status,
      request: {
        id: request.id,
        fullName: request.fullName,
        status: request.status,
        rejectionReason: request.rejectionReason,
        createdAt: request.createdAt,
        expiresAt: request.expiresAt,
      },
      canApply: request.status === "REJECTED",
    };
  }

  /**
   * الحصول على قائمة الوكلاء المعتمدين (للعامة)
   */
  async getApprovedAgents() {
    const agents = await this.prisma.agent.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            numericId: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
      },
    });

    return agents.map((agent) => ({
      id: agent.id,
      odoo_user_id: agent.userId,
      userId: agent.userId,
      numericId: agent.user?.numericId ? Number(agent.user.numericId) : null,
      username: agent.user?.username || agent.fullName,
      display_name: agent.fullName,
      displayName: agent.fullName,
      fullName: agent.fullName,
      avatarUrl: agent.user?.avatar,
      avatar_url: agent.user?.avatar,
      country: agent.country,
      province: agent.province,
      region: agent.region,
      phone: agent.phone,
      telegram: (agent as any).telegram || null,
      status: "active",
      approved_at: agent.createdAt.toISOString(),
      createdAt: agent.createdAt.toISOString(),
    }));
  }

  /**
   * التحقق إذا المستخدم وكيل
   */
  async checkIfAgent(userId: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { userId },
    });

    return {
      isAgent: !!agent,
      status: agent?.status || null,
    };
  }

  /**
   * الحصول على حالة طلب مستخدم معين
   */
  async getRequestStatus(userId: string) {
    // التحقق هل المستخدم وكيل
    const agent = await this.prisma.agent.findUnique({
      where: { userId },
    });

    if (agent) {
      return {
        id: agent.id,
        odoo_user_id: agent.userId,
        username: agent.fullName,
        display_name: agent.fullName,
        status: "approved",
        created_at: agent.createdAt.toISOString(),
      };
    }

    // التحقق من وجود طلب
    const request = await this.prisma.agentRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    if (!request) {
      return null;
    }

    return {
      id: request.id,
      odoo_user_id: request.userId,
      username: request.fullName,
      display_name: request.fullName,
      full_name: request.fullName,
      country: request.country,
      province: request.province,
      region: request.region,
      email: request.email,
      phone: request.phone,
      message: request.message,
      status: request.status.toLowerCase(),
      rejection_reason: request.rejectionReason,
      created_at: request.createdAt.toISOString(),
      reviewed_at: request.reviewedAt?.toISOString(),
      expires_at: request.expiresAt?.toISOString(),
    };
  }

  /**
   * الحصول على الطلبات المعلقة فقط (للمالك)
   */
  async getPendingRequests() {
    const requests = await this.prisma.agentRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
      },
    });

    return {
      requests: requests.map((r) => ({
        id: r.id,
        odoo_user_id: r.userId,
        username: r.user.username || r.fullName,
        display_name: r.user.displayName || r.fullName,
        avatar_url: r.user.avatar,
        full_name: r.fullName,
        country: r.country,
        province: r.province,
        region: r.region,
        email: r.email,
        phone: r.phone,
        message: r.message,
        status: r.status.toLowerCase(),
        created_at: r.createdAt.toISOString(),
        expires_at: r.expiresAt?.toISOString(),
      })),
    };
  }

  /**
   * الحصول على جميع طلبات الوكلاء (للمالك فقط)
   */
  async getAllRequests(status?: string) {
    const where = status ? { status: status.toUpperCase() as any } : {};

    const requests = await this.prisma.agentRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
      },
    });

    return {
      requests: requests.map((r) => ({
        id: r.id,
        odoo_user_id: r.userId,
        username: r.user.username || r.fullName,
        display_name: r.user.displayName || r.fullName,
        avatar_url: r.user.avatar,
        full_name: r.fullName,
        country: r.country,
        province: r.province,
        region: r.region,
        email: r.email,
        phone: r.phone,
        message: r.message,
        status: r.status.toLowerCase(),
        rejection_reason: r.rejectionReason,
        created_at: r.createdAt.toISOString(),
        reviewed_at: r.reviewedAt?.toISOString(),
        reviewed_by: r.reviewedBy,
        expires_at: r.expiresAt?.toISOString(),
      })),
    };
  }

  /**
   * مراجعة طلب وكيل (للمالك فقط)
   */
  async reviewRequest(
    requestId: string,
    reviewerId: string,
    dto: ReviewAgentRequestDto,
  ) {
    const request = await this.prisma.agentRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException("الطلب غير موجود");
    }

    if (request.status !== "PENDING") {
      throw new BadRequestException("تمت مراجعة هذا الطلب مسبقاً");
    }

    // تحديث الطلب
    const updatedRequest = await this.prisma.agentRequest.update({
      where: { id: requestId },
      data: {
        status: dto.status,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        rejectionReason: dto.rejectionReason,
      },
    });

    // إذا تمت الموافقة، إنشاء وكيل جديد
    if (dto.status === "APPROVED") {
      await this.prisma.agent.create({
        data: {
          userId: request.userId,
          fullName: request.fullName,
          country: request.country,
          province: request.province,
          region: request.region,
          phone: request.phone,
          telegram: (request as any).telegram,
        },
      });
    }

    return {
      success: true,
      message:
        dto.status === "APPROVED"
          ? "تمت الموافقة على الطلب بنجاح"
          : "تم رفض الطلب",
      data: updatedRequest,
    };
  }

  /**
   * الحصول على تفاصيل وكيل محدد (للمالك)
   */
  async getAgentDetails(agentId: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
            email: true,
          },
        },
      },
    });

    if (!agent) {
      throw new NotFoundException("الوكيل غير موجود");
    }

    return {
      id: agent.id,
      odoo_user_id: agent.userId,
      username: agent.user.username || agent.fullName,
      display_name: agent.user.displayName || agent.fullName,
      avatar_url: agent.user.avatar,
      full_name: agent.fullName,
      country: agent.country,
      province: agent.province,
      region: agent.region,
      phone: agent.phone,
      status: agent.status.toLowerCase(),
      created_at: agent.createdAt.toISOString(),
    };
  }

  /**
   * إيقاف وكيل (للمالك)
   */
  async suspendAgent(agentId: string, reason?: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      throw new NotFoundException("الوكيل غير موجود");
    }

    const updated = await this.prisma.agent.update({
      where: { id: agentId },
      data: { status: "SUSPENDED" },
    });

    return {
      success: true,
      message: "تم إيقاف الوكيل",
      data: {
        id: updated.id,
        status: updated.status.toLowerCase(),
      },
    };
  }

  /**
   * تفعيل وكيل (للمالك)
   */
  async activateAgent(agentId: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      throw new NotFoundException("الوكيل غير موجود");
    }

    const updated = await this.prisma.agent.update({
      where: { id: agentId },
      data: { status: "ACTIVE" },
    });

    return {
      success: true,
      message: "تم تفعيل الوكيل",
      data: {
        id: updated.id,
        status: updated.status.toLowerCase(),
      },
    };
  }

  /**
   * إزالة وكيل (للمالك)
   */
  async removeAgent(agentId: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      throw new NotFoundException("الوكيل غير موجود");
    }

    await this.prisma.agent.delete({
      where: { id: agentId },
    });

    return {
      success: true,
      message: "تم إزالة الوكيل",
    };
  }

  /**
   * إحصائيات الوكلاء (للمالك)
   */
  async getAgentsStats() {
    const [
      totalAgents,
      activeAgents,
      suspendedAgents,
      pendingRequests,
      approvedRequests,
      rejectedRequests,
    ] = await Promise.all([
      this.prisma.agent.count(),
      this.prisma.agent.count({ where: { status: "ACTIVE" } }),
      this.prisma.agent.count({ where: { status: "SUSPENDED" } }),
      this.prisma.agentRequest.count({ where: { status: "PENDING" } }),
      this.prisma.agentRequest.count({ where: { status: "APPROVED" } }),
      this.prisma.agentRequest.count({ where: { status: "REJECTED" } }),
    ]);

    return {
      agents: {
        total: totalAgents,
        active: activeAgents,
        suspended: suspendedAgents,
      },
      requests: {
        pending: pendingRequests,
        approved: approvedRequests,
        rejected: rejectedRequests,
        total: pendingRequests + approvedRequests + rejectedRequests,
      },
    };
  }
}
