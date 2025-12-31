/**
 * Cache Service - طبقة Caching ذكية للتطبيق
 * تحسين أداء الاستعلامات المتكررة
 */

import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

// Cache TTL (Time To Live) بالثواني
export const CACHE_TTL = {
  USER_PROFILE: 300,        // 5 دقائق
  USER_BASIC: 600,          // 10 دقائق
  ROOM_LIST: 60,            // 1 دقيقة
  ROOM_DETAILS: 120,        // 2 دقيقة
  ROOM_MEMBERS: 30,         // 30 ثانية
  GIFTS_LIST: 3600,         // 1 ساعة (الهدايا لا تتغير كثيراً)
  WALLET_BALANCE: 30,       // 30 ثانية
  LEADERBOARD: 300,         // 5 دقائق
  ONLINE_USERS: 10,         // 10 ثواني
};

// Cache Keys Prefixes
export const CACHE_PREFIX = {
  USER: 'cache:user:',
  USER_BASIC: 'cache:user_basic:',
  ROOM: 'cache:room:',
  ROOM_LIST: 'cache:rooms',
  ROOM_MEMBERS: 'cache:room_members:',
  GIFTS: 'cache:gifts',
  WALLET: 'cache:wallet:',
  LEADERBOARD: 'cache:leaderboard:',
  ONLINE: 'cache:online:',
};

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  
  // Statistics for monitoring
  private stats = {
    hits: 0,
    misses: 0,
    sets: 0,
  };

  constructor(private redis: RedisService) {}

  // ================================
  // Generic Cache Operations
  // ================================

  /**
   * Get from cache or fetch and cache
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds: number,
  ): Promise<T> {
    // Try to get from cache
    const cached = await this.redis.getJson<T>(key);
    
    if (cached !== null) {
      this.stats.hits++;
      return cached;
    }

    // Cache miss - fetch fresh data
    this.stats.misses++;
    const data = await fetcher();
    
    // Store in cache
    if (data !== null && data !== undefined) {
      await this.redis.setJson(key, data, ttlSeconds);
      this.stats.sets++;
    }

    return data;
  }

  /**
   * Invalidate cache key
   */
  async invalidate(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /**
   * Invalidate multiple keys by pattern
   */
  async invalidatePattern(pattern: string): Promise<void> {
    // For in-memory, we can't do pattern matching easily
    // This is a simplified version
    await this.redis.del(pattern);
  }

  // ================================
  // User Cache
  // ================================

  getUserKey(userId: string): string {
    return `${CACHE_PREFIX.USER}${userId}`;
  }

  getUserBasicKey(userId: string): string {
    return `${CACHE_PREFIX.USER_BASIC}${userId}`;
  }

  async cacheUser(userId: string, user: any, ttl = CACHE_TTL.USER_PROFILE): Promise<void> {
    await this.redis.setJson(this.getUserKey(userId), user, ttl);
  }

  async getCachedUser<T>(userId: string): Promise<T | null> {
    const cached = await this.redis.getJson<T>(this.getUserKey(userId));
    if (cached) this.stats.hits++;
    else this.stats.misses++;
    return cached;
  }

  async invalidateUser(userId: string): Promise<void> {
    await Promise.all([
      this.redis.del(this.getUserKey(userId)),
      this.redis.del(this.getUserBasicKey(userId)),
    ]);
  }

  // ================================
  // Room Cache
  // ================================

  getRoomKey(roomId: string): string {
    return `${CACHE_PREFIX.ROOM}${roomId}`;
  }

  getRoomMembersKey(roomId: string): string {
    return `${CACHE_PREFIX.ROOM_MEMBERS}${roomId}`;
  }

  async cacheRoom(roomId: string, room: any, ttl = CACHE_TTL.ROOM_DETAILS): Promise<void> {
    await this.redis.setJson(this.getRoomKey(roomId), room, ttl);
  }

  async getCachedRoom<T>(roomId: string): Promise<T | null> {
    const cached = await this.redis.getJson<T>(this.getRoomKey(roomId));
    if (cached) this.stats.hits++;
    else this.stats.misses++;
    return cached;
  }

  async cacheRoomMembers(roomId: string, members: any[], ttl = CACHE_TTL.ROOM_MEMBERS): Promise<void> {
    await this.redis.setJson(this.getRoomMembersKey(roomId), members, ttl);
  }

  async getCachedRoomMembers<T>(roomId: string): Promise<T[] | null> {
    const cached = await this.redis.getJson<T[]>(this.getRoomMembersKey(roomId));
    if (cached) this.stats.hits++;
    else this.stats.misses++;
    return cached;
  }

  async invalidateRoom(roomId: string): Promise<void> {
    await Promise.all([
      this.redis.del(this.getRoomKey(roomId)),
      this.redis.del(this.getRoomMembersKey(roomId)),
      this.redis.del(CACHE_PREFIX.ROOM_LIST),
    ]);
  }

  // ================================
  // Gifts Cache
  // ================================

  async cacheGiftsList(gifts: any[], ttl = CACHE_TTL.GIFTS_LIST): Promise<void> {
    await this.redis.setJson(CACHE_PREFIX.GIFTS, gifts, ttl);
  }

  async getCachedGiftsList<T>(): Promise<T[] | null> {
    const cached = await this.redis.getJson<T[]>(CACHE_PREFIX.GIFTS);
    if (cached) this.stats.hits++;
    else this.stats.misses++;
    return cached;
  }

  async invalidateGifts(): Promise<void> {
    await this.redis.del(CACHE_PREFIX.GIFTS);
  }

  // ================================
  // Wallet Cache
  // ================================

  getWalletKey(userId: string): string {
    return `${CACHE_PREFIX.WALLET}${userId}`;
  }

  async cacheWallet(userId: string, wallet: any, ttl = CACHE_TTL.WALLET_BALANCE): Promise<void> {
    await this.redis.setJson(this.getWalletKey(userId), wallet, ttl);
  }

  async getCachedWallet<T>(userId: string): Promise<T | null> {
    const cached = await this.redis.getJson<T>(this.getWalletKey(userId));
    if (cached) this.stats.hits++;
    else this.stats.misses++;
    return cached;
  }

  async invalidateWallet(userId: string): Promise<void> {
    await this.redis.del(this.getWalletKey(userId));
  }

  // ================================
  // Leaderboard Cache
  // ================================

  getLeaderboardKey(type: string): string {
    return `${CACHE_PREFIX.LEADERBOARD}${type}`;
  }

  async cacheLeaderboard(type: string, data: any[], ttl = CACHE_TTL.LEADERBOARD): Promise<void> {
    await this.redis.setJson(this.getLeaderboardKey(type), data, ttl);
  }

  async getCachedLeaderboard<T>(type: string): Promise<T[] | null> {
    const cached = await this.redis.getJson<T[]>(this.getLeaderboardKey(type));
    if (cached) this.stats.hits++;
    else this.stats.misses++;
    return cached;
  }

  // ================================
  // Statistics & Monitoring
  // ================================

  getStats(): { hits: number; misses: number; sets: number; hitRate: string } {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) + '%' : '0%';
    return {
      ...this.stats,
      hitRate,
    };
  }

  resetStats(): void {
    this.stats = { hits: 0, misses: 0, sets: 0 };
  }

  /**
   * Log cache statistics (call periodically)
   */
  logStats(): void {
    const stats = this.getStats();
    this.logger.log(`📊 Cache Stats: Hits=${stats.hits}, Misses=${stats.misses}, Hit Rate=${stats.hitRate}`);
  }
}
