import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  DepositDto,
  WithdrawDto,
  DeductDto,
  AdminAdjustBalanceDto,
  TransactionQueryDto,
} from './dto/wallets.dto';
import { TransactionType, TransactionStatus, Prisma } from '@prisma/client';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(private prisma: PrismaService) {}

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
        throw new NotFoundException('المستخدم غير موجود');
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
      balance: wallet.balance,
      diamonds: wallet.diamonds,
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
      throw new NotFoundException('المحفظة غير موجودة');
    }

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { increment: dto.amount },
          version: { increment: 1 },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: TransactionType.DEPOSIT,
          status: TransactionStatus.COMPLETED,
          amount: dto.amount,
          balanceBefore: wallet.balance,
          balanceAfter: updatedWallet.balance,
          description: 'إيداع رصيد',
          metadata: {
            paymentMethod: dto.paymentMethod,
            transactionId: dto.transactionId,
          },
        },
      });

      return updatedWallet;
    });

    this.logger.log(`Deposit: ${dto.amount} coins to user ${userId}`);

    return {
      success: true,
      newBalance: result.balance,
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
      throw new NotFoundException('المحفظة غير موجودة');
    }

    if (wallet.balance < dto.amount) {
      throw new BadRequestException('رصيد غير كافي');
    }

    // Minimum withdrawal
    if (dto.amount < 100) {
      throw new BadRequestException('الحد الأدنى للسحب 100 عملة');
    }

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { decrement: dto.amount },
          version: { increment: 1 },
        },
      });

      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: TransactionType.WITHDRAWAL,
          status: TransactionStatus.PENDING, // Needs admin approval
          amount: -dto.amount,
          balanceBefore: wallet.balance,
          balanceAfter: updatedWallet.balance,
          description: 'طلب سحب',
          metadata: {
            withdrawMethod: dto.withdrawMethod,
            accountInfo: dto.accountInfo,
          },
        },
      });

      return { wallet: updatedWallet, transaction };
    });

    this.logger.log(`Withdrawal request: ${dto.amount} coins from user ${userId}`);

    return {
      success: true,
      newBalance: result.wallet.balance,
      transactionId: result.transaction.id,
      status: 'pending',
      message: 'تم إرسال طلب السحب وسيتم مراجعته',
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
      throw new NotFoundException('المحفظة غير موجودة');
    }

    // Check balance based on type
    const balanceToCheck = dto.type === 'diamonds' ? wallet.diamonds : wallet.balance;
    
    if (balanceToCheck < dto.amount) {
      throw new BadRequestException('رصيد غير كافي');
    }

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Update balance based on type
      const updateData = dto.type === 'diamonds'
        ? { diamonds: { decrement: dto.amount }, version: { increment: 1 } }
        : { balance: { decrement: dto.amount }, version: { increment: 1 } };

      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: updateData,
      });

      const balanceBefore = dto.type === 'diamonds' ? wallet.diamonds : wallet.balance;
      const balanceAfter = dto.type === 'diamonds' ? updatedWallet.diamonds : updatedWallet.balance;

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: TransactionType.PURCHASE,
          status: TransactionStatus.COMPLETED,
          amount: -dto.amount,
          balanceBefore,
          balanceAfter,
          description: dto.reason || 'عملية شراء',
          metadata: {
            type: dto.type || 'coins',
          },
        },
      });

      return updatedWallet;
    });

    this.logger.log(`Deduct: ${dto.amount} ${dto.type || 'coins'} from user ${userId}`);

    return {
      success: true,
      newBalance: dto.type === 'diamonds' ? result.diamonds : result.balance,
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
      throw new NotFoundException('المحفظة غير موجودة');
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
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.walletTransaction.count({ where }),
    ]);

    return {
      data: transactions,
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

  async adminAdjustBalance(targetUserId: string, dto: AdminAdjustBalanceDto, adminId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: targetUserId },
    });

    if (!wallet) {
      throw new NotFoundException('المحفظة غير موجودة');
    }

    if (dto.amount < 0 && wallet.balance < Math.abs(dto.amount)) {
      throw new BadRequestException('لا يمكن خصم أكثر من الرصيد المتاح');
    }

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { increment: dto.amount },
          version: { increment: 1 },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: TransactionType.ADMIN_ADJUSTMENT,
          status: TransactionStatus.COMPLETED,
          amount: dto.amount,
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
          action: 'WALLET_ADJUSTED',
          details: {
            amount: dto.amount,
            reason: dto.reason,
            balanceBefore: wallet.balance,
            balanceAfter: updatedWallet.balance,
          },
        },
      });

      return updatedWallet;
    });

    this.logger.log(`Admin ${adminId} adjusted balance for ${targetUserId}: ${dto.amount}`);

    return {
      success: true,
      newBalance: result.balance,
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
      throw new NotFoundException('المحفظة غير موجودة');
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
      balance: wallet.balance,
      diamonds: wallet.diamonds,
      totalDeposits: totalDeposits._sum.amount || 0,
      totalWithdrawals: Math.abs(totalWithdrawals._sum.amount || 0),
      totalGiftsSent: Math.abs(totalGiftsSent._sum.amount || 0),
      totalGiftsReceived: totalGiftsReceived._sum.amount || 0,
    };
  }
}
