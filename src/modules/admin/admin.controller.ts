import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { PrismaService } from "../../common/prisma/prisma.service";
import { RedisService } from "../../common/redis/redis.service";
import { CacheService } from "../../common/cache/cache.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";

@ApiTags("admin")
@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
@ApiBearerAuth()
export class AdminController {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private cache: CacheService,
  ) {}

  @Get("dashboard")
  @ApiOperation({ summary: "إحصائيات لوحة التحكم" })
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
      this.prisma.user.count({ where: { status: "ACTIVE" } }),
      this.prisma.user.count({ where: { status: "BANNED" } }),
      this.prisma.room.count(),
      this.prisma.room.count({ where: { status: "ACTIVE" } }),
      this.prisma.message.count(),
      this.prisma.giftSend.count(),
      this.prisma.giftSend.aggregate({ _sum: { totalPrice: true } }),
    ]);

    // Get today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [newUsersToday, messagestoday, giftsToday] = await Promise.all([
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

  @Get("actions")
  @ApiOperation({ summary: "سجل إجراءات المسؤولين" })
  async getAdminActions(
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 50,
  ): Promise<any> {
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
        orderBy: { createdAt: "desc" },
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

  @Get("online")
  @ApiOperation({ summary: "المستخدمين المتصلين" })
  async getOnlineUsers() {
    // This is a simplified version - in production you'd scan Redis keys
    const client = this.redis.getClient();
    const keys = client ? await client.keys("presence:user:*") : [];
    const onlineCount = keys.length;

    return {
      onlineCount,
      // You could expand this to get user details
    };
  }

  @Get("revenue")
  @ApiOperation({ summary: "تقرير الإيرادات" })
  async getRevenue(
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
  ) {
    const where: any = {
      type: { in: ["DEPOSIT", "PURCHASE"] },
      status: "COMPLETED",
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

    const totalRevenue =
      typeof result._sum.amount === "bigint"
        ? Number(result._sum.amount)
        : result._sum.amount || 0;

    const dailyBreakdown = (dailyRevenue as any[]).map((row) => ({
      ...row,
      total:
        typeof row.total === "bigint" ? Number(row.total) : Number(row.total),
      count:
        typeof row.count === "bigint" ? Number(row.count) : Number(row.count),
    }));

    return {
      totalRevenue,
      transactionCount: result._count.id,
      dailyBreakdown,
    };
  }

  @Get("system/health")
  @ApiOperation({ summary: "حالة النظام" })
  async getSystemHealth() {
    const health: any = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      services: {},
    };

    // Check PostgreSQL
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      health.services.postgres = { status: "up" };
    } catch (error) {
      health.services.postgres = { status: "down", error: error.message };
      health.status = "unhealthy";
    }

    // Check Redis
    try {
      const client = this.redis.getClient();
      if (client) {
        await client.ping();
        health.services.redis = { status: "up" };
      } else {
        health.services.redis = {
          status: "disabled",
          message: "Using in-memory fallback",
        };
      }
    } catch (error) {
      health.services.redis = { status: "down", error: error.message };
      health.status = "unhealthy";
    }

    // Cache stats
    health.services.cache = this.cache.getStats();

    return health;
  }

  @Get("cache/stats")
  @ApiOperation({ summary: "إحصائيات الـ Cache" })
  async getCacheStats() {
    return {
      ...this.cache.getStats(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get("users/banned")
  @ApiOperation({ summary: "جلب المستخدمين المحظورين" })
  async getBannedUsers() {
    const users = await this.prisma.user.findMany({
      where: { status: "BANNED" },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatar: true,
        role: true,
        status: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    return { data: users };
  }

  @Get("stats")
  @ApiOperation({ summary: "إحصائيات التطبيق" })
  async getAppStats() {
    const [totalUsers, totalRooms, bannedUsers, activeUsers] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.room.count(),
        this.prisma.user.count({ where: { status: "BANNED" } }),
        this.prisma.user.count({ where: { status: "ACTIVE" } }),
      ]);

    // Get online users from Redis
    let onlineUsers = 0;
    try {
      const client = this.redis.getClient();
      if (client) {
        const keys = await client.keys("presence:user:*");
        onlineUsers = keys.length;
      }
    } catch (e) {}

    return {
      totalUsers,
      totalRooms,
      totalPosts: 0,
      bannedUsers,
      activeUsers,
      onlineUsers,
    };
  }

  @Get("users")
  @ApiOperation({ summary: "جلب المستخدمين" })
  async getUsers(
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 20,
    @Query("search") search?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: "insensitive" } },
        { username: { contains: search, mode: "insensitive" } },
        { displayName: { contains: search, mode: "insensitive" } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          avatar: true,
          role: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  @Get("users/search")
  @ApiOperation({ summary: "بحث عن مستخدمين" })
  async searchUsers(@Query("q") query: string, @Query("limit") limit = 20) {
    if (!query || query.length < 2) {
      return { data: [] };
    }

    // Build search conditions
    const searchConditions: any[] = [
      { email: { contains: query, mode: "insensitive" } },
      { username: { contains: query, mode: "insensitive" } },
      { displayName: { contains: query, mode: "insensitive" } },
    ];

    // Only add numericId search if query is a valid number
    if (/^\d+$/.test(query)) {
      try {
        searchConditions.push({ numericId: { equals: BigInt(query) } });
      } catch (e) {
        // Ignore invalid BigInt
      }
    }

    // Also search by UUID if it looks like one
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query)) {
      searchConditions.push({ id: query });
    }

    const users = await this.prisma.user.findMany({
      where: {
        OR: searchConditions,
      },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatar: true,
        role: true,
        status: true,
        numericId: true,
        wallet: {
          select: {
            balance: true,
          },
        },
      },
      take: Number(limit),
    }) as any;

    // Convert BigInt to string for JSON serialization
    const serializedUsers = users.map((user: any) => ({
      ...user,
      numericId: user.numericId ? user.numericId.toString() : null,
      wallet: user.wallet
        ? {
            balance: user.wallet.balance
              ? user.wallet.balance.toString()
              : "0",
          }
        : null,
    }));

    return { data: serializedUsers };
  }
}
