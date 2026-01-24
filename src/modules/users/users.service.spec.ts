/**
 * Users Service Unit Tests
 * اختبارات وحدة خدمة المستخدمين
 */

import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { CacheService } from '../../common/cache/cache.service';
import { AppGateway } from '../websocket/app.gateway';
import { NotFoundException } from '@nestjs/common';

describe('UsersService', () => {
  let service: UsersService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    follow: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockRedisService = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    isEnabled: jest.fn().mockReturnValue(false),
    isUserOnline: jest.fn().mockResolvedValue(false),
    publish: jest.fn(),
  };

  const mockCacheService = {
    getOrSet: jest.fn(),
    invalidate: jest.fn(),
    getCachedUserProfile: jest.fn(),
    cacheUserProfile: jest.fn(),
    invalidateUser: jest.fn().mockResolvedValue(undefined),
  };

  const mockGateway = {
    notifyUserUpdated: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: AppGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findById', () => {
    it('should return user by id', async () => {
      const mockUser = {
        id: 'user-1',
        numericId: BigInt(1),
        email: 'test@example.com',
        username: 'testuser',
        displayName: 'Test User',
        avatar: null,
        bio: null,
        role: 'USER',
        status: 'ACTIVE',
        isVIP: false,
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findById('user-1');

      expect(result).toBeDefined();
      expect(result.id).toBe('user-1');
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.findById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByUsername', () => {
    it('should return user by username', async () => {
      const mockUser = {
        id: 'user-1',
        username: 'testuser',
        displayName: 'Test User',
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findByUsername('testuser');

      expect(result.username).toBe('testuser');
    });
  });

  describe('updateProfile', () => {
    it('should update user profile', async () => {
      const mockUser = {
        id: 'user-1',
        displayName: 'Old Name',
        bio: 'Old bio',
      };

      const updatedUser = {
        ...mockUser,
        displayName: 'New Name',
        bio: 'New bio',
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.user.update.mockResolvedValue(updatedUser);

      const result = await service.updateProfile('user-1', {
        displayName: 'New Name',
        bio: 'New bio',
      });

      expect(result.displayName).toBe('New Name');
      expect(mockCacheService.invalidateUser).toHaveBeenCalledWith('user-1');
    });
  });

  describe('findAll', () => {
    it('should return paginated users', async () => {
      const mockUsers = [
        { id: 'user-1', username: 'john', displayName: 'John Doe' },
        { id: 'user-2', username: 'johnny', displayName: 'Johnny' },
      ];

      mockPrismaService.user.findMany.mockResolvedValue(mockUsers);
      mockPrismaService.user.count.mockResolvedValue(2);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data.length).toBe(2);
      expect(result.meta.total).toBe(2);
    });
  });
});
