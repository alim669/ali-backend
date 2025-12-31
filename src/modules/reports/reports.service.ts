/**
 * Reports Service - خدمة البلاغات
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReportType, ReportStatus } from '@prisma/client';

export interface CreateReportDto {
  type: ReportType;
  reason: string;
  details?: string;
  reportedUserId?: string;
  reportedRoomId?: string;
}

export interface UpdateReportDto {
  status: ReportStatus;
  resolution?: string;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private prisma: PrismaService) {}

  // ================================
  // CREATE REPORT
  // ================================

  async create(reporterId: string, dto: CreateReportDto) {
    // Validate that at least one target is provided
    if (!dto.reportedUserId && !dto.reportedRoomId) {
      throw new BadRequestException('يجب تحديد مستخدم أو غرفة للإبلاغ عنها');
    }

    // Check reported user exists
    if (dto.reportedUserId) {
      const user = await this.prisma.user.findUnique({
        where: { id: dto.reportedUserId },
      });
      if (!user) {
        throw new NotFoundException('المستخدم المبلغ عنه غير موجود');
      }
      if (dto.reportedUserId === reporterId) {
        throw new BadRequestException('لا يمكنك الإبلاغ عن نفسك');
      }
    }

    // Check reported room exists
    if (dto.reportedRoomId) {
      const room = await this.prisma.room.findUnique({
        where: { id: dto.reportedRoomId },
      });
      if (!room) {
        throw new NotFoundException('الغرفة المبلغ عنها غير موجودة');
      }
    }

    const report = await this.prisma.report.create({
      data: {
        reporterId,
        reportedUserId: dto.reportedUserId,
        reportedRoomId: dto.reportedRoomId,
        type: dto.type,
        reason: dto.reason,
        details: dto.details,
      },
      include: {
        reportedUser: {
          select: { id: true, username: true, displayName: true },
        },
        reportedRoom: {
          select: { id: true, name: true },
        },
      },
    });

    this.logger.log(`Report created: ${report.id} by user ${reporterId}`);

    return report;
  }

  // ================================
  // GET REPORTS (ADMIN)
  // ================================

  async findAll(page = 1, limit = 20, status?: ReportStatus) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) {
      where.status = status;
    }

    const [reports, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        include: {
          reporter: {
            select: { id: true, username: true, displayName: true },
          },
          reportedUser: {
            select: { id: true, username: true, displayName: true },
          },
          reportedRoom: {
            select: { id: true, name: true },
          },
          resolvedBy: {
            select: { id: true, username: true, displayName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.report.count({ where }),
    ]);

    return {
      data: reports,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ================================
  // GET REPORT BY ID
  // ================================

  async findById(id: string) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: {
        reporter: {
          select: { id: true, username: true, displayName: true, email: true },
        },
        reportedUser: {
          select: { id: true, username: true, displayName: true, email: true, status: true },
        },
        reportedRoom: {
          select: { id: true, name: true, status: true },
        },
        resolvedBy: {
          select: { id: true, username: true, displayName: true },
        },
      },
    });

    if (!report) {
      throw new NotFoundException('البلاغ غير موجود');
    }

    return report;
  }

  // ================================
  // UPDATE REPORT (ADMIN)
  // ================================

  async update(id: string, dto: UpdateReportDto, adminId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id },
    });

    if (!report) {
      throw new NotFoundException('البلاغ غير موجود');
    }

    const updated = await this.prisma.report.update({
      where: { id },
      data: {
        status: dto.status,
        resolution: dto.resolution,
        resolvedById: adminId,
        resolvedAt: dto.status === 'RESOLVED' || dto.status === 'DISMISSED' ? new Date() : null,
      },
    });

    this.logger.log(`Report ${id} updated to ${dto.status} by admin ${adminId}`);

    return updated;
  }

  // ================================
  // GET MY REPORTS
  // ================================

  async findByReporter(reporterId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [reports, total] = await Promise.all([
      this.prisma.report.findMany({
        where: { reporterId },
        include: {
          reportedUser: {
            select: { id: true, username: true, displayName: true },
          },
          reportedRoom: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.report.count({ where: { reporterId } }),
    ]);

    return {
      data: reports,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ================================
  // GET PENDING REPORTS COUNT
  // ================================

  async getPendingCount(): Promise<number> {
    return this.prisma.report.count({
      where: { status: 'PENDING' },
    });
  }

  // ================================
  // GET REPORTS STATS
  // ================================

  async getStats() {
    const [total, pending, reviewing, resolved, dismissed] = await Promise.all([
      this.prisma.report.count(),
      this.prisma.report.count({ where: { status: 'PENDING' } }),
      this.prisma.report.count({ where: { status: 'REVIEWING' } }),
      this.prisma.report.count({ where: { status: 'RESOLVED' } }),
      this.prisma.report.count({ where: { status: 'DISMISSED' } }),
    ]);

    return {
      total,
      byStatus: { pending, reviewing, resolved, dismissed },
    };
  }
}
