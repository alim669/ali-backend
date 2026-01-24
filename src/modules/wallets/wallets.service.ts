import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { CacheService } from "../../common/cache/cache.service";
import {
  DepositDto,
  WithdrawDto,
  DeductDto,
  AdminAdjustBalanceDto,
  TransactionQueryDto,
  TransferByCustomIdDto,
} from "./dto/wallets.dto";
import { TransactionType, TransactionStatus, Prisma } from "@prisma/client";

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
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
  // GET WALLET
  // ================================

  async getWallet(userId: string) {
    let wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      // Verify user exists first
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException("المستخدم غير موجود");
      }

      // Create wallet if doesn't exist
      wallet = await this.prisma.wallet.create({
        data: {
          userId,
          balance: 0,
          diamonds: 0,
        },
      });
    }

    return {
      id: wallet.id,
      balance: this.toNumber(wallet.balance),
      diamonds: this.toNumber(wallet.diamonds),
    };
  }

  // ================================
  // DEPOSIT (Add coins)
  // ================================

  async deposit(userId: string, dto: DepositDto) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException("المحفظة غير موجودة");
    }

    const amount = this.toBigInt(dto.amount);
    const prismaAmount = this.toPrismaBigInt(amount);
    const result = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const updatedWallet = await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: { increment: prismaAmount },
            version: { increment: 1 },
          },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: TransactionType.DEPOSIT,
            status: TransactionStatus.COMPLETED,
            amount: prismaAmount,
            balanceBefore: wallet.balance,
            balanceAfter: updatedWallet.balance,
            description: "إيداع رصيد",
            metadata: {
              paymentMethod: dto.paymentMethod,
              transactionId: dto.transactionId,
            },
          },
        });

        return updatedWallet;
      },
    );

    this.logger.log(`Deposit: ${dto.amount} coins to user ${userId}`);

    // Invalidate user cache to refresh balance
    await this.cache.invalidateUser(userId);

    return {
      success: true,
      newBalance: this.toNumber(result.balance),
    };
  }

  // ================================
  // WITHDRAW (Request withdrawal)
  // ================================

  async withdraw(userId: string, dto: WithdrawDto) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException("المحفظة غير موجودة");
    }

    const amount = this.toBigInt(dto.amount);
    const prismaAmount = this.toPrismaBigInt(amount);
    if (wallet.balance < amount) {
      throw new BadRequestException("رصيد غير كافي");
    }

    // Minimum withdrawal
    if (dto.amount < 100) {
      throw new BadRequestException("الحد الأدنى للسحب 100 عملة");
    }

    const result = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const updatedWallet = await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: { decrement: prismaAmount },
            version: { increment: 1 },
          },
        });

        const transaction = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: TransactionType.WITHDRAWAL,
            status: TransactionStatus.PENDING, // Needs admin approval
            amount: this.toPrismaBigInt(-amount),
            balanceBefore: wallet.balance,
            balanceAfter: updatedWallet.balance,
            description: "طلب سحب",
            metadata: {
              withdrawMethod: dto.withdrawMethod,
              accountInfo: dto.accountInfo,
            },
          },
        });

        return { wallet: updatedWallet, transaction };
      },
    );

    this.logger.log(
      `Withdrawal request: ${dto.amount} coins from user ${userId}`,
    );

    // Invalidate user cache to refresh balance
    await this.cache.invalidateUser(userId);

    return {
      success: true,
      newBalance: this.toNumber(result.wallet.balance),
      transactionId: result.transaction.id,
      status: "pending",
      message: "تم إرسال طلب السحب وسيتم مراجعته",
    };
  }

  // ================================
  // DEDUCT (For purchases)
  // ================================

  async deduct(userId: string, dto: DeductDto) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException("المحفظة غير موجودة");
    }

    // Check balance based on type
    const balanceToCheck =
      dto.type === "diamonds" ? wallet.diamonds : wallet.balance;

    const amount = this.toBigInt(dto.amount);
    const prismaAmount = this.toPrismaBigInt(amount);
    if (balanceToCheck < amount) {
      throw new BadRequestException("رصيد غير كافي");
    }

    const result = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Update balance based on type
        const updateData =
          dto.type === "diamonds"
            ? { diamonds: { decrement: prismaAmount }, version: { increment: 1 } }
            : { balance: { decrement: prismaAmount }, version: { increment: 1 } };

        const updatedWallet = await tx.wallet.update({
          where: { id: wallet.id },
          data: updateData,
        });

        const balanceBefore =
          dto.type === "diamonds" ? wallet.diamonds : wallet.balance;
        const balanceAfter =
          dto.type === "diamonds"
            ? updatedWallet.diamonds
            : updatedWallet.balance;

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: TransactionType.PURCHASE,
            status: TransactionStatus.COMPLETED,
            amount: this.toPrismaBigInt(-amount),
            balanceBefore,
            balanceAfter,
            description: dto.reason || "عملية شراء",
            metadata: {
              type: dto.type || "coins",
            },
          },
        });

        return updatedWallet;
      },
    );

    this.logger.log(
      `Deduct: ${dto.amount} ${dto.type || "coins"} from user ${userId}`,
    );

    // Invalidate user cache to refresh balance
    await this.cache.invalidateUser(userId);

    return {
      success: true,
      newBalance:
        dto.type === "diamonds"
          ? this.toNumber(result.diamonds)
          : this.toNumber(result.balance),
    };
  }

  // ================================
  // GET TRANSACTIONS
  // ================================

  async getTransactions(userId: string, query: TransactionQueryDto) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException("المحفظة غير موجودة");
    }

    const { page = 1, limit = 20, type, startDate, endDate } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      walletId: wallet.id,
    };

    if (type) {
      where.type = type;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [transactions, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.walletTransaction.count({ where }),
    ]);

    const mappedTransactions = transactions.map((tx) => ({
      ...tx,
      amount: this.toNumber(tx.amount),
      balanceBefore: this.toNumber(tx.balanceBefore),
      balanceAfter: this.toNumber(tx.balanceAfter),
    }));

    return {
      data: mappedTransactions,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ================================
  // ADMIN: ADJUST BALANCE
  // ================================

  async adminAdjustBalance(
    targetUserId: string,
    dto: AdminAdjustBalanceDto,
    adminId: string,
  ) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: targetUserId },
    });

    if (!wallet) {
      throw new NotFoundException("المحفظة غير موجودة");
    }

    const amount = this.toBigInt(dto.amount);
    const prismaAmount = this.toPrismaBigInt(amount);
    if (dto.amount < 0 && wallet.balance < BigInt(Math.abs(dto.amount))) {
      throw new BadRequestException("لا يمكن خصم أكثر من الرصيد المتاح");
    }

    const result = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const updatedWallet = await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: { increment: prismaAmount },
            version: { increment: 1 },
          },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: TransactionType.ADMIN_ADJUSTMENT,
            status: TransactionStatus.COMPLETED,
            amount: prismaAmount,
            balanceBefore: wallet.balance,
            balanceAfter: updatedWallet.balance,
            description: dto.reason,
            metadata: { adminId },
          },
        });

        // Log admin action
        await tx.adminAction.create({
          data: {
            actorId: adminId,
            targetId: targetUserId,
            action: "WALLET_ADJUSTED",
            details: {
              amount: this.toNumber(amount),
              reason: dto.reason,
              balanceBefore: this.toNumber(wallet.balance),
              balanceAfter: this.toNumber(updatedWallet.balance),
            },
          },
        });

        return updatedWallet;
      },
    );

    this.logger.log(
      `Admin ${adminId} adjusted balance for ${targetUserId}: ${dto.amount}`,
    );

    // Invalidate user cache to refresh balance
    await this.cache.invalidateUser(targetUserId);

    return {
      success: true,
      newBalance: this.toNumber(result.balance),
    };
  }

  // ================================
  // TRANSFER BY CUSTOM ID (numericId)
  // ================================

  async transferByCustomId(senderId: string, dto: TransferByCustomIdDto) {
    // Find recipient by numericId (convert string to BigInt)
    const numericId = BigInt(dto.recipientCustomId);
    const recipient = await this.prisma.user.findFirst({
      where: { numericId },
    });

    if (!recipient) {
      throw new NotFoundException("المستلم غير موجود - تحقق من الـ ID");
    }

    if (recipient.id === senderId) {
      throw new BadRequestException("لا يمكنك التحويل لنفسك");
    }

    // Get sender wallet
    const senderWallet = await this.prisma.wallet.findUnique({
      where: { userId: senderId },
    });

    if (!senderWallet) {
      throw new NotFoundException("محفظتك غير موجودة");
    }

    const amount = this.toBigInt(dto.amount);
    const prismaAmount = this.toPrismaBigInt(amount);
    if (senderWallet.balance < amount) {
      throw new BadRequestException("رصيد غير كافي");
    }

    // Minimum transfer
    if (dto.amount < 10) {
      throw new BadRequestException("الحد الأدنى للتحويل 10 عملات");
    }

    // Get or create recipient wallet
    let recipientWallet = await this.prisma.wallet.findUnique({
      where: { userId: recipient.id },
    });

    if (!recipientWallet) {
      recipientWallet = await this.prisma.wallet.create({
        data: {
          userId: recipient.id,
          balance: 0,
          diamonds: 0,
        },
      });
    }

    const result = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Deduct from sender
        const updatedSenderWallet = await tx.wallet.update({
          where: { id: senderWallet.id },
          data: {
            balance: { decrement: prismaAmount },
            version: { increment: 1 },
          },
        });

        // Add to recipient
        const updatedRecipientWallet = await tx.wallet.update({
          where: { id: recipientWallet.id },
          data: {
            balance: { increment: prismaAmount },
            version: { increment: 1 },
          },
        });

        // Record sender transaction
        await tx.walletTransaction.create({
          data: {
            walletId: senderWallet.id,
            type: 'TRANSFER',
            status: TransactionStatus.COMPLETED,
            amount: this.toPrismaBigInt(-amount),
            balanceBefore: senderWallet.balance,
            balanceAfter: updatedSenderWallet.balance,
            description: `تحويل إلى ${recipient.displayName || recipient.username}`,
            metadata: {
              recipientId: recipient.id,
              recipientNumericId: dto.recipientCustomId,
              note: dto.note,
            },
          } as any,
        });

        // Record recipient transaction
        await tx.walletTransaction.create({
          data: {
            walletId: recipientWallet.id,
            type: 'TRANSFER',
            status: TransactionStatus.COMPLETED,
            amount: prismaAmount,
            balanceBefore: recipientWallet.balance,
            balanceAfter: updatedRecipientWallet.balance,
            description: "استلام تحويل",
            metadata: {
              senderId: senderId,
              note: dto.note,
            },
          } as any,
        });

        return { senderWallet: updatedSenderWallet, recipientWallet: updatedRecipientWallet };
      },
    );

    this.logger.log(
      `Transfer: ${dto.amount} coins from ${senderId} to ${recipient.id} (numericId: ${dto.recipientCustomId})`,
    );

    // Invalidate caches for both users
    await this.cache.invalidateUser(senderId);
    await this.cache.invalidateUser(recipient.id);

    return {
      success: true,
      newBalance: this.toNumber(result.senderWallet.balance),
      recipient: {
        id: recipient.id,
        numericId: recipient.numericId?.toString(),
        name: recipient.displayName || recipient.username,
        avatar: recipient.avatar,
      },
      amount: dto.amount,
      message: `تم تحويل ${dto.amount} عملة بنجاح`,
    };
  }

  // ================================
  // GET WALLET STATS
  // ================================

  async getStats(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException("المحفظة غير موجودة");
    }

    const [
      totalDeposits,
      totalWithdrawals,
      totalGiftsSent,
      totalGiftsReceived,
    ] = await Promise.all([
      this.prisma.walletTransaction.aggregate({
        where: { walletId: wallet.id, type: TransactionType.DEPOSIT },
        _sum: { amount: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: { walletId: wallet.id, type: TransactionType.WITHDRAWAL },
        _sum: { amount: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: { walletId: wallet.id, type: TransactionType.GIFT_SENT },
        _sum: { amount: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: { walletId: wallet.id, type: TransactionType.GIFT_RECEIVED },
        _sum: { amount: true },
      }),
    ]);

    return {
      balance: this.toNumber(wallet.balance),
      diamonds: this.toNumber(wallet.diamonds),
      totalDeposits: this.toNumber(totalDeposits._sum.amount),
      totalWithdrawals: Math.abs(this.toNumber(totalWithdrawals._sum.amount)),
      totalGiftsSent: Math.abs(this.toNumber(totalGiftsSent._sum.amount)),
      totalGiftsReceived: this.toNumber(totalGiftsReceived._sum.amount),
    };
  }
}
