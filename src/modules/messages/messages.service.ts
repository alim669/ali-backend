import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { SendMessageDto, MessageQueryDto } from './dto/messages.dto';
import { MessageType, MemberRole } from '@prisma/client';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  // ================================
  // SEND MESSAGE
  // ================================

  async send(roomId: string, userId: string, dto: SendMessageDto) {
    // Check room membership
    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });

    if (!membership || membership.leftAt || membership.isBanned) {
      throw new ForbiddenException('أنت لست عضواً في هذه الغرفة');
    }

    // Check if muted
    if (membership.isMuted) {
      if (membership.mutedUntil && membership.mutedUntil > new Date()) {
        throw new ForbiddenException('أنت كتوم في هذه الغرفة');
      }
      // Unmute if time expired
      await this.prisma.roomMember.update({
        where: { id: membership.id },
        data: { isMuted: false, mutedUntil: null },
      });
    }

    const message = await this.prisma.message.create({
      data: {
        roomId,
        senderId: userId,
        type: dto.type || MessageType.TEXT,
        content: dto.content,
        metadata: dto.metadata as any,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
      },
    });

    // Publish to Redis for WebSocket
    await this.redis.publish(`room:${roomId}:messages`, {
      type: 'new_message',
      data: message,
    });

    // Remove typing indicator
    await this.redis.removeTyping(roomId, userId);

    return message;
  }

  // ================================
  // GET ROOM MESSAGES
  // ================================

  async getMessages(roomId: string, userId: string, query: MessageQueryDto) {
    // Verify user can access room
    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });

    if (!membership) {
      throw new ForbiddenException('ليس لديك صلاحية الوصول لهذه الغرفة');
    }

    const { page = 1, limit = 50, before, after, type } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      roomId,
      isDeleted: false,
    };

    if (before) {
      where.createdAt = { ...where.createdAt, lt: new Date(before) };
    }

    if (after) {
      where.createdAt = { ...where.createdAt, gt: new Date(after) };
    }

    if (type) {
      where.type = type;
    }

    const [messages, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
          giftSend: {
            include: {
              gift: {
                select: {
                  id: true,
                  name: true,
                  imageUrl: true,
                  animationUrl: true,
                  type: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.message.count({ where }),
    ]);

    return {
      data: messages.reverse(), // Return in chronological order
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + limit < total,
      },
    };
  }

  // ================================
  // DELETE MESSAGE
  // ================================

  async delete(messageId: string, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        room: {
          include: {
            members: {
              where: { userId },
            },
          },
        },
      },
    });

    if (!message) {
      throw new NotFoundException('الرسالة غير موجودة');
    }

    // Check permission: sender or room moderator+
    const membership = message.room.members[0];
    const canDelete =
      message.senderId === userId ||
      (membership && ([MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MODERATOR] as string[]).includes(membership.role));

    if (!canDelete) {
      throw new ForbiddenException('ليس لديك صلاحية حذف هذه الرسالة');
    }

    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: userId,
      },
    });

    // Notify via WebSocket
    await this.redis.publish(`room:${message.roomId}:messages`, {
      type: 'message_deleted',
      data: { messageId, deletedBy: userId },
    });

    return { message: 'تم حذف الرسالة' };
  }

  // ================================
  // TYPING INDICATOR
  // ================================

  async setTyping(roomId: string, userId: string) {
    await this.redis.setTyping(roomId, userId);

    // Publish typing event
    await this.redis.publish(`room:${roomId}:typing`, {
      type: 'typing',
      userId,
    });
  }

  async stopTyping(roomId: string, userId: string) {
    await this.redis.removeTyping(roomId, userId);

    await this.redis.publish(`room:${roomId}:typing`, {
      type: 'stop_typing',
      userId,
    });
  }

  async getTypingUsers(roomId: string): Promise<string[]> {
    return this.redis.getTypingUsers(roomId);
  }

  // ================================
  // CREATE SYSTEM MESSAGE
  // ================================

  async createSystemMessage(roomId: string, content: string) {
    // Get room owner as sender for system messages
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      throw new NotFoundException('الغرفة غير موجودة');
    }

    const message = await this.prisma.message.create({
      data: {
        roomId,
        senderId: room.ownerId,
        type: MessageType.SYSTEM,
        content,
      },
    });

    await this.redis.publish(`room:${roomId}:messages`, {
      type: 'system_message',
      data: message,
    });

    return message;
  }

  // ================================
  // CREATE GIFT MESSAGE
  // ================================

  async createGiftMessage(
    roomId: string,
    senderId: string,
    giftSendId: string,
    content: string,
  ) {
    const message = await this.prisma.message.create({
      data: {
        roomId,
        senderId,
        type: MessageType.GIFT,
        content,
        giftSendId,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
        giftSend: {
          include: {
            gift: {
              select: {
                id: true,
                name: true,
                imageUrl: true,
                animationUrl: true,
                videoUrl: true,
                type: true,
              },
            },
            receiver: {
              select: {
                id: true,
                username: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    await this.redis.publish(`room:${roomId}:messages`, {
      type: 'gift_message',
      data: message,
    });

    return message;
  }
}
