import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { RedisService } from "../../common/redis/redis.service";
import { CacheService, CACHE_TTL } from "../../common/cache/cache.service";
import { MessagesService } from "../messages/messages.service";
import {
  CreateGiftDto,
  UpdateGiftDto,
  SendGiftDto,
  GiftQueryDto,
} from "./dto/gifts.dto";
import {
  TransactionType,
  TransactionStatus,
  Prisma,
  User,
} from "@prisma/client";
import { v4 as uuidv4 } from "uuid";

@Injectable()
export class GiftsService {
  private readonly logger = new Logger(GiftsService.name);
  private readonly giftRevenueSplit = {
    receiver: 0.3,
    roomOwner: 0.3,
    app: 0.4,
  };

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private cache: CacheService,
    private messagesService: MessagesService,
  ) {}

  private toBigInt(amount: number) {
    if (!Number.isFinite(amount)) {
      throw new BadRequestException("قيمة غير صالحة");
    }
    return BigInt(Math.trunc(amount));
  }

  private toNumber(value: bigint | number | null | undefined) {
    if (value === null || value === undefined) return 0;
    return typeof value === "bigint" ? Number(value) : value;
  }

  private toPrismaBigInt(value: bigint) {
    return value as unknown as number;
  }

  // ================================
  // GET ALL GIFTS
  // ================================

  async findAll(query: GiftQueryDto) {
    const { page = 1, limit = 50, type, isActive = true } = query;
    const skip = (page - 1) * limit;

    // Try cache first for default query (all active gifts)
    if (page === 1 && !type && isActive === true) {
      const cached = await this.cache.getCachedGiftsList<any>();
      if (cached && Array.isArray(cached) && cached.length > 0) {
        return {
          data: cached,
          meta: {
            total: cached.length,
            page: 1,
            limit: cached.length,
            totalPages: 1,
          },
        };
      }
    }

    const where: any = {};

    if (typeof isActive === "boolean") {
      where.isActive = isActive;
    }

    if (type) {
      where.type = type;
    }

    const [gifts, total] = await Promise.all([
      this.prisma.gift.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        skip,
        take: limit,
      }),
      this.prisma.gift.count({ where }),
    ]);

    // Cache if default query
    if (page === 1 && !type && isActive === true) {
      await this.cache.cacheGiftsList(gifts, CACHE_TTL.GIFTS_LIST);
    }

    return {
      data: gifts,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ================================
  // GET GIFT BY ID
  // ================================

  async findById(id: string) {
    const gift = await this.prisma.gift.findUnique({
      where: { id },
    });

    if (!gift) {
      throw new NotFoundException("الهدية غير موجودة");
    }

    return gift;
  }

  // ================================
  // CREATE GIFT (ADMIN)
  // ================================

  async create(dto: CreateGiftDto) {
    const gift = await this.prisma.gift.create({
      data: dto,
    });

    // Invalidate gifts cache
    await this.cache.invalidateGifts();

    this.logger.log(`Gift created: ${gift.id}`);

    return gift;
  }

  // ================================
  // UPDATE GIFT (ADMIN)
  // ================================

  async update(id: string, dto: UpdateGiftDto) {
    const gift = await this.prisma.gift.update({
      where: { id },
      data: dto,
    });

    // Invalidate gifts cache
    await this.cache.invalidateGifts();

    this.logger.log(`Gift updated: ${gift.id}`);

    return gift;
  }

  // ================================
  // DELETE GIFT (ADMIN)
  // ================================

  async delete(id: string) {
    // Soft delete by setting isActive to false
    await this.prisma.gift.update({
      where: { id },
      data: { isActive: false },
    });

    this.logger.log(`Gift deactivated: ${id}`);

    return { message: "تم إلغاء تفعيل الهدية" };
  }

  // ================================
  // CLEAR CACHE (ADMIN)
  // ================================

  async clearCache() {
    await this.cache.invalidateGifts();
    this.logger.log(`Gifts cache cleared`);
    return { message: "تم مسح cache الهدايا بنجاح" };
  }

  // ================================
  // SEND GIFT (WITH IDEMPOTENCY & TRANSACTION)
  // ================================

  async sendGift(senderId: string, dto: SendGiftDto, idempotencyKey: string) {
    this.logger.log(`🎁 sendGift called: senderId=${senderId}, giftId=${dto.giftId}, receiverId=${dto.receiverId}, roomId=${dto.roomId}`);
    
    // Check idempotency - prevent duplicate sends
    const existingSend = await this.prisma.giftSend.findUnique({
      where: { idempotencyKey },
    });

    if (existingSend) {
      this.logger.warn(`Duplicate gift send attempt: ${idempotencyKey}`);
      throw new ConflictException("تم إرسال هذه الهدية مسبقاً");
    }

    // Also check in Redis for recent sends (faster)
    const redisKey = `gift:idempotency:${idempotencyKey}`;
    const exists = await this.redis.exists(redisKey);
    if (exists) {
      throw new ConflictException("تم إرسال هذه الهدية مسبقاً");
    }

    // Get gift
    const gift = await this.prisma.gift.findUnique({
      where: { id: dto.giftId },
    });

    if (!gift || !gift.isActive) {
      throw new NotFoundException("الهدية غير موجودة أو غير متاحة");
    }

    // Validate receiver exists
    const receiver = await this.prisma.user.findUnique({
      where: { id: dto.receiverId },
      select: { id: true, displayName: true, avatar: true },
    });

    if (!receiver) {
      throw new NotFoundException("المستلم غير موجود");
    }

    // Get sender info
    const sender = await this.prisma.user.findUnique({
      where: { id: senderId },
      select: { id: true, displayName: true, avatar: true },
    });

    if (!sender) {
      throw new NotFoundException("المرسل غير موجود");
    }

    // Cannot send to yourself
    if (senderId === dto.receiverId) {
      throw new BadRequestException("لا يمكنك إرسال هدية لنفسك");
    }

    const quantity = dto.quantity || 1;
    const totalPrice = gift.price * quantity;
    const totalPriceBig = this.toBigInt(totalPrice);
    const totalPriceInput = this.toPrismaBigInt(totalPriceBig);

    // Execute in transaction
    const result = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const room = dto.roomId
          ? await tx.room.findUnique({
              where: { id: dto.roomId },
              select: { ownerId: true },
            })
          : null;
        const roomOwnerId = room?.ownerId ?? null;

        // Get sender wallet with lock (SELECT FOR UPDATE)
        const senderWallet = await tx.wallet.findUnique({
          where: { userId: senderId },
        });

        if (!senderWallet) {
          throw new BadRequestException("المحفظة غير موجودة");
        }

        if (senderWallet.balance < totalPriceBig) {
          throw new BadRequestException("رصيد غير كافي");
        }

        // Get receiver wallet
        let receiverWallet = await tx.wallet.findUnique({
          where: { userId: dto.receiverId },
        });

        if (!receiverWallet) {
          // Create wallet if doesn't exist
          receiverWallet = await tx.wallet.create({
            data: {
              userId: dto.receiverId,
              balance: 0,
              diamonds: 0,
            },
          });
        }

        // Calculate revenue split (receiver + room owner + app)
        let receiverAmount = Math.floor(
          totalPrice * this.giftRevenueSplit.receiver,
        );
        let ownerAmount = roomOwnerId
          ? Math.floor(totalPrice * this.giftRevenueSplit.roomOwner)
          : 0;

        if (roomOwnerId && roomOwnerId === dto.receiverId) {
          receiverAmount += ownerAmount;
          ownerAmount = 0;
        }

        let appAmount = totalPrice - receiverAmount - ownerAmount;
        if (appAmount < 0) {
          receiverAmount += appAmount;
          appAmount = 0;
        }

        const receiverAmountBig = this.toBigInt(receiverAmount);
        const receiverAmountInput = this.toPrismaBigInt(receiverAmountBig);
        const ownerAmountBig = this.toBigInt(ownerAmount);
        const ownerAmountInput = this.toPrismaBigInt(ownerAmountBig);

        // Deduct from sender
        const updatedSenderWallet = await tx.wallet.update({
          where: { id: senderWallet.id },
          data: {
            balance: { decrement: totalPriceInput },
            version: { increment: 1 },
          },
        });

        // Add to receiver
        const updatedReceiverWallet = await tx.wallet.update({
          where: { id: receiverWallet.id },
          data: {
            balance: { increment: receiverAmountInput },
            version: { increment: 1 },
          },
        });

        let updatedOwnerWallet = null;
        let ownerWalletBefore: { id: string; balance: number } | null = null;
        if (roomOwnerId && ownerAmount > 0) {
          let ownerWallet = await tx.wallet.findUnique({
            where: { userId: roomOwnerId },
          });

          if (!ownerWallet) {
            ownerWallet = await tx.wallet.create({
              data: {
                userId: roomOwnerId,
                balance: 0,
                diamonds: 0,
              },
            });
          }

          ownerWalletBefore = {
            id: ownerWallet.id,
            balance: this.toNumber(ownerWallet.balance as any),
          };

          updatedOwnerWallet = await tx.wallet.update({
            where: { id: ownerWallet.id },
            data: {
              balance: { increment: ownerAmountInput },
              version: { increment: 1 },
            },
          });
        }

        // Create gift send record
        const giftSend = await tx.giftSend.create({
          data: {
            idempotencyKey,
            giftId: dto.giftId,
            senderId,
            receiverId: dto.receiverId,
            roomId: dto.roomId,
            quantity,
            totalPrice,
            message: dto.message,
          },
        });

        // Create sender transaction (debit)
        await tx.walletTransaction.create({
          data: {
            walletId: senderWallet.id,
            type: TransactionType.GIFT_SENT,
            status: TransactionStatus.COMPLETED,
            amount: this.toPrismaBigInt(-totalPriceBig),
            balanceBefore: senderWallet.balance,
            balanceAfter: updatedSenderWallet.balance,
            referenceType: "gift_send",
            referenceId: giftSend.id,
            description: `إرسال هدية "${gift.name}" إلى ${receiver.displayName}`,
          },
        });

        // Create receiver transaction (credit)
        await tx.walletTransaction.create({
          data: {
            walletId: receiverWallet.id,
            type: TransactionType.GIFT_RECEIVED,
            status: TransactionStatus.COMPLETED,
            amount: receiverAmountInput,
            balanceBefore: receiverWallet.balance,
            balanceAfter: updatedReceiverWallet.balance,
            referenceType: "gift_send",
            referenceId: giftSend.id,
            description: `استلام هدية "${gift.name}"`,
          },
        });

        if (
          updatedOwnerWallet &&
          roomOwnerId &&
          ownerAmount > 0 &&
          ownerWalletBefore
        ) {
          await tx.walletTransaction.create({
            data: {
              walletId: ownerWalletBefore.id,
              type: TransactionType.GIFT_RECEIVED,
              status: TransactionStatus.COMPLETED,
              amount: ownerAmountInput,
              balanceBefore: ownerWalletBefore.balance,
              balanceAfter: updatedOwnerWallet.balance,
              referenceType: "gift_room_owner_share",
              referenceId: giftSend.id,
              description: `حصة مالك الغرفة من هدية "${gift.name}"`,
            },
          });
        }

        return {
          giftSend,
          senderBalance: updatedSenderWallet.balance,
          gift,
          roomOwnerId,
        };
      },
    );

    // Store idempotency key in Redis (expires after 24 hours)
    await this.redis.set(redisKey, "1", 86400);

    // Create gift message in room if roomId provided
    if (dto.roomId) {
      const messageContent =
        dto.message || `أرسل هدية "${result.gift.name}" 🎁`;
      await this.messagesService.createGiftMessage(
        dto.roomId,
        senderId,
        result.giftSend.id,
        messageContent,
      );
    }

    // Publish gift event for WebSocket
    const giftEventPayload = {
      type: "gift_sent",
      data: {
        giftSend: {
          ...result.giftSend,
          senderName: sender.displayName,
          senderAvatar: sender.avatar,
          receiverName: receiver.displayName,
          receiverAvatar: receiver.avatar,
        },
        gift: result.gift,
        senderId,
        senderName: sender.displayName,
        senderAvatar: sender.avatar,
        receiverId: dto.receiverId,
        receiverName: receiver.displayName,
        receiverAvatar: receiver.avatar,
        roomId: dto.roomId,
        quantity: result.giftSend.quantity,
        totalPrice: result.giftSend.totalPrice,
      },
    };
    this.logger.log(`🎁📡 Publishing gift event to Redis gifts:sent for room ${dto.roomId}`);
    await this.redis.publish("gifts:sent", giftEventPayload);
    this.logger.log(`🎁✅ Gift event published successfully`);

    this.logger.log(
      `Gift sent: ${result.giftSend.id} from ${senderId} to ${dto.receiverId}`,
    );

    // Invalidate user caches to refresh balances
    await this.cache.invalidateUser(senderId);
    await this.cache.invalidateUser(dto.receiverId);
    if (
      result.roomOwnerId &&
      result.roomOwnerId !== senderId &&
      result.roomOwnerId !== dto.receiverId
    ) {
      await this.cache.invalidateUser(result.roomOwnerId);
    }

    return {
      success: true,
      giftSend: result.giftSend,
      newBalance: this.toNumber(result.senderBalance),
    };
  }

  // ================================
  // GET SENT GIFTS
  // ================================

  async getSentGifts(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [gifts, total] = await Promise.all([
      this.prisma.giftSend.findMany({
        where: { senderId: userId },
        include: {
          gift: {
            select: {
              id: true,
              name: true,
              imageUrl: true,
              type: true,
            },
          },
          receiver: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.giftSend.count({ where: { senderId: userId } }),
    ]);

    return {
      data: gifts,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ================================
  // GET RECEIVED GIFTS
  // ================================

  async getReceivedGifts(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [gifts, total] = await Promise.all([
      this.prisma.giftSend.findMany({
        where: { receiverId: userId },
        include: {
          gift: {
            select: {
              id: true,
              name: true,
              imageUrl: true,
              type: true,
            },
          },
          sender: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.giftSend.count({ where: { receiverId: userId } }),
    ]);

    return {
      data: gifts,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ================================
  // GET GIFT LEADERBOARD
  // ================================

  async getLeaderboard(
    type: "senders" | "receivers" = "senders",
    limit: number = 10,
  ) {
    if (type === "senders") {
      const result = await this.prisma.giftSend.groupBy({
        by: ["senderId"],
        _sum: { totalPrice: true },
        _count: { id: true },
        orderBy: { _sum: { totalPrice: "desc" } },
        take: limit,
      });

      // Get user details
      const userIds = result.map((r: { senderId: string }) => r.senderId);
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatar: true,
        },
      });

      return result.map(
        (r: {
          senderId: string;
          _sum: { totalPrice: number | null };
          _count: { id: number };
        }) => ({
          user: users.find((u: { id: string }) => u.id === r.senderId),
          totalSpent: r._sum.totalPrice,
          giftsSent: r._count.id,
        }),
      );
    } else {
      const result = await this.prisma.giftSend.groupBy({
        by: ["receiverId"],
        _sum: { totalPrice: true },
        _count: { id: true },
        orderBy: { _sum: { totalPrice: "desc" } },
        take: limit,
      });

      const userIds = result.map((r: { receiverId: string }) => r.receiverId);
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatar: true,
        },
      });

      return result.map(
        (r: {
          receiverId: string;
          _sum: { totalPrice: number | null };
          _count: { id: number };
        }) => ({
          user: users.find((u: { id: string }) => u.id === r.receiverId),
          totalReceived: r._sum.totalPrice,
          giftsReceived: r._count.id,
        }),
      );
    }
  }
}
