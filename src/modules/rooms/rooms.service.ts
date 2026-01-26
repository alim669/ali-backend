import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { PrismaService } from "../../common/prisma/prisma.service";
import { RedisService } from "../../common/redis/redis.service";
import { CacheService, CACHE_TTL } from "../../common/cache/cache.service";
import { AppGateway } from "../websocket/app.gateway";
import {
  CreateRoomDto,
  UpdateRoomDto,
  JoinRoomDto,
  UpdateMemberDto,
  RoomQueryDto,
  KickMemberDto,
} from "./dto/rooms.dto";
import {
  RoomStatus,
  MemberRole,
  RoomType,
  Prisma,
  Room,
  RoomMember,
} from "@prisma/client";

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private cache: CacheService,
    private gateway: AppGateway,
  ) {}

  // ================================
  // CREATE ROOM
  // ================================

  async create(dto: CreateRoomDto, userId: string) {
    this.logger.log(
      `📦 Creating room: name="${dto.name}", type="${dto.type}", userId="${userId}"`,
    );

    let passwordHash: string | null = null;

    if (dto.password) {
      passwordHash = await argon2.hash(dto.password);
    }

    const room = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
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
      },
    );

    this.logger.log(`User ${userId} created room ${room.id} (numericId: ${room.numericId})`);

    return {
      id: room.id,
      numericId: room.numericId,
      name: room.name,
      description: room.description,
      avatar: room.avatar,
      type: room.type,
      maxMembers: room.maxMembers,
      currentMembers: room.currentMembers,
      isPasswordProtected: room.isPasswordProtected,
      ownerId: userId, // 🔐 إضافة ownerId في الاستجابة
      createdAt: room.createdAt,
    };
  }

  // ================================
  // GET ROOMS LIST
  // ================================

  async findAll(query: RoomQueryDto) {
    this.logger.log(`🔍 findAll rooms query: ${JSON.stringify(query)}`);

    const {
      page = 1,
      limit = 20,
      search,
      type,
      sortBy = "currentMembers",
      sortOrder = "desc",
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      status: RoomStatus.ACTIVE,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
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
          numericId: true,
          name: true,
          description: true,
          avatar: true,
          type: true,
          maxMembers: true,
          currentMembers: true,
          isPasswordProtected: true,
          ownerId: true, // 🔐 إضافة ownerId مباشرة
          settings: true, // 👑 إعدادات الغرفة (isVip, vipExpiresAt, etc.)
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

    this.logger.log(`🔍 findAll found ${rooms.length} rooms (total: ${total})`);
    
    // Log numericIds for debugging
    rooms.forEach(room => {
      this.logger.log(`  Room: ${room.id.substring(0, 15)}... numericId=${room.numericId}`);
    });

    // Add online counts from Redis
    const roomsWithOnline = await Promise.all(
      rooms.map(async (room) => ({
        ...room,
        onlineCount: await this.redis.getRoomOnlineCount(room.id),
      })),
    );

    // 👑 ترتيب الغرف: VIP أولاً (النشطة فقط) ثم الباقي
    const now = new Date();
    const sortedRooms = roomsWithOnline.sort((a, b) => {
      const aSettings = a.settings as any || {};
      const bSettings = b.settings as any || {};
      
      // تحقق من VIP نشط (isVip = true و vipExpiresAt لم تنتهي)
      const aIsVip = aSettings.isVip && (!aSettings.vipExpiresAt || new Date(aSettings.vipExpiresAt) > now);
      const bIsVip = bSettings.isVip && (!bSettings.vipExpiresAt || new Date(bSettings.vipExpiresAt) > now);
      
      if (aIsVip && !bIsVip) return -1;
      if (!aIsVip && bIsVip) return 1;
      
      // ترتيب حسب الأعضاء للغرف من نفس النوع
      return (b.currentMembers || 0) - (a.currentMembers || 0);
    });

    return {
      data: sortedRooms,
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
          orderBy: { joinedAt: "asc" },
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
      throw new NotFoundException("الغرفة غير موجودة");
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

    this.logger.log(`📦 findById: room.id=${room.id}, numericId=${room.numericId}`);

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
  // GET ROOM BY NUMERIC ID
  // ================================

  async findByNumericId(numericId: number, userId?: string) {
    const room = await this.prisma.room.findUnique({
      where: { numericId: numericId },
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
          orderBy: { joinedAt: "asc" },
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
      throw new NotFoundException("الغرفة غير موجودة");
    }

    // Check if user is member
    let membership = null;
    if (userId) {
      membership = await this.prisma.roomMember.findUnique({
        where: {
          roomId_userId: { roomId: room.id, userId },
        },
      });
    }

    // Get online users
    const onlineUsers = await this.redis.getRoomOnlineUsers(room.id);

    this.logger.log(`📦 findByNumericId: room.id=${room.id}, numericId=${room.numericId}`);

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
    const room = await this.getRoomWithPermission(roomId, userId, [
      MemberRole.OWNER,
      MemberRole.ADMIN,
    ]);

    // 👑 دمج الإعدادات القديمة مع الجديدة
    const currentSettings = (room.settings as any) || {};
    const newSettings = dto.settings ? { ...currentSettings, ...dto.settings } : currentSettings;
    
    const updated = await this.prisma.room.update({
      where: { id: roomId },
      data: {
        ...dto,
        settings: newSettings,
      },
      select: {
        id: true,
        numericId: true,
        name: true,
        description: true,
        avatar: true,
        maxMembers: true,
        settings: true, // 👑 إرجاع الإعدادات
      },
    });

    // Invalidate cache
    await this.cache.invalidateRoom(roomId);

    this.logger.log(`User ${userId} updated room ${roomId}, settings: ${JSON.stringify(newSettings)}`);

    // Notify room members via WebSocket
    await this.gateway.notifyRoomUpdated(roomId, {
      roomId,
      avatar: updated.avatar,
      name: updated.name,
      description: updated.description,
      settings: newSettings,
      backgroundUrl: dto.settings?.backgroundUrl,
    }, userId);

    return updated;
  }

  // ================================
  // DELETE ROOM
  // ================================

  async delete(roomId: string, userId: string) {
    const room = await this.getRoomWithPermission(roomId, userId, [
      MemberRole.OWNER,
    ]);

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

    return { message: "تم حذف الغرفة" };
  }

  // ================================
  // JOIN ROOM
  // ================================

  async join(roomId: string, userId: string, dto?: JoinRoomDto) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      throw new NotFoundException("الغرفة غير موجودة");
    }

    if (room.status !== RoomStatus.ACTIVE) {
      throw new ForbiddenException("الغرفة مغلقة");
    }

    // Check existing membership
    const existingMember = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });

    if (existingMember) {
      if (existingMember.isBanned) {
        if (
          existingMember.bannedUntil &&
          existingMember.bannedUntil > new Date()
        ) {
          throw new ForbiddenException("أنت محظور من هذه الغرفة");
        }
        // Unban if ban expired
        await this.prisma.roomMember.update({
          where: { id: existingMember.id },
          data: { isBanned: false, bannedUntil: null },
        });
      }

      if (!existingMember.leftAt) {
        // المستخدم عضو بالفعل - نرجع نجاح بدلاً من خطأ
        this.logger.log(`User ${userId} already a member of room ${roomId}`);
        return { message: "أنت عضو بالفعل في هذه الغرفة", alreadyMember: true };
      }

      // Rejoin
      await this.prisma.roomMember.update({
        where: { id: existingMember.id },
        data: { leftAt: null, isBanned: false },
      });
    } else {
      // Check capacity
      if (room.currentMembers >= room.maxMembers) {
        throw new ForbiddenException("الغرفة ممتلئة");
      }

      // Check password
      if (room.isPasswordProtected && room.passwordHash) {
        if (!dto?.password) {
          throw new BadRequestException("هذه الغرفة تتطلب كلمة مرور");
        }

        const isValid = await argon2.verify(room.passwordHash, dto.password);
        if (!isValid) {
          throw new ForbiddenException("كلمة المرور غير صحيحة");
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

    return { message: "تم الانضمام للغرفة" };
  }

  // ================================
  // LEAVE ROOM
  // ================================

  async leave(roomId: string, userId: string) {
    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });

    if (!membership || membership.leftAt) {
      throw new BadRequestException("أنت لست عضواً في هذه الغرفة");
    }

    // Owner cannot leave, must transfer or delete
    if (membership.role === MemberRole.OWNER) {
      throw new ForbiddenException(
        "لا يمكن لمالك الغرفة المغادرة. قم بنقل الملكية أو حذف الغرفة",
      );
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

    return { message: "تم مغادرة الغرفة" };
  }

  // ================================
  // KICK MEMBER
  // ================================

  async kickMember(
    roomId: string,
    targetId: string,
    userId: string,
    dto?: KickMemberDto,
  ) {
    await this.getRoomWithPermission(roomId, userId, [
      MemberRole.OWNER,
      MemberRole.ADMIN,
      MemberRole.MODERATOR,
    ]);

    const targetMembership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: targetId } },
    });

    if (!targetMembership) {
      throw new NotFoundException("العضو غير موجود");
    }

    // Cannot kick owner
    if (targetMembership.role === MemberRole.OWNER) {
      throw new ForbiddenException("لا يمكن طرد مالك الغرفة");
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

    return { message: dto?.ban ? "تم طرد وحظر العضو" : "تم طرد العضو" };
  }

  // ================================
  // UPDATE MEMBER ROLE
  // ================================

  async updateMember(
    roomId: string,
    targetId: string,
    userId: string,
    dto: UpdateMemberDto,
  ) {
    await this.getRoomWithPermission(roomId, userId, [
      MemberRole.OWNER,
      MemberRole.ADMIN,
    ]);

    const targetMembership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: targetId } },
    });

    if (!targetMembership) {
      throw new NotFoundException("العضو غير موجود");
    }

    if (targetMembership.role === MemberRole.OWNER) {
      throw new ForbiddenException("لا يمكن تعديل صلاحيات المالك");
    }

    const updated = await this.prisma.roomMember.update({
      where: { id: targetMembership.id },
      data: dto,
    });

    this.logger.log(
      `User ${userId} updated member ${targetId} in room ${roomId}`,
    );

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
      orderBy: { joinedAt: "desc" },
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
              verification: {
                select: {
                  type: true,
                  expiresAt: true,
                },
              },
            },
          },
        },
        orderBy: [
          { role: "asc" }, // Owner first, then Admin, Moderator, Member
          { joinedAt: "asc" },
        ],
        skip,
        take: limit,
      }),
      this.prisma.roomMember.count({
        where: { roomId, leftAt: null, isBanned: false },
      }),
    ]);

    // Add online status and verification type
    const onlineUsers = await this.redis.getRoomOnlineUsers(roomId);
    const now = new Date();
    const membersWithOnline = members.map(
      (
        m: RoomMember & {
          user: {
            id: string;
            username: string;
            displayName: string | null;
            avatar: string | null;
            verification: { type: string; expiresAt: Date } | null;
          };
        },
      ) => {
        const hasActiveVerification = m.user.verification && 
          new Date(m.user.verification.expiresAt) > now;
        return {
          ...m,
          isOnline: onlineUsers.includes(m.userId),
          verificationType: hasActiveVerification ? m.user.verification?.type : null,
        };
      },
    );

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
      throw new NotFoundException("المستخدم ليس عضواً في الغرفة");
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

    this.logger.log(
      `User ${userId} transferred ownership of room ${roomId} to ${newOwnerId}`,
    );

    return { message: "تم نقل الملكية" };
  }

  // ================================
  // HELPER: Check Permission
  // ================================

  private async getRoomWithPermission(
    roomId: string,
    userId: string,
    allowedRoles: MemberRole[],
  ) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      throw new NotFoundException("الغرفة غير موجودة");
    }

    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });

    if (!membership || !allowedRoles.includes(membership.role)) {
      throw new ForbiddenException("ليس لديك الصلاحية");
    }

    return room;
  }

  // ================================
  // MIC SLOTS MANAGEMENT
  // ================================

  /**
   * Get mic slots state for a room
   */
  async getMicSlots(roomId: string) {
    const slots = await this.redis.client.hgetall(`room:${roomId}:mic_slots`);
    const result: any[] = [];

    // Default 8 slots
    for (let i = 0; i < 8; i++) {
      const slotData = slots[i.toString()];
      if (slotData) {
        try {
          result.push({ index: i, ...JSON.parse(slotData) });
        } catch {
          result.push({ index: i, userId: null, isLocked: false, isMuted: false });
        }
      } else {
        result.push({ index: i, userId: null, isLocked: false, isMuted: false });
      }
    }

    return { slots: result };
  }

  /**
   * Enter a mic slot
   */
  async enterMicSlot(roomId: string, slotIndex: number, userId: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException("الغرفة غير موجودة");
    }

    // Check if slot is available
    const slotKey = `room:${roomId}:mic_slots`;
    const existingSlot = await this.redis.client.hget(slotKey, slotIndex.toString());

    if (existingSlot) {
      const slotData = JSON.parse(existingSlot);
      if (slotData.userId && slotData.userId !== userId) {
        throw new ConflictException("المايك مشغول");
      }
      if (slotData.isLocked) {
        throw new ForbiddenException("المايك مقفل");
      }
    }

    // Get user info
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, username: true, avatar: true, numericId: true },
    });

    const slotData = {
      userId,
      userName: user?.displayName || user?.username || userId,
      userAvatar: user?.avatar,
      userNumericId: user?.numericId?.toString(),
      isLocked: false,
      isMuted: false,
      isSpeaking: false,
      joinedAt: Date.now(),
    };

    await this.redis.client.hset(slotKey, slotIndex.toString(), JSON.stringify(slotData));
    await this.redis.client.expire(slotKey, 86400); // 24 hours

    // Broadcast to room
    this.gateway.emitToRoom(roomId, "mic_slot_updated", {
      roomId,
      slotIndex,
      ...slotData,
    });

    this.logger.log(`User ${userId} entered mic slot ${slotIndex} in room ${roomId}`);

    return { success: true, slot: { index: slotIndex, ...slotData } };
  }

  /**
   * Leave a mic slot
   */
  async leaveMicSlot(roomId: string, slotIndex: number, userId: string) {
    const slotKey = `room:${roomId}:mic_slots`;
    const existingSlot = await this.redis.client.hget(slotKey, slotIndex.toString());

    if (existingSlot) {
      const slotData = JSON.parse(existingSlot);
      // Only the user on the mic or owner can leave
      if (slotData.userId && slotData.userId !== userId) {
        // Check if user is owner
        const room = await this.prisma.room.findUnique({ where: { id: roomId } });
        if (room?.ownerId !== userId) {
          throw new ForbiddenException("لا يمكنك مغادرة هذا المايك");
        }
      }
    }

    // Clear the slot
    const emptySlot = {
      userId: null,
      userName: null,
      userAvatar: null,
      isLocked: false,
      isMuted: false,
      isSpeaking: false,
    };

    await this.redis.client.hset(slotKey, slotIndex.toString(), JSON.stringify(emptySlot));

    // Broadcast to room
    this.gateway.emitToRoom(roomId, "mic_slot_updated", {
      roomId,
      slotIndex,
      ...emptySlot,
    });

    this.logger.log(`User ${userId} left mic slot ${slotIndex} in room ${roomId}`);

    return { success: true };
  }

  /**
   * Lock a mic slot (owner only)
   */
  async lockMicSlot(roomId: string, slotIndex: number, userId: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room || room.ownerId !== userId) {
      throw new ForbiddenException("ليس لديك الصلاحية");
    }

    const slotKey = `room:${roomId}:mic_slots`;
    const existingSlot = await this.redis.client.hget(slotKey, slotIndex.toString());
    
    const slotData = existingSlot ? JSON.parse(existingSlot) : {};
    slotData.isLocked = true;

    await this.redis.client.hset(slotKey, slotIndex.toString(), JSON.stringify(slotData));

    this.gateway.emitToRoom(roomId, "mic_slot_updated", {
      roomId,
      slotIndex,
      ...slotData,
    });

    return { success: true };
  }

  /**
   * Unlock a mic slot (owner only)
   */
  async unlockMicSlot(roomId: string, slotIndex: number, userId: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room || room.ownerId !== userId) {
      throw new ForbiddenException("ليس لديك الصلاحية");
    }

    const slotKey = `room:${roomId}:mic_slots`;
    const existingSlot = await this.redis.client.hget(slotKey, slotIndex.toString());
    
    const slotData = existingSlot ? JSON.parse(existingSlot) : {};
    slotData.isLocked = false;

    await this.redis.client.hset(slotKey, slotIndex.toString(), JSON.stringify(slotData));

    this.gateway.emitToRoom(roomId, "mic_slot_updated", {
      roomId,
      slotIndex,
      ...slotData,
    });

    return { success: true };
  }

  /**
   * Mute a user on mic slot (owner only)
   */
  async muteMicSlot(roomId: string, slotIndex: number, userId: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room || room.ownerId !== userId) {
      throw new ForbiddenException("ليس لديك الصلاحية");
    }

    const slotKey = `room:${roomId}:mic_slots`;
    const existingSlot = await this.redis.client.hget(slotKey, slotIndex.toString());
    
    if (!existingSlot) {
      throw new NotFoundException("المايك فارغ");
    }

    const slotData = JSON.parse(existingSlot);
    slotData.isMuted = !slotData.isMuted; // Toggle

    await this.redis.client.hset(slotKey, slotIndex.toString(), JSON.stringify(slotData));

    this.gateway.emitToRoom(roomId, "mic_slot_updated", {
      roomId,
      slotIndex,
      ...slotData,
    });

    return { success: true, isMuted: slotData.isMuted };
  }

  /**
   * Kick user from mic slot (owner only)
   */
  async kickFromMicSlot(roomId: string, slotIndex: number, userId: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room || room.ownerId !== userId) {
      throw new ForbiddenException("ليس لديك الصلاحية");
    }

    const slotKey = `room:${roomId}:mic_slots`;
    const existingSlot = await this.redis.client.hget(slotKey, slotIndex.toString());
    
    if (!existingSlot) {
      throw new NotFoundException("المايك فارغ");
    }

    const slotData = JSON.parse(existingSlot);
    const kickedUserId = slotData.userId;

    // Clear the slot
    const emptySlot = {
      userId: null,
      userName: null,
      userAvatar: null,
      isLocked: false,
      isMuted: false,
      isSpeaking: false,
    };

    await this.redis.client.hset(slotKey, slotIndex.toString(), JSON.stringify(emptySlot));

    // Broadcast to room
    this.gateway.emitToRoom(roomId, "mic_slot_updated", {
      roomId,
      slotIndex,
      ...emptySlot,
    });

    // Also notify the kicked user
    if (kickedUserId) {
      this.gateway.emitToRoom(roomId, "mic_kick", {
        roomId,
        slotIndex,
        kickedUserId,
      });
    }

    this.logger.log(`Owner ${userId} kicked user from mic slot ${slotIndex} in room ${roomId}`);

    return { success: true };
  }

  // ================================
  // UNBAN MEMBER
  // ================================

  async unbanMember(roomId: string, targetId: string, userId: string) {
    await this.getRoomWithPermission(roomId, userId, [
      MemberRole.OWNER,
      MemberRole.ADMIN,
    ]);

    const targetMembership = await this.prisma.roomMember.findFirst({
      where: { roomId, userId: targetId, isBanned: true },
    });

    if (!targetMembership) {
      throw new NotFoundException("العضو غير محظور");
    }

    await this.prisma.roomMember.update({
      where: { id: targetMembership.id },
      data: {
        isBanned: false,
        bannedUntil: null,
        leftAt: null,
      },
    });

    this.logger.log(`User ${userId} unbanned ${targetId} from room ${roomId}`);
    return { message: "تم إلغاء حظر العضو بنجاح" };
  }

  // ================================
  // MUTE/UNMUTE MEMBER
  // ================================

  async muteMember(roomId: string, targetId: string, userId: string, durationMinutes?: number) {
    await this.getRoomWithPermission(roomId, userId, [
      MemberRole.OWNER,
      MemberRole.ADMIN,
      MemberRole.MODERATOR,
    ]);

    const targetMembership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: targetId } },
    });

    if (!targetMembership) {
      throw new NotFoundException("العضو غير موجود");
    }

    const mutedUntil = durationMinutes 
      ? new Date(Date.now() + durationMinutes * 60 * 1000)
      : undefined;

    await this.prisma.roomMember.update({
      where: { id: targetMembership.id },
      data: {
        isMuted: true,
        mutedUntil,
      },
    });

    // Notify via websocket
    this.gateway.emitToRoom(roomId, "member_muted", {
      roomId,
      userId: targetId,
      mutedUntil,
    });

    this.logger.log(`User ${userId} muted ${targetId} in room ${roomId}`);
    return { message: "تم كتم العضو بنجاح" };
  }

  async unmuteMember(roomId: string, targetId: string, userId: string) {
    await this.getRoomWithPermission(roomId, userId, [
      MemberRole.OWNER,
      MemberRole.ADMIN,
      MemberRole.MODERATOR,
    ]);

    const targetMembership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: targetId } },
    });

    if (!targetMembership) {
      throw new NotFoundException("العضو غير موجود");
    }

    await this.prisma.roomMember.update({
      where: { id: targetMembership.id },
      data: {
        isMuted: false,
        mutedUntil: null,
      },
    });

    // Notify via websocket
    this.gateway.emitToRoom(roomId, "member_unmuted", {
      roomId,
      userId: targetId,
    });

    this.logger.log(`User ${userId} unmuted ${targetId} in room ${roomId}`);
    return { message: "تم إلغاء كتم العضو بنجاح" };
  }

  // ================================
  // LOCK/UNLOCK ROOM
  // ================================

  async lockRoom(roomId: string, userId: string, password?: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException("الغرفة غير موجودة");
    }
    if (room.ownerId !== userId) {
      throw new ForbiddenException("فقط المالك يمكنه قفل الغرفة");
    }

    // Hash password if provided
    let passwordHash: string | null = null;
    if (password) {
      const bcrypt = await import("bcrypt");
      passwordHash = await bcrypt.hash(password, 10);
    }

    await this.prisma.room.update({
      where: { id: roomId },
      data: {
        isPasswordProtected: true,
        passwordHash,
        status: "ACTIVE", // Keep it active but locked
      },
    });

    // Notify via websocket
    this.gateway.emitToRoom(roomId, "room_locked", {
      roomId,
      isLocked: true,
    });

    this.logger.log(`Owner ${userId} locked room ${roomId}`);
    return { message: "تم قفل الغرفة بنجاح", isLocked: true };
  }

  async unlockRoom(roomId: string, userId: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException("الغرفة غير موجودة");
    }
    if (room.ownerId !== userId) {
      throw new ForbiddenException("فقط المالك يمكنه فتح الغرفة");
    }

    await this.prisma.room.update({
      where: { id: roomId },
      data: {
        isPasswordProtected: false,
        passwordHash: null,
      },
    });

    // Notify via websocket
    this.gateway.emitToRoom(roomId, "room_unlocked", {
      roomId,
      isLocked: false,
    });

    this.logger.log(`Owner ${userId} unlocked room ${roomId}`);
    return { message: "تم فتح الغرفة بنجاح", isLocked: false };
  }
}
