/**
 * Wallets Service Unit Tests
 * اختبارات وحدة خدمة المحافظ
 */

import { Test, TestingModule } from '@nestjs/testing';
import { WalletsService } from './wallets.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('WalletsService', () => {
  let service: WalletsService;
  let prismaService: PrismaService;

  const mockPrismaService: any = {
    wallet: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    walletTransaction: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((callback: any) => callback(mockPrismaService)),
  };

  const mockCacheService: any = {
    getOrSet: jest.fn(),
    invalidate: jest.fn(),
    getCachedWallet: jest.fn(),
    cacheWallet: jest.fn(),
    invalidateUser: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    service = module.get<WalletsService>(WalletsService);
    prismaService = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getWallet', () => {
    it('should return existing wallet', async () => {
      const mockWallet = {
        id: 'wallet-id',
        userId: 'user-id',
        balance: 1000,
        diamonds: 50,
      };

      mockPrismaService.wallet.findUnique.mockResolvedValue(mockWallet);

      const result = await service.getWallet('user-id');

      expect(result).toEqual({
        id: 'wallet-id',
        balance: 1000,
        diamonds: 50,
      });
    });

    it('should create wallet if not exists', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-id' });
      mockPrismaService.wallet.create.mockResolvedValue({
        id: 'new-wallet-id',
        userId: 'user-id',
        balance: 0,
        diamonds: 0,
      });

      const result = await service.getWallet('user-id');

      expect(result.balance).toBe(0);
      expect(mockPrismaService.wallet.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getWallet('non-existent-user')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deposit', () => {
    it('should add balance to wallet', async () => {
      const mockWallet = {
        id: 'wallet-id',
        userId: 'user-id',
        balance: 1000,
        version: 1,
      };

      mockPrismaService.wallet.findUnique.mockResolvedValue(mockWallet);
      mockPrismaService.wallet.update.mockResolvedValue({
        ...mockWallet,
        balance: 1500,
        version: 2,
      });

      const result = await service.deposit('user-id', {
        amount: 500,
        paymentMethod: 'TEST',
      });

      expect(result.newBalance).toBe(1500);
    });

    it('should throw NotFoundException if wallet not found', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(null);

      await expect(
        service.deposit('user-id', { amount: 500, paymentMethod: 'TEST' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
