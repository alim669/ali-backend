/**
 * Reports Controller - واجهة API للبلاغات
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ReportsService, CreateReportDto, UpdateReportDto } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('reports')
@Controller('reports')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  // ================================
  // USER ENDPOINTS
  // ================================

  @Post()
  @ApiOperation({ summary: 'إنشاء بلاغ' })
  async create(
    @Body() dto: CreateReportDto,
    @CurrentUser('id') reporterId: string,
  ) {
    return this.reportsService.create(reporterId, dto);
  }

  @Get('my')
  @ApiOperation({ summary: 'بلاغاتي' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getMyReports(
    @CurrentUser('id') reporterId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.reportsService.findByReporter(reporterId, page || 1, limit || 20);
  }

  // ================================
  // ADMIN ENDPOINTS
  // ================================

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'MODERATOR')
  @ApiOperation({ summary: 'كل البلاغات (Admin)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  async getAllReports(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: any,
  ) {
    return this.reportsService.findAll(page || 1, limit || 20, status);
  }

  @Get('stats')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'إحصائيات البلاغات (Admin)' })
  async getStats() {
    return this.reportsService.getStats();
  }

  @Get('pending-count')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'MODERATOR')
  @ApiOperation({ summary: 'عدد البلاغات المعلقة (Admin)' })
  async getPendingCount() {
    const count = await this.reportsService.getPendingCount();
    return { pendingCount: count };
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'MODERATOR')
  @ApiOperation({ summary: 'تفاصيل البلاغ (Admin)' })
  async getReport(@Param('id') id: string) {
    return this.reportsService.findById(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'MODERATOR')
  @ApiOperation({ summary: 'تحديث البلاغ (Admin)' })
  async updateReport(
    @Param('id') id: string,
    @Body() dto: UpdateReportDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.reportsService.update(id, dto, adminId);
  }
}
