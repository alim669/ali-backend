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
    });

    return agents.map((agent) => ({
      id: agent.id,
      fullName: agent.fullName,
      country: agent.country,
      province: agent.province,
      region: agent.region,
      phone: agent.phone,
    }));
  }

  /**
   * الحصول على جميع طلبات الوكلاء (للمالك فقط)
   */
  async getAllRequests(status?: string) {
    const where = status ? { status: status as any } : {};

    const requests = await this.prisma.agentRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return requests;
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
}
