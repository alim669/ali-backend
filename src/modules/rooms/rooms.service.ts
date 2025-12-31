import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { CacheService, CACHE_TTL } from '../../common/cache/cache.service';
import {
  CreateRoomDto,
  UpdateRoomDto,
  JoinRoomDto,
  UpdateMemberDto,
  RoomQueryDto,
  KickMemberDto,
} from './dto/rooms.dto';
import { RoomStatus, MemberRole, RoomType, Prisma, Room, RoomMember } from '@prisma/client';

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private cache: CacheService,
  ) {}

  // ================================
  // CREATE ROOM
  // ================================

  async create(dto: CreateRoomDto, userId: string) {
    let passwordHash: string | null = null;

    if (dto.password) {
      passwordHash = await argon2.hash(dto.password);
    }

    const room = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Create room
      const newRoom = await tx.room.create({
        data: {
          name: dto.name,
          description: dto.description,
          avatar: dto.avatar,
          type: dto.type || RoomType.PUBLIC,
          maxMembers: dto.maxMembers || 100,
          ownerId: userId,
          isPasswordProtected: !!dto.password,
          passwordHash,
          currentMembers: 1,
        },
      });

      // Add owner as first member
      await tx.roomMember.create({
        data: {
          roomId: newRoom.id,
          userId,
          role: MemberRole.OWNER,
        },
      });

      return newRoom;
    });

    this.logger.log(`User ${userId} created room ${room.id}`);

    return {
      id: room.id,
      name: room.name,
      description: room.description,
      avatar: room.avatar,
      type: room.type,
      maxMembers: room.maxMembers,
      currentMembers: room.currentMembers,
      isPasswordProtected: room.isPasswordProtected,
      createdAt: room.createdAt,
    };
  }

  // ================================
  // GET ROOMS LIST
  // ================================

  async findAll(query: RoomQueryDto) {
    const {
      page = 1,
      limit = 20,
      search,
      type,
      sortBy = 'currentMembers',
      sortOrder = 'desc',
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      status: RoomStatus.ACTIVE,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (type) {
      where.type = type;
    }

    const [rooms, total] = await Promise.all([
      this.prisma.room.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          avatar: true,
          type: true,
          maxMembers: true,
          currentMembers: true,
          isPasswordProtected: true,
          createdAt: true,
          owner: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.room.count({ where }),
    ]);

    // Add online counts from Redis
    const roomsWithOnline = await Promise.all(
      rooms.map(async (room) => ({
        ...room,
        onlineCount: await this.redis.getRoomOnlineCount(room.id),
      })),
    );

    return {
      data: roomsWithOnline,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ================================
  // GET ROOM BY ID
  // ================================

  async findById(roomId: string, userId?: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
        members: {
          where: { leftAt: null, isBanned: false },
          take: 50,
          orderBy: { joinedAt: 'asc' },
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
        },
      },
    });

    if (!room) {
      throw new NotFoundException('الغرفة غير موجودة');
    }

    // Check if user is member
    let membership = null;
    if (userId) {
      membership = await this.prisma.roomMember.findUnique({
        where: {
          roomId_userId: { roomId, userId },
        },
      });
    }

    // Get online users
    const onlineUsers = await this.redis.getRoomOnlineUsers(roomId);

    return {
      ...room,
      passwordHash: undefined, // Never expose
      onlineCount: onlineUsers.length,
      onlineUsers,
      isMember: !!membership,
      memberRole: membership?.role,
    };
  }

  // ================================
  // UPDATE ROOM
  // ================================

  async update(roomId: string, dto: UpdateRoomDto, userId: string) {
    const room = await this.getRoomWithPermission(roomId, userId, [MemberRole.OWNER, MemberRole.ADMIN]);

    const updated = await this.prisma.room.update({
      where: { id: roomId },
      data: dto,
      select: {
        id: true,
        name: true,
        description: true,
        avatar: true,
        maxMembers: true,
      },
    });

    // Invalidate cache
    await this.cache.invalidateRoom(roomId);

    this.logger.log(`User ${userId} updated room ${roomId}`);

    return updated;
  }

  // ================================
  // DELETE ROOM
  // ================================

  async delete(roomId: string, userId: string) {
    const room = await this.getRoomWithPermission(roomId, userId, [MemberRole.OWNER]);

    await this.prisma.$transaction([
      // Delete all members
      this.prisma.roomMember.deleteMany({ where: { roomId } }),
      // Delete all messages
      this.prisma.message.deleteMany({ where: { roomId } }),
      // Delete room
      this.prisma.room.delete({ where: { id: roomId } }),
    ]);

    // Clear Redis data
    await this.redis.del(`room:${roomId}:online`);
    
    // Invalidate cache
    await this.cache.invalidateRoom(roomId);

    this.logger.log(`User ${userId} deleted room ${roomId}`);

    return { message: 'تم حذف الغرفة' };
  }

  // ================================
  // JOIN ROOM
  // ================================

  async join(roomId: string, userId: string, dto?: JoinRoomDto) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      throw new NotFoundException('الغرفة غير موجودة');
    }

    if (room.status !== RoomStatus.ACTIVE) {
      throw new ForbiddenException('الغرفة مغلقة');
    }

    // Check existing membership
    const existingMember = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });

    if (existingMember) {
      if (existingMember.isBanned) {
        if (existingMember.bannedUntil && existingMember.bannedUntil > new Date()) {
          throw new ForbiddenException('أنت محظور من هذه الغرفة');
        }
        // Unban if ban expired
        await this.prisma.roomMember.update({
          where: { id: existingMember.id },
          data: { isBanned: false, bannedUntil: null },
        });
      }

      if (!existingMember.leftAt) {
        throw new ConflictException('أنت عضو بالفعل في هذه الغرفة');
      }

      // Rejoin
      await this.prisma.roomMember.update({
        where: { id: existingMember.id },
        data: { leftAt: null, isBanned: false },
      });
    } else {
      // Check capacity
      if (room.currentMembers >= room.maxMembers) {
        throw new ForbiddenException('الغرفة ممتلئة');
      }

      // Check password
      if (room.isPasswordProtected && room.passwordHash) {
        if (!dto?.password) {
          throw new BadRequestException('هذه الغرفة تتطلب كلمة مرور');
        }

        const isValid = await argon2.verify(room.passwordHash, dto.password);
        if (!isValid) {
          throw new ForbiddenException('كلمة المرور غير صحيحة');
        }
      }

      // Create membership
      await this.prisma.roomMember.create({
        data: {
          roomId,
          userId,
          role: MemberRole.MEMBER,
        },
      });
    }

    // Increment member count
    await this.prisma.room.update({
      where: { id: roomId },
      data: { currentMembers: { increment: 1 } },
    });

    this.logger.log(`User ${userId} joined room ${roomId}`);

    return { message: 'تم الانضمام للغرفة' };
  }

  // ================================
  // LEAVE ROOM
  // ================================

  async leave(roomId: string, userId: string) {
    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });

    if (!membership || membership.leftAt) {
      throw new BadRequestException('أنت لست عضواً في هذه الغرفة');
    }

    // Owner cannot leave, must transfer or delete
    if (membership.role === MemberRole.OWNER) {
      throw new ForbiddenException('لا يمكن لمالك الغرفة المغادرة. قم بنقل الملكية أو حذف الغرفة');
    }

    await this.prisma.$transaction([
      this.prisma.roomMember.update({
        where: { id: membership.id },
        data: { leftAt: new Date() },
      }),
      this.prisma.room.update({
        where: { id: roomId },
        data: { currentMembers: { decrement: 1 } },
      }),
    ]);

    // Remove from online list
    await this.redis.removeUserFromRoom(roomId, userId);

    this.logger.log(`User ${userId} left room ${roomId}`);

    return { message: 'تم مغادرة الغرفة' };
  }

  // ================================
  // KICK MEMBER
  // ================================

  async kickMember(roomId: string, targetId: string, userId: string, dto?: KickMemberDto) {
    await this.getRoomWithPermission(roomId, userId, [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MODERATOR]);

    const targetMembership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: targetId } },
    });

    if (!targetMembership) {
      throw new NotFoundException('العضو غير موجود');
    }

    // Cannot kick owner
    if (targetMembership.role === MemberRole.OWNER) {
      throw new ForbiddenException('لا يمكن طرد مالك الغرفة');
    }

    await this.prisma.$transaction([
      this.prisma.roomMember.update({
        where: { id: targetMembership.id },
        data: {
          leftAt: new Date(),
          isBanned: dto?.ban || false,
          bannedUntil: dto?.bannedUntil,
        },
      }),
      this.prisma.room.update({
        where: { id: roomId },
        data: { currentMembers: { decrement: 1 } },
      }),
    ]);

    // Remove from online
    await this.redis.removeUserFromRoom(roomId, targetId);

    this.logger.log(`User ${userId} kicked ${targetId} from room ${roomId}`);

    return { message: dto?.ban ? 'تم طرد وحظر العضو' : 'تم طرد العضو' };
  }

  // ================================
  // UPDATE MEMBER ROLE
  // ================================

  async updateMember(roomId: string, targetId: string, userId: string, dto: UpdateMemberDto) {
    await this.getRoomWithPermission(roomId, userId, [MemberRole.OWNER, MemberRole.ADMIN]);

    const targetMembership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: targetId } },
    });

    if (!targetMembership) {
      throw new NotFoundException('العضو غير موجود');
    }

    if (targetMembership.role === MemberRole.OWNER) {
      throw new ForbiddenException('لا يمكن تعديل صلاحيات المالك');
    }

    const updated = await this.prisma.roomMember.update({
      where: { id: targetMembership.id },
      data: dto,
    });

    this.logger.log(`User ${userId} updated member ${targetId} in room ${roomId}`);

    return updated;
  }

  // ================================
  // GET MY ROOMS
  // ================================

  async getMyRooms(userId: string) {
    const memberships = await this.prisma.roomMember.findMany({
      where: { userId, leftAt: null, isBanned: false },
      include: {
        room: {
          select: {
            id: true,
            name: true,
            description: true,
            avatar: true,
            type: true,
            currentMembers: true,
            status: true,
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    return memberships.map((m: RoomMember & { room: Room }) => ({
      ...m.room,
      role: m.role,
      joinedAt: m.joinedAt,
    }));
  }

  // ================================
  // GET ROOM MEMBERS
  // ================================

  async getMembers(roomId: string, page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit;

    const [members, total] = await Promise.all([
      this.prisma.roomMember.findMany({
        where: { roomId, leftAt: null, isBanned: false },
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
        orderBy: [
          { role: 'asc' }, // Owner first, then Admin, Moderator, Member
          { joinedAt: 'asc' },
        ],
        skip,
        take: limit,
      }),
      this.prisma.roomMember.count({
        where: { roomId, leftAt: null, isBanned: false },
      }),
    ]);

    // Add online status
    const onlineUsers = await this.redis.getRoomOnlineUsers(roomId);
    const membersWithOnline = members.map((m: RoomMember & { user: { id: string; username: string; displayName: string | null; avatar: string | null } }) => ({
      ...m,
      isOnline: onlineUsers.includes(m.userId),
    }));

    return {
      data: membersWithOnline,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ================================
  // TRANSFER OWNERSHIP
  // ================================

  async transferOwnership(roomId: string, newOwnerId: string, userId: string) {
    await this.getRoomWithPermission(roomId, userId, [MemberRole.OWNER]);

    const newOwnerMembership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: newOwnerId } },
    });

    if (!newOwnerMembership || newOwnerMembership.leftAt) {
      throw new NotFoundException('المستخدم ليس عضواً في الغرفة');
    }

    await this.prisma.$transaction([
      // Make current owner an admin
      this.prisma.roomMember.updateMany({
        where: { roomId, userId, role: MemberRole.OWNER },
        data: { role: MemberRole.ADMIN },
      }),
      // Make new owner
      this.prisma.roomMember.update({
        where: { id: newOwnerMembership.id },
        data: { role: MemberRole.OWNER },
      }),
      // Update room owner
      this.prisma.room.update({
        where: { id: roomId },
        data: { ownerId: newOwnerId },
      }),
    ]);

    this.logger.log(`User ${userId} transferred ownership of room ${roomId} to ${newOwnerId}`);

    return { message: 'تم نقل الملكية' };
  }

  // ================================
  // HELPER: Check Permission
  // ================================

  private async getRoomWithPermission(roomId: string, userId: string, allowedRoles: MemberRole[]) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      throw new NotFoundException('الغرفة غير موجودة');
    }

    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });

    if (!membership || !allowedRoles.includes(membership.role)) {
      throw new ForbiddenException('ليس لديك الصلاحية');
    }

    return room;
  }
}
