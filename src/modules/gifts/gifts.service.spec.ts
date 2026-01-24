/**
 * Gifts Service Unit Tests
 * اختبارات وحدة خدمة الهدايا
 */

import { Test, TestingModule } from '@nestjs/testing';
import { GiftsService } from './gifts.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { CacheService } from '../../common/cache/cache.service';
import { MessagesService } from '../messages/messages.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('GiftsService', () => {
  let service: GiftsService;

  const mockPrismaService: any = {
    gift: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    giftSend: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    wallet: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    walletTransaction: {
      create: jest.fn(),
    },
    $transaction: jest.fn((callback: any) => callback(mockPrismaService)),
  };

  const mockRedisService = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    publish: jest.fn(),
    isEnabled: jest.fn().mockReturnValue(true),
    exists: jest.fn().mockResolvedValue(0),
    setex: jest.fn(),
  };

  const mockCacheService = {
    getCachedGiftsList: jest.fn(),
    cacheGiftsList: jest.fn(),
    invalidate: jest.fn(),
  };

  const mockMessagesService = {
    create: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GiftsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: MessagesService, useValue: mockMessagesService },
      ],
    }).compile();

    service = module.get<GiftsService>(GiftsService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return cached gifts if available', async () => {
      const cachedGifts = [
        { id: 'gift-1', name: 'Rose', price: 10 },
        { id: 'gift-2', name: 'Heart', price: 50 },
      ];

      mockCacheService.getCachedGiftsList.mockResolvedValue(cachedGifts);

      const result = await service.findAll({ page: 1 });

      expect(result.data).toEqual(cachedGifts);
      expect(mockPrismaService.gift.findMany).not.toHaveBeenCalled();
    });

    it('should fetch from database if cache miss', async () => {
      const dbGifts = [
        { id: 'gift-1', name: 'Rose', price: 10 },
      ];

      mockCacheService.getCachedGiftsList.mockResolvedValue(null);
      mockPrismaService.gift.findMany.mockResolvedValue(dbGifts);
      mockPrismaService.gift.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1 });

      expect(result.data).toEqual(dbGifts);
      expect(mockCacheService.cacheGiftsList).toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return gift by id', async () => {
      const mockGift = { id: 'gift-1', name: 'Rose', price: 10 };
      mockPrismaService.gift.findUnique.mockResolvedValue(mockGift);

      const result = await service.findById('gift-1');

      expect(result).toEqual(mockGift);
    });

    it('should throw NotFoundException if gift not found', async () => {
      mockPrismaService.gift.findUnique.mockResolvedValue(null);

      await expect(service.findById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('sendGift', () => {
    it('should throw BadRequestException if sender is receiver', async () => {
      // Mock the idempotency check
      mockPrismaService.giftSend.findUnique.mockResolvedValue(null);
      mockRedisService.exists.mockResolvedValue(0);
      
      // Mock gift exists
      mockPrismaService.gift.findUnique.mockResolvedValue({
        id: 'gift-1',
        name: 'Rose',
        price: 10,
        isActive: true,
      });
      
      // Mock receiver exists (same as sender)
      mockPrismaService.user = { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }) };

      await expect(
        service.sendGift('user-1', {
          giftId: 'gift-1',
          receiverId: 'user-1',
          quantity: 1,
        }, 'key-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
