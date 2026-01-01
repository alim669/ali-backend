import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private subscriber: Redis | null = null;
  private publisher: Redis | null = null;
  private enabled = true;
  
  // In-memory fallback for development without Redis
  private memoryCache = new Map<string, { value: string; expiresAt?: number }>();
  private memorySubscriptions = new Map<string, ((message: string) => void)[]>();

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const redisEnabled = this.configService.get<string>('REDIS_ENABLED', 'true');
    
    if (redisEnabled === 'false') {
      this.enabled = false;
      this.logger.warn('⚠️ Redis disabled, using in-memory fallback');
      return;
    }
    
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD', '');

    const options: any = {
      host,
      port,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    };

    if (password) {
      options.password = password;
    }

    try {
      this.client = new Redis(options);
      this.subscriber = new Redis(options);
      this.publisher = new Redis(options);

      await Promise.all([
        this.client.connect(),
        this.subscriber.connect(),
        this.publisher.connect(),
      ]);

      this.logger.log(`✅ Connected to Redis at ${host}:${port}`);
    } catch (error) {
      this.logger.warn(`⚠️ Redis connection failed, using in-memory fallback: ${error}`);
      this.enabled = false;
      this.client = null;
      this.subscriber = null;
      this.publisher = null;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await Promise.all([
        this.client.quit(),
        this.subscriber?.quit(),
        this.publisher?.quit(),
      ]);
      this.logger.log('Disconnected from Redis');
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  // Health check
  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  getSubscriber(): Redis | null {
    return this.subscriber;
  }

  getPublisher(): Redis | null {
    return this.publisher;
  }
  
  isEnabled(): boolean {
    return this.enabled && this.client !== null;
  }

  // ================================
  // Key-Value Operations
  // ================================

  async get(key: string): Promise<string | null> {
    if (!this.isEnabled()) {
      const entry = this.memoryCache.get(key);
      if (!entry) return null;
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        this.memoryCache.delete(key);
        return null;
      }
      return entry.value;
    }
    return this.client!.get(key);
  }

  async set(key: string, value: string, expirySeconds?: number): Promise<void> {
    if (!this.isEnabled()) {
      const expiresAt = expirySeconds ? Date.now() + expirySeconds * 1000 : undefined;
      this.memoryCache.set(key, { value, expiresAt });
      return;
    }
    if (expirySeconds) {
      await this.client!.setex(key, expirySeconds, value);
    } else {
      await this.client!.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.isEnabled()) {
      this.memoryCache.delete(key);
      return;
    }
    await this.client!.del(key);
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isEnabled()) {
      const entry = this.memoryCache.get(key);
      if (!entry) return false;
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        this.memoryCache.delete(key);
        return false;
      }
      return true;
    }
    return (await this.client!.exists(key)) === 1;
  }

  // ================================
  // JSON Operations
  // ================================

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.get(key);
    return value ? JSON.parse(value) : null;
  }

  async setJson<T>(key: string, value: T, expirySeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), expirySeconds);
  }

  // ================================
  // Hash Operations (for user presence, typing)
  // ================================
  
  // In-memory hash storage
  private memoryHashes = new Map<string, Map<string, string>>();

  async hget(key: string, field: string): Promise<string | null> {
    if (!this.isEnabled()) {
      return this.memoryHashes.get(key)?.get(field) || null;
    }
    return this.client!.hget(key, field);
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    if (!this.isEnabled()) {
      if (!this.memoryHashes.has(key)) {
        this.memoryHashes.set(key, new Map());
      }
      this.memoryHashes.get(key)!.set(field, value);
      return;
    }
    await this.client!.hset(key, field, value);
  }

  async hdel(key: string, field: string): Promise<void> {
    if (!this.isEnabled()) {
      this.memoryHashes.get(key)?.delete(field);
      return;
    }
    await this.client!.hdel(key, field);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    if (!this.isEnabled()) {
      const hash = this.memoryHashes.get(key);
      if (!hash) return {};
      return Object.fromEntries(hash);
    }
    return this.client!.hgetall(key);
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    if (!this.isEnabled()) {
      if (!this.memoryHashes.has(key)) {
        this.memoryHashes.set(key, new Map());
      }
      const hash = this.memoryHashes.get(key)!;
      const current = parseInt(hash.get(field) || '0');
      const newValue = current + increment;
      hash.set(field, newValue.toString());
      return newValue;
    }
    return this.client!.hincrby(key, field, increment);
  }

  // ================================
  // Set Operations (for room members online)
  // ================================
  
  // In-memory set storage
  private memorySets = new Map<string, Set<string>>();

  async sadd(key: string, ...members: string[]): Promise<void> {
    if (!this.isEnabled()) {
      if (!this.memorySets.has(key)) {
        this.memorySets.set(key, new Set());
      }
      const set = this.memorySets.get(key)!;
      members.forEach(m => set.add(m));
      return;
    }
    await this.client!.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<void> {
    if (!this.isEnabled()) {
      const set = this.memorySets.get(key);
      if (set) members.forEach(m => set.delete(m));
      return;
    }
    await this.client!.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    if (!this.isEnabled()) {
      return Array.from(this.memorySets.get(key) || []);
    }
    return this.client!.smembers(key);
  }

  async sismember(key: string, member: string): Promise<boolean> {
    if (!this.isEnabled()) {
      return this.memorySets.get(key)?.has(member) || false;
    }
    return (await this.client!.sismember(key, member)) === 1;
  }

  async scard(key: string): Promise<number> {
    if (!this.isEnabled()) {
      return this.memorySets.get(key)?.size || 0;
    }
    return this.client!.scard(key);
  }

  // ================================
  // Pub/Sub Operations
  // ================================

  async publish(channel: string, message: any): Promise<void> {
    const msgStr = typeof message === 'string' ? message : JSON.stringify(message);
    if (!this.isEnabled()) {
      // In-memory pub/sub
      const callbacks = this.memorySubscriptions.get(channel) || [];
      callbacks.forEach(cb => cb(msgStr));
      return;
    }
    await this.publisher!.publish(channel, msgStr);
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    if (!this.isEnabled()) {
      // In-memory subscription
      if (!this.memorySubscriptions.has(channel)) {
        this.memorySubscriptions.set(channel, []);
      }
      this.memorySubscriptions.get(channel)!.push(callback);
      this.logger.log(`Subscribed to ${channel} (in-memory)`);
      return;
    }
    await this.subscriber!.subscribe(channel);
    this.subscriber!.on('message', (ch, message) => {
      if (ch === channel) {
        callback(message);
      }
    });
  }

  async unsubscribe(channel: string): Promise<void> {
    if (!this.isEnabled()) {
      this.memorySubscriptions.delete(channel);
      return;
    }
    await this.subscriber!.unsubscribe(channel);
  }

  // ================================
  // Rate Limiting
  // ================================
  
  // In-memory rate limit counters
  private memoryRateLimits = new Map<string, { count: number; expiresAt: number }>();
  
  // In-memory sorted sets
  private memorySortedSets = new Map<string, Map<string, number>>();

  async checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    if (!this.isEnabled()) {
      const now = Date.now();
      const entry = this.memoryRateLimits.get(key);
      if (!entry || now > entry.expiresAt) {
        this.memoryRateLimits.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
        return true;
      }
      entry.count++;
      return entry.count <= limit;
    }
    const current = await this.client!.incr(key);
    if (current === 1) {
      await this.client!.expire(key, windowSeconds);
    }
    return current <= limit;
  }

  // ================================
  // Increment/Decrement Operations
  // ================================

  async incr(key: string): Promise<number> {
    if (!this.isEnabled()) {
      const entry = this.memoryCache.get(key);
      const current = entry ? parseInt(entry.value) || 0 : 0;
      const newValue = current + 1;
      this.memoryCache.set(key, { value: newValue.toString(), expiresAt: entry?.expiresAt });
      return newValue;
    }
    return this.client!.incr(key);
  }

  async expire(key: string, seconds: number): Promise<void> {
    if (!this.isEnabled()) {
      const entry = this.memoryCache.get(key);
      if (entry) {
        entry.expiresAt = Date.now() + seconds * 1000;
      }
      return;
    }
    await this.client!.expire(key, seconds);
  }

  async keys(pattern: string): Promise<string[]> {
    if (!this.isEnabled()) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return Array.from(this.memoryCache.keys()).filter(k => regex.test(k));
    }
    return this.client!.keys(pattern);
  }

  // ================================
  // Sorted Set Operations (for rate limiting)
  // ================================

  async zadd(key: string, score: number, member: string): Promise<void> {
    if (!this.isEnabled()) {
      if (!this.memorySortedSets.has(key)) {
        this.memorySortedSets.set(key, new Map());
      }
      this.memorySortedSets.get(key)!.set(member, score);
      return;
    }
    await this.client!.zadd(key, score, member);
  }

  async zcard(key: string): Promise<number> {
    if (!this.isEnabled()) {
      return this.memorySortedSets.get(key)?.size || 0;
    }
    return this.client!.zcard(key);
  }

  async zrange(key: string, start: number, stop: number, withScores?: string): Promise<string[]> {
    if (!this.isEnabled()) {
      const set = this.memorySortedSets.get(key);
      if (!set) return [];
      const entries = Array.from(set.entries())
        .sort((a, b) => a[1] - b[1])
        .slice(start, stop === -1 ? undefined : stop + 1);
      if (withScores === 'WITHSCORES') {
        return entries.flatMap(([member, score]) => [member, score.toString()]);
      }
      return entries.map(([member]) => member);
    }
    if (withScores === 'WITHSCORES') {
      return this.client!.zrange(key, start, stop, 'WITHSCORES');
    }
    return this.client!.zrange(key, start, stop);
  }

  async zremrangebyscore(key: string, min: number, max: number): Promise<void> {
    if (!this.isEnabled()) {
      const set = this.memorySortedSets.get(key);
      if (set) {
        for (const [member, score] of set.entries()) {
          if (score >= min && score <= max) {
            set.delete(member);
          }
        }
      }
      return;
    }
    await this.client!.zremrangebyscore(key, min, max);
  }

  // ================================
  // List Operations (for metrics)
  // ================================

  private memoryLists = new Map<string, string[]>();

  async lpush(key: string, value: string): Promise<void> {
    if (!this.isEnabled()) {
      if (!this.memoryLists.has(key)) {
        this.memoryLists.set(key, []);
      }
      this.memoryLists.get(key)!.unshift(value);
      return;
    }
    await this.client!.lpush(key, value);
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    if (!this.isEnabled()) {
      const list = this.memoryLists.get(key);
      if (list) {
        const newList = list.slice(start, stop === -1 ? undefined : stop + 1);
        this.memoryLists.set(key, newList);
      }
      return;
    }
    await this.client!.ltrim(key, start, stop);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (!this.isEnabled()) {
      const list = this.memoryLists.get(key) || [];
      return list.slice(start, stop === -1 ? undefined : stop + 1);
    }
    return this.client!.lrange(key, start, stop);
  }

  // ================================
  // Presence Operations
  // ================================

  async setUserOnline(userId: string, socketId: string, metadata?: object): Promise<void> {
    const key = `presence:user:${userId}`;
    const data = {
      socketId,
      lastSeen: Date.now(),
      ...metadata,
    };
    await this.setJson(key, data, 300); // 5 minutes TTL
  }

  async setUserOffline(userId: string): Promise<void> {
    await this.del(`presence:user:${userId}`);
  }

  async getUserPresence(userId: string): Promise<any> {
    return this.getJson(`presence:user:${userId}`);
  }

  async isUserOnline(userId: string): Promise<boolean> {
    return this.exists(`presence:user:${userId}`);
  }

  // ================================
  // Typing Indicators
  // ================================

  async setTyping(roomId: string, userId: string): Promise<void> {
    const key = `typing:room:${roomId}`;
    await this.hset(key, userId, Date.now().toString());
    if (this.isEnabled()) {
      await this.client!.expire(key, 10); // Auto-expire after 10 seconds
    }
  }

  async removeTyping(roomId: string, userId: string): Promise<void> {
    await this.hdel(`typing:room:${roomId}`, userId);
  }

  async getTypingUsers(roomId: string): Promise<string[]> {
    const typing = await this.hgetall(`typing:room:${roomId}`);
    const now = Date.now();
    return Object.entries(typing)
      .filter(([_, timestamp]) => now - parseInt(timestamp) < 10000)
      .map(([userId]) => userId);
  }

  // ================================
  // Room Online Members
  // ================================

  async addUserToRoom(roomId: string, userId: string): Promise<void> {
    await this.sadd(`room:${roomId}:online`, userId);
  }

  async removeUserFromRoom(roomId: string, userId: string): Promise<void> {
    await this.srem(`room:${roomId}:online`, userId);
  }

  async getRoomOnlineUsers(roomId: string): Promise<string[]> {
    return this.smembers(`room:${roomId}:online`);
  }

  async getRoomOnlineCount(roomId: string): Promise<number> {
    return this.scard(`room:${roomId}:online`);
  }
}
