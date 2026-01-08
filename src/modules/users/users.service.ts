import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { RedisService } from "../../common/redis/redis.service";
import { CacheService, CACHE_TTL } from "../../common/cache/cache.service";
import {
  UpdateProfileDto,
  UpdateUsernameDto,
  AdminUpdateUserDto,
  UserQueryDto,
} from "./dto/users.dto";
import { UserStatus, UserRole } from "@prisma/client";

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private cache: CacheService,
  ) {}

  // ================================
  // GET USER BY ID
  // ================================

  async findById(id: string) {
    // Try cache first (with graceful fallback)
    let cached: any = null;
    try {
      cached = await this.cache.getCachedUser<any>(id);
    } catch (cacheError) {
      this.logger.warn(`Cache error for user ${id}: ${cacheError.message}`);
      // Continue without cache
    }

    if (cached) {
      // Add online status (always fresh, with fallback)
      let isOnline = false;
      try {
        isOnline = await this.redis.isUserOnline(id);
      } catch (redisError) {
        this.logger.warn(
          `Redis error checking online status: ${redisError.message}`,
        );
      }
      return { ...cached, isOnline };
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        numericId: true,
        email: true,
        username: true,
        displayName: true,
        avatar: true,
        bio: true,
        role: true,
        status: true,
        emailVerified: true,
        createdAt: true,
        wallet: {
          select: {
            balance: true,
            diamonds: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException("المستخدم غير موجود");
    }

    // Cache the user data (non-blocking, with error handling)
    try {
      await this.cache.cacheUser(id, user, CACHE_TTL.USER_PROFILE);
    } catch (cacheError) {
      this.logger.warn(`Failed to cache user ${id}: ${cacheError.message}`);
    }

    // Add online status from Redis (with fallback)
    let isOnline = false;
    try {
      isOnline = await this.redis.isUserOnline(id);
    } catch (redisError) {
      this.logger.warn(
        `Redis error checking online status: ${redisError.message}`,
      );
    }

    return {
      ...user,
      numericId: user.numericId?.toString(),
      isOnline,
      // Ensure wallet is always present (even if null in DB)
      wallet: user.wallet ?? { balance: 0, diamonds: 0 },
    };
  }

  // ================================
  // GET USER BY USERNAME
  // ================================

  async findByUsername(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      select: {
        id: true,
        numericId: true,
        username: true,
        displayName: true,
        avatar: true,
        bio: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException("المستخدم غير موجود");
    }

    const isOnline = await this.redis.isUserOnline(user.id);

    return {
      ...user,
      numericId: user.numericId?.toString(),
      isOnline,
    };
  }

  // ================================
  // GET USER BY NUMERIC ID
  // ================================

  async findByNumericId(numericId: string) {
    const user = await this.prisma.user.findUnique({
      where: { numericId: BigInt(numericId) },
      select: {
        id: true,
        numericId: true,
        username: true,
        displayName: true,
        avatar: true,
        bio: true,
        createdAt: true,
        wallet: {
          select: {
            balance: true,
            diamonds: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException("المستخدم غير موجود");
    }

    const isOnline = await this.redis.isUserOnline(user.id);

    return {
      ...user,
      numericId: user.numericId.toString(),
      isOnline,
    };
  }

  // ================================
  // UPDATE PROFILE
  // ================================

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: {
        id: true,
        numericId: true,
        email: true,
        username: true,
        displayName: true,
        avatar: true,
        bio: true,
        role: true,
        emailVerified: true,
      },
    });

    // Invalidate cache after update
    await this.cache.invalidateUser(userId);

    this.logger.log(`User ${userId} updated profile`);

    return user;
  }

  // ================================
  // UPDATE USERNAME
  // ================================

  async updateUsername(userId: string, dto: UpdateUsernameDto) {
    const newUsername = dto.username.toLowerCase();

    // Check if username is taken
    const existing = await this.prisma.user.findUnique({
      where: { username: newUsername },
    });

    if (existing && existing.id !== userId) {
      throw new ConflictException("اسم المستخدم موجود بالفعل");
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { username: newUsername },
      select: {
        id: true,
        numericId: true,
        username: true,
      },
    });

    this.logger.log(`User ${userId} changed username to ${newUsername}`);

    return user;
  }

  // ================================
  // GET USER LIST (ADMIN)
  // ================================

  async findAll(query: UserQueryDto) {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      role,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: "insensitive" } },
        { username: { contains: search, mode: "insensitive" } },
        { displayName: { contains: search, mode: "insensitive" } },
      ];
    }

    if (status) {
      where.status = status;
    }

    if (role) {
      where.role = role;
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          numericId: true,
          email: true,
          username: true,
          displayName: true,
          avatar: true,
          role: true,
          status: true,
          emailVerified: true,
          createdAt: true,
          lastLoginAt: true,
          wallet: {
            select: {
              balance: true,
              diamonds: true,
            },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ================================
  // ADMIN UPDATE USER
  // ================================

  async adminUpdate(
    targetId: string,
    dto: AdminUpdateUserDto,
    adminId: string,
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
    });

    if (!target) {
      throw new NotFoundException("المستخدم غير موجود");
    }

    // Prevent modifying super admins
    if (target.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException("لا يمكن تعديل صلاحيات المسؤول الأعلى");
    }

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: {
        ...(dto.displayName && { displayName: dto.displayName }),
        ...(dto.role && { role: dto.role as any }),
        ...(dto.status && { status: dto.status as any }),
      },
      select: {
        id: true,
        numericId: true,
        email: true,
        username: true,
        displayName: true,
        role: true,
        status: true,
      },
    });

    // Log admin action
    await this.prisma.adminAction.create({
      data: {
        actorId: adminId,
        targetId,
        action:
          dto.status === UserStatus.BANNED ? "USER_BANNED" : "SETTINGS_CHANGED",
        details: dto as any,
      },
    });

    this.logger.log(`Admin ${adminId} updated user ${targetId}`);

    return updated;
  }

  // ================================
  // BAN USER
  // ================================

  async banUser(targetId: string, adminId: string, reason?: string) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
    });

    if (!target) {
      throw new NotFoundException("المستخدم غير موجود");
    }

    if (
      target.role === UserRole.SUPER_ADMIN ||
      target.role === UserRole.ADMIN
    ) {
      throw new ForbiddenException("لا يمكن حظر المسؤولين");
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetId },
        data: { status: UserStatus.BANNED },
      }),
      // Revoke all refresh tokens
      this.prisma.refreshToken.updateMany({
        where: { userId: targetId },
        data: { revokedAt: new Date() },
      }),
      // Log action
      this.prisma.adminAction.create({
        data: {
          actorId: adminId,
          targetId,
          action: "USER_BANNED",
          reason,
        },
      }),
    ]);

    // Force disconnect from WebSocket
    await this.redis.setUserOffline(targetId);

    this.logger.log(`Admin ${adminId} banned user ${targetId}`);

    return { message: "تم حظر المستخدم" };
  }

  // ================================
  // UNBAN USER
  // ================================

  async unbanUser(targetId: string, adminId: string) {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetId },
        data: { status: UserStatus.ACTIVE },
      }),
      this.prisma.adminAction.create({
        data: {
          actorId: adminId,
          targetId,
          action: "USER_UNBANNED",
        },
      }),
    ]);

    this.logger.log(`Admin ${adminId} unbanned user ${targetId}`);

    return { message: "تم رفع الحظر عن المستخدم" };
  }

  // ================================
  // GET USER STATS
  // ================================

  async getUserStats(userId: string) {
    const [roomsOwned, roomsJoined, messagesSent, giftsSent, giftsReceived] =
      await Promise.all([
        this.prisma.room.count({ where: { ownerId: userId } }),
        this.prisma.roomMember.count({ where: { userId, leftAt: null } }),
        this.prisma.message.count({ where: { senderId: userId } }),
        this.prisma.giftSend.count({ where: { senderId: userId } }),
        this.prisma.giftSend.count({ where: { receiverId: userId } }),
      ]);

    return {
      roomsOwned,
      roomsJoined,
      messagesSent,
      giftsSent,
      giftsReceived,
    };
  }
}
