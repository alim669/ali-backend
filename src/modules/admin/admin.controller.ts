import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { CacheService } from '../../common/cache/cache.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@ApiBearerAuth()
export class AdminController {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private cache: CacheService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'إحصائيات لوحة التحكم' })
  async getDashboard() {
    const [
      totalUsers,
      activeUsers,
      bannedUsers,
      totalRooms,
      activeRooms,
      totalMessages,
      totalGifts,
      totalGiftValue,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { status: 'BANNED' } }),
      this.prisma.room.count(),
      this.prisma.room.count({ where: { status: 'ACTIVE' } }),
      this.prisma.message.count(),
      this.prisma.giftSend.count(),
      this.prisma.giftSend.aggregate({ _sum: { totalPrice: true } }),
    ]);

    // Get today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      newUsersToday,
      messagestoday,
      giftsToday,
    ] = await Promise.all([
      this.prisma.user.count({ where: { createdAt: { gte: today } } }),
      this.prisma.message.count({ where: { createdAt: { gte: today } } }),
      this.prisma.giftSend.count({ where: { createdAt: { gte: today } } }),
    ]);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        banned: bannedUsers,
        newToday: newUsersToday,
      },
      rooms: {
        total: totalRooms,
        active: activeRooms,
      },
      messages: {
        total: totalMessages,
        today: messagestoday,
      },
      gifts: {
        total: totalGifts,
        today: giftsToday,
        totalValue: totalGiftValue._sum.totalPrice || 0,
      },
    };
  }

  @Get('actions')
  @ApiOperation({ summary: 'سجل إجراءات المسؤولين' })
  async getAdminActions(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 50,
  ) {
    const skip = (page - 1) * limit;

    const [actions, total] = await Promise.all([
      this.prisma.adminAction.findMany({
        include: {
          actor: {
            select: {
              id: true,
              username: true,
              displayName: true,
            },
          },
          target: {
            select: {
              id: true,
              username: true,
              displayName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.adminAction.count(),
    ]);

    return {
      data: actions,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  @Get('online')
  @ApiOperation({ summary: 'المستخدمين المتصلين' })
  async getOnlineUsers() {
    // This is a simplified version - in production you'd scan Redis keys
    const client = this.redis.getClient();
    const keys = client ? await client.keys('presence:user:*') : [];
    const onlineCount = keys.length;

    return {
      onlineCount,
      // You could expand this to get user details
    };
  }

  @Get('revenue')
  @ApiOperation({ summary: 'تقرير الإيرادات' })
  async getRevenue(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const where: any = {
      type: { in: ['DEPOSIT', 'PURCHASE'] },
      status: 'COMPLETED',
    };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const result = await this.prisma.walletTransaction.aggregate({
      where,
      _sum: { amount: true },
      _count: { id: true },
    });

    // Get daily breakdown
    const dailyRevenue = await this.prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        SUM(amount) as total,
        COUNT(*) as count
      FROM wallet_transactions
      WHERE type IN ('DEPOSIT', 'PURCHASE')
        AND status = 'COMPLETED'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `;

    return {
      totalRevenue: result._sum.amount || 0,
      transactionCount: result._count.id,
      dailyBreakdown: dailyRevenue,
    };
  }

  @Get('system/health')
  @ApiOperation({ summary: 'حالة النظام' })
  async getSystemHealth() {
    const health: any = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {},
    };

    // Check PostgreSQL
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      health.services.postgres = { status: 'up' };
    } catch (error) {
      health.services.postgres = { status: 'down', error: error.message };
      health.status = 'unhealthy';
    }

    // Check Redis
    try {
      const client = this.redis.getClient();
      if (client) {
        await client.ping();
        health.services.redis = { status: 'up' };
      } else {
        health.services.redis = { status: 'disabled', message: 'Using in-memory fallback' };
      }
    } catch (error) {
      health.services.redis = { status: 'down', error: error.message };
      health.status = 'unhealthy';
    }

    // Cache stats
    health.services.cache = this.cache.getStats();

    return health;
  }

  @Get('cache/stats')
  @ApiOperation({ summary: 'إحصائيات الـ Cache' })
  async getCacheStats() {
    return {
      ...this.cache.getStats(),
      timestamp: new Date().toISOString(),
    };
  }
}
