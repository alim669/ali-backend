/**
 * Auth Service Unit Tests
 * اختبارات وحدة خدمة المصادقة
 */

import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { ConflictException, UnauthorizedException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: PrismaService;
  let redisService: RedisService;
  let jwtService: JwtService;

  const mockPrismaService: any = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    wallet: {
      create: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((callback: any) => callback(mockPrismaService)),
    ensureConnection: jest.fn(),
  };

  const mockRedisService = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    isEnabled: jest.fn().mockReturnValue(true),
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock-access-token'),
    signAsync: jest.fn().mockResolvedValue('mock-access-token'),
    verify: jest.fn(),
    verifyAsync: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      const config: Record<string, any> = {
        JWT_SECRET: 'test-secret-key-for-testing-purposes',
        JWT_EXPIRES_IN: '15m',
        JWT_REFRESH_SECRET: 'test-refresh-secret-key',
        JWT_REFRESH_EXPIRES_IN: '7d',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
      };
      return config[key] || defaultValue;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get<PrismaService>(PrismaService);
    redisService = module.get<RedisService>(RedisService);
    jwtService = module.get<JwtService>(JwtService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    const registerDto = {
      email: 'test@example.com',
      password: 'Password123!',
      username: 'testuser',
      displayName: 'Test User',
    };

    it('should throw ConflictException if email already exists', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce({ id: 'existing-user' });

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if username already exists', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce(null) // email check
        .mockResolvedValueOnce({ id: 'existing-user' }); // username check

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
    });

    it('should create user successfully', async () => {
      const mockUser = {
        id: 'new-user-id',
        numericId: BigInt(1),
        email: registerDto.email,
        username: registerDto.username,
        displayName: registerDto.displayName,
        avatar: null,
        role: 'USER',
        emailVerified: false,
      };

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue(mockUser);
      mockPrismaService.wallet.create.mockResolvedValue({ id: 'wallet-id' });
      mockJwtService.signAsync.mockResolvedValue('mock-token');

      const result = await service.register(registerDto);

      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('tokens');
      expect(result.user.email).toBe(registerDto.email);
    });
  });

  describe('validateUser', () => {
    it('should return null if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      const result = await service.validateUser('non-existent-id');

      expect(result).toBeNull();
    });

    it('should return null if user is banned', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-id',
        status: 'BANNED',
      });

      const result = await service.validateUser('user-id');

      expect(result).toBeNull();
    });

    it('should return user data if valid', async () => {
      const mockUser = {
        id: 'user-id',
        numericId: BigInt(1),
        email: 'test@example.com',
        username: 'testuser',
        displayName: 'Test User',
        role: 'USER',
        status: 'ACTIVE',
        isVIP: false,
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.validateUser('user-id');

      expect(result).toBeDefined();
      expect(result.id).toBe('user-id');
    });
  });
});
