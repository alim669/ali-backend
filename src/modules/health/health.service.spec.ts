/**
 * Health Service Unit Tests
 * اختبارات وحدة خدمة الصحة
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthService } from './health.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

describe('HealthService', () => {
  let service: HealthService;

  // Mock $queryRaw as a function that can handle tagged template literals
  const mockQueryRaw = jest.fn();
  
  const mockPrismaService = {
    $queryRaw: mockQueryRaw,
  };

  const mockRedisService = {
    isEnabled: jest.fn(),
    getClient: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => defaultValue),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getHealth', () => {
    it('should return healthy status when all services are up', async () => {
      // Spy on the private methods to control their behavior
      jest.spyOn(service as any, 'checkDatabase').mockResolvedValue({
        status: 'up',
        latency: 5,
        details: {},
      });
      
      jest.spyOn(service as any, 'checkRedis').mockResolvedValue({
        status: 'up',
        latency: 2,
        details: { usedMemory: '50M' },
      });
      
      jest.spyOn(service as any, 'checkMemory').mockReturnValue({
        status: 'up',
        heapUsed: 100,
        heapTotal: 200,
        rss: 150,
        external: 10,
        percentUsed: 50,
      });

      const result = await service.getHealth();

      expect(result.status).toBe('healthy');
      expect(result.services.database.status).toBe('up');
      expect(result.services.redis.status).toBe('up');
    });

    it('should return degraded status when Redis is down', async () => {
      jest.spyOn(service as any, 'checkDatabase').mockResolvedValue({
        status: 'up',
        latency: 5,
        details: {},
      });
      
      jest.spyOn(service as any, 'checkRedis').mockResolvedValue({
        status: 'down',
        message: 'Connection refused',
      });
      
      jest.spyOn(service as any, 'checkMemory').mockReturnValue({
        status: 'up',
        heapUsed: 100,
        heapTotal: 200,
        rss: 150,
        external: 10,
        percentUsed: 50,
      });

      const result = await service.getHealth();

      expect(result.status).toBe('degraded');
      expect(result.services.database.status).toBe('up');
      expect(result.services.redis.status).toBe('down');
    });

    it('should return unhealthy status when database is down', async () => {
      jest.spyOn(service as any, 'checkDatabase').mockResolvedValue({
        status: 'down',
        message: 'Connection refused',
      });
      
      jest.spyOn(service as any, 'checkRedis').mockResolvedValue({
        status: 'degraded',
        message: 'Using in-memory fallback',
      });
      
      jest.spyOn(service as any, 'checkMemory').mockReturnValue({
        status: 'up',
        heapUsed: 100,
        heapTotal: 200,
        rss: 150,
        external: 10,
        percentUsed: 50,
      });

      const result = await service.getHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.services.database.status).toBe('down');
    });
  });

  describe('ping', () => {
    it('should return pong with timestamp', async () => {
      const result = await service.ping();

      expect(result.pong).toBe(true);
      expect(result.time).toBeDefined();
    });
  });

  describe('getLiveness', () => {
    it('should return ok status', async () => {
      const result = await service.getLiveness();

      expect(result.status).toBe('ok');
    });
  });

  describe('getReadiness', () => {
    it('should return ok when all checks pass', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      mockRedisService.isEnabled.mockReturnValue(false);

      const result = await service.getReadiness();

      expect(result.status).toBe('ok');
      expect(result.checks.database).toBe(true);
    });

    it('should return error when database check fails', async () => {
      mockPrismaService.$queryRaw.mockRejectedValue(new Error('Connection refused'));
      mockRedisService.isEnabled.mockReturnValue(false);

      const result = await service.getReadiness();

      expect(result.status).toBe('error');
      expect(result.checks.database).toBe(false);
    });
  });

  describe('checkMemory', () => {
    it('should return memory usage stats', () => {
      const result = service.checkMemory();

      expect(result.status).toBeDefined();
      expect(result.heapUsed).toBeDefined();
      expect(result.heapTotal).toBeDefined();
      expect(result.percentUsed).toBeDefined();
    });
  });
});
