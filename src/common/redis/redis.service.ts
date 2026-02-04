import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private subscriber: Redis | null = null;
  private publisher: Redis | null = null;
  private enabled = true;

  // In-memory fallback for development without Redis
  private memoryCache = new Map<
    string,
    { value: string; expiresAt?: number }
  >();
  private memorySubscriptions = new Map<
    string,
    ((message: string) => void)[]
  >();
  
  // Track Redis channel callbacks
  private channelCallbacks = new Map<string, ((message: string) => void)[]>();
  private messageHandlerRegistered = false;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const redisEnabled = this.configService.get<string>(
      "REDIS_ENABLED",
      "true",
    );

    if (redisEnabled === "false") {
      this.enabled = false;
      this.logger.warn("⚠️ Redis disabled, using in-memory fallback");
      return;
    }

    const host = this.configService.get<string>("REDIS_HOST", "localhost");
    const port = this.configService.get<number>("REDIS_PORT", 6379);
    const password = this.configService.get<string>("REDIS_PASSWORD", "");

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
      this.logger.warn(
        `⚠️ Redis connection failed, using in-memory fallback: ${error}`,
      );
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
      this.logger.log("Disconnected from Redis");
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
      return result === "PONG";
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
      const expiresAt = expirySeconds
        ? Date.now() + expirySeconds * 1000
        : undefined;
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

  async setJson<T>(
    key: string,
    value: T,
    expirySeconds?: number,
  ): Promise<void> {
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

  async hincrby(
    key: string,
    field: string,
    increment: number,
  ): Promise<number> {
    if (!this.isEnabled()) {
      if (!this.memoryHashes.has(key)) {
        this.memoryHashes.set(key, new Map());
      }
      const hash = this.memoryHashes.get(key)!;
      const current = parseInt(hash.get(field) || "0");
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
      members.forEach((m) => set.add(m));
      return;
    }
    await this.client!.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<void> {
    if (!this.isEnabled()) {
      const set = this.memorySets.get(key);
      if (set) members.forEach((m) => set.delete(m));
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
    const msgStr =
      typeof message === "string" ? message : JSON.stringify(message);
    if (!this.isEnabled()) {
      // In-memory pub/sub
      const callbacks = this.memorySubscriptions.get(channel) || [];
      callbacks.forEach((cb) => cb(msgStr));
      return;
    }
    await this.publisher!.publish(channel, msgStr);
  }

  async subscribe(
    channel: string,
    callback: (message: string) => void,
  ): Promise<void> {
    if (!this.isEnabled()) {
      // In-memory subscription
      if (!this.memorySubscriptions.has(channel)) {
        this.memorySubscriptions.set(channel, []);
      }
      this.memorySubscriptions.get(channel)!.push(callback);
      this.logger.log(`Subscribed to ${channel} (in-memory)`);
      return;
    }
    
    // Register the unified message handler once
    if (!this.messageHandlerRegistered) {
      this.subscriber!.on("message", (ch, message) => {
        const callbacks = this.channelCallbacks.get(ch);
        if (callbacks) {
          callbacks.forEach(cb => {
            try {
              cb(message);
            } catch (e) {
              this.logger.error(`Error in channel callback for ${ch}: ${e}`);
            }
          });
        }
      });
      this.messageHandlerRegistered = true;
      this.logger.log('📡 Registered unified Redis message handler');
    }
    
    // Track callback for this channel
    if (!this.channelCallbacks.has(channel)) {
      this.channelCallbacks.set(channel, []);
    }
    this.channelCallbacks.get(channel)!.push(callback);
    
    // Subscribe to Redis channel
    await this.subscriber!.subscribe(channel);
    this.logger.log(`📡 Subscribed to Redis channel: ${channel}`);
  }

  async unsubscribe(channel: string): Promise<void> {
    if (!this.isEnabled()) {
      this.memorySubscriptions.delete(channel);
      return;
    }
    this.channelCallbacks.delete(channel);
    await this.subscriber!.unsubscribe(channel);
    this.logger.log(`📡 Unsubscribed from Redis channel: ${channel}`);
  }

  // ================================
  // Rate Limiting
  // ================================

  // In-memory rate limit counters
  private memoryRateLimits = new Map<
    string,
    { count: number; expiresAt: number }
  >();

  // In-memory sorted sets
  private memorySortedSets = new Map<string, Map<string, number>>();

  async checkRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    if (!this.isEnabled()) {
      const now = Date.now();
      const entry = this.memoryRateLimits.get(key);
      if (!entry || now > entry.expiresAt) {
        this.memoryRateLimits.set(key, {
          count: 1,
          expiresAt: now + windowSeconds * 1000,
        });
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
      this.memoryCache.set(key, {
        value: newValue.toString(),
        expiresAt: entry?.expiresAt,
      });
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
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return Array.from(this.memoryCache.keys()).filter((k) => regex.test(k));
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

  async zrange(
    key: string,
    start: number,
    stop: number,
    withScores?: string,
  ): Promise<string[]> {
    if (!this.isEnabled()) {
      const set = this.memorySortedSets.get(key);
      if (!set) return [];
      const entries = Array.from(set.entries())
        .sort((a, b) => a[1] - b[1])
        .slice(start, stop === -1 ? undefined : stop + 1);
      if (withScores === "WITHSCORES") {
        return entries.flatMap(([member, score]) => [member, score.toString()]);
      }
      return entries.map(([member]) => member);
    }
    if (withScores === "WITHSCORES") {
      return this.client!.zrange(key, start, stop, "WITHSCORES");
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

  async lrem(key: string, count: number, value: string): Promise<number> {
    if (!this.isEnabled()) {
      const list = this.memoryLists.get(key) || [];
      if (list.length === 0) return 0;

      let removed = 0;
      if (count === 0) {
        const filtered = list.filter((item) => {
          if (item === value) {
            removed += 1;
            return false;
          }
          return true;
        });
        this.memoryLists.set(key, filtered);
        return removed;
      }

      const result: string[] = [];
      if (count > 0) {
        for (const item of list) {
          if (item === value && removed < count) {
            removed += 1;
            continue;
          }
          result.push(item);
        }
      } else {
        const limit = Math.abs(count);
        for (let i = list.length - 1; i >= 0; i -= 1) {
          const item = list[i];
          if (item === value && removed < limit) {
            removed += 1;
            continue;
          }
          result.unshift(item);
        }
      }

      this.memoryLists.set(key, result);
      return removed;
    }
    return this.client!.lrem(key, count, value);
  }

  async rpop(key: string): Promise<string | null> {
    if (!this.isEnabled()) {
      const list = this.memoryLists.get(key);
      if (!list || list.length === 0) return null;
      const value = list.pop() || null;
      this.memoryLists.set(key, list);
      return value;
    }
    return this.client!.rpop(key);
  }

  // ================================
  // Presence Operations
  // ================================

  async setUserOnline(
    userId: string,
    socketId: string,
    metadata?: object,
    ttlSeconds: number = 120,
  ): Promise<void> {
    const key = `presence:user:${userId}`;
    const data = {
      socketId,
      lastSeen: Date.now(),
      ...metadata,
    };
    await this.setJson(key, data, ttlSeconds);
    await this.sadd("presence:users", userId);
  }

  async setUserOffline(userId: string): Promise<void> {
    await this.del(`presence:user:${userId}`);
    await this.del(`presence:user:${userId}:sockets`);
    await this.srem("presence:users", userId);
  }

  async addUserSocket(
    userId: string,
    socketId: string,
    ttlSeconds: number = 120,
  ): Promise<void> {
    const key = `presence:user:${userId}:sockets`;
    await this.sadd(key, socketId);
    await this.expire(key, ttlSeconds);
    await this.sadd("presence:users", userId);
  }

  async removeUserSocket(userId: string, socketId: string): Promise<void> {
    const key = `presence:user:${userId}:sockets`;
    await this.srem(key, socketId);
  }

  async getUserSockets(userId: string): Promise<string[]> {
    return this.smembers(`presence:user:${userId}:sockets`);
  }

  async getUserSocketCount(userId: string): Promise<number> {
    return this.scard(`presence:user:${userId}:sockets`);
  }

  async getOnlineUsers(): Promise<string[]> {
    return this.smembers("presence:users");
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
  // Room Online Members (with atomic operations)
  // ================================

  /**
   * Add user to room - returns true if user was newly added (SADD returns 1)
   */
  async addUserToRoom(roomId: string, userId: string): Promise<boolean> {
    if (!this.isEnabled()) {
      const key = `room:${roomId}:online`;
      const entry = this.memoryCache.get(key);
      const set = entry ? new Set(JSON.parse(entry.value)) : new Set<string>();
      const wasNew = !set.has(userId);
      set.add(userId);
      this.memoryCache.set(key, { value: JSON.stringify([...set]) });
      return wasNew;
    }
    const result = await this.client!.sadd(`room:${roomId}:online`, userId);
    return result === 1;
  }

  /**
   * Remove user from room - returns true if user was actually removed
   */
  async removeUserFromRoom(roomId: string, userId: string): Promise<boolean> {
    if (!this.isEnabled()) {
      const key = `room:${roomId}:online`;
      const entry = this.memoryCache.get(key);
      if (!entry) return false;
      const set = new Set(JSON.parse(entry.value));
      const wasPresent = set.has(userId);
      set.delete(userId);
      this.memoryCache.set(key, { value: JSON.stringify([...set]) });
      return wasPresent;
    }
    const result = await this.client!.srem(`room:${roomId}:online`, userId);
    return result === 1;
  }

  async getRoomOnlineUsers(roomId: string): Promise<string[]> {
    return this.smembers(`room:${roomId}:online`);
  }

  async getRoomOnlineCount(roomId: string): Promise<number> {
    return this.scard(`room:${roomId}:online`);
  }

  // ================================
  // 🔌 User Socket Tracking (multi-connection)
  // ================================

  /**
   * Add socket to user's room connections - returns socket count after add
   */
  async addUserSocketToRoom(roomId: string, userId: string, socketId: string): Promise<number> {
    const key = `room:${roomId}:sockets:${userId}`;
    if (!this.isEnabled()) {
      const entry = this.memoryCache.get(key);
      const set = entry ? new Set(JSON.parse(entry.value)) : new Set<string>();
      set.add(socketId);
      this.memoryCache.set(key, { value: JSON.stringify([...set]) });
      return set.size;
    }
    await this.client!.sadd(key, socketId);
    await this.client!.expire(key, 3600); // 1 hour TTL
    return await this.client!.scard(key);
  }

  /**
   * Remove socket from user's room connections - returns remaining socket count
   */
  async removeUserSocketFromRoom(roomId: string, userId: string, socketId: string): Promise<number> {
    const key = `room:${roomId}:sockets:${userId}`;
    if (!this.isEnabled()) {
      const entry = this.memoryCache.get(key);
      if (!entry) return 0;
      const set = new Set(JSON.parse(entry.value));
      set.delete(socketId);
      if (set.size === 0) {
        this.memoryCache.delete(key);
      } else {
        this.memoryCache.set(key, { value: JSON.stringify([...set]) });
      }
      return set.size;
    }
    await this.client!.srem(key, socketId);
    return await this.client!.scard(key);
  }

  /**
   * Get user's socket count in a room
   */
  async getUserSocketCountInRoom(roomId: string, userId: string): Promise<number> {
    const key = `room:${roomId}:sockets:${userId}`;
    if (!this.isEnabled()) {
      const entry = this.memoryCache.get(key);
      if (!entry) return 0;
      return new Set(JSON.parse(entry.value)).size;
    }
    return await this.client!.scard(key);
  }

  /**
   * Clear all sockets for user in room
   */
  async clearUserSocketsInRoom(roomId: string, userId: string): Promise<void> {
    const key = `room:${roomId}:sockets:${userId}`;
    await this.del(key);
  }

  // ================================
  // 📦 User Info Cache (reduce DB lookups)
  // ================================

  /**
   * Cache user public info for fast lookups
   */
  async cacheUserPublicInfo(userId: string, info: {
    name: string;
    avatar?: string;
    numericId?: string;
  }): Promise<void> {
    const key = `user:${userId}:public`;
    const data = JSON.stringify(info);
    await this.set(key, data, 1800); // 30 min TTL
  }

  /**
   * Get cached user public info
   */
  async getCachedUserPublicInfo(userId: string): Promise<{
    name: string;
    avatar?: string;
    numericId?: string;
  } | null> {
    const key = `user:${userId}:public`;
    const data = await this.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Batch get cached user info
   */
  async batchGetCachedUserInfo(userIds: string[]): Promise<Map<string, { name: string; avatar?: string; numericId?: string }>> {
    const result = new Map<string, { name: string; avatar?: string; numericId?: string }>();
    if (!this.isEnabled() || userIds.length === 0) return result;
    
    const keys = userIds.map(id => `user:${id}:public`);
    const values = await this.client!.mget(...keys);
    
    for (let i = 0; i < userIds.length; i++) {
      const val = values[i];
      if (val) {
        try {
          result.set(userIds[i], JSON.parse(val));
        } catch {}
      }
    }
    return result;
  }

  // ================================
  // 🔒 DISTRIBUTED LOCKS (for join dedup)
  // ================================

  /**
   * Acquire a lock with NX (only if not exists)
   * Returns true if lock acquired, false if already held
   */
  async acquireLock(key: string, ttlSeconds: number = 10): Promise<boolean> {
    if (!this.isEnabled()) {
      // In-memory lock
      const entry = this.memoryCache.get(key);
      if (entry && (!entry.expiresAt || Date.now() < entry.expiresAt)) {
        return false; // Lock already held
      }
      this.memoryCache.set(key, { value: '1', expiresAt: Date.now() + ttlSeconds * 1000 });
      return true;
    }
    const result = await this.client!.set(key, Date.now().toString(), 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /**
   * Release a lock
   */
  async releaseLock(key: string): Promise<void> {
    await this.del(key);
  }

  // ================================
  // ⏰ GRACE PERIOD (for reconnects)
  // ================================

  /**
   * Set a grace period marker for user leaving a room
   * If user rejoins within grace period, don't emit user_left
   */
  async setLeaveGrace(roomId: string, userId: string, graceMs: number = 10000): Promise<void> {
    const key = `room:${roomId}:grace:${userId}`;
    const graceSeconds = Math.ceil(graceMs / 1000);
    await this.set(key, Date.now().toString(), graceSeconds);
  }

  /**
   * Check if user is in grace period
   */
  async isInGracePeriod(roomId: string, userId: string): Promise<boolean> {
    const key = `room:${roomId}:grace:${userId}`;
    return await this.exists(key);
  }

  /**
   * Clear grace period (user rejoined)
   */
  async clearGracePeriod(roomId: string, userId: string): Promise<void> {
    const key = `room:${roomId}:grace:${userId}`;
    await this.del(key);
  }

  // ================================
  // 🚫 BAN CACHE
  // ================================

  /**
   * Cache a ban in Redis for fast lookups
   */
  async cacheBan(roomId: string, userId: string, banInfo: {
    bannedBy: string;
    reason?: string;
    bannedAt: number;
    expiresAt?: number;
  }): Promise<void> {
    const key = `room:${roomId}:bans`;
    await this.hset(key, userId, JSON.stringify(banInfo));
    // Set TTL on the hash key if needed (for temp bans)
    if (banInfo.expiresAt) {
      const ttl = Math.ceil((banInfo.expiresAt - Date.now()) / 1000);
      if (ttl > 0 && this.isEnabled()) {
        await this.client!.expire(key, ttl + 60); // Extra 60s buffer
      }
    }
  }

  /**
   * Check if user is banned (from cache)
   */
  async isBanned(roomId: string, userId: string): Promise<{banned: boolean; banInfo?: any}> {
    const key = `room:${roomId}:bans`;
    const banData = await this.hget(key, userId);
    if (!banData) return { banned: false };

    try {
      const banInfo = JSON.parse(banData);
      // Check if expired
      if (banInfo.expiresAt && banInfo.expiresAt < Date.now()) {
        await this.hdel(key, userId);
        return { banned: false };
      }
      return { banned: true, banInfo };
    } catch {
      return { banned: false };
    }
  }

  /**
   * Remove ban from cache
   */
  async removeBanCache(roomId: string, userId: string): Promise<void> {
    const key = `room:${roomId}:bans`;
    await this.hdel(key, userId);
  }

  // ================================
  // 🎁 GIFT IDEMPOTENCY
  // ================================

  /**
   * Check and set gift transaction (prevents double broadcast)
   * Returns true if this is the first time seeing this transaction
   */
  async checkGiftIdempotency(giftTxId: string): Promise<boolean> {
    const key = `gift:tx:${giftTxId}`;
    // Try to acquire lock - only first one wins
    return await this.acquireLock(key, 300); // 5 min TTL
  }

  /**
   * Mark gift as processed with result
   */
  async markGiftProcessed(giftTxId: string, resultId: string): Promise<void> {
    const key = `gift:tx:${giftTxId}`;
    await this.set(key, resultId, 300);
  }

  // ================================
  // 📊 PRESENCE SNAPSHOT
  // ================================

  /**
   * Get detailed room presence with member info
   */
  async getRoomPresenceSnapshot(roomId: string): Promise<{
    memberIds: string[];
    onlineCount: number;
    version: number;
  }> {
    const memberIds = await this.getRoomOnlineUsers(roomId);
    const versionKey = `room:${roomId}:presence_version`;
    let version = 1;
    
    if (this.isEnabled()) {
      const versionStr = await this.client!.get(versionKey);
      version = versionStr ? parseInt(versionStr) : 1;
    }

    return {
      memberIds,
      onlineCount: memberIds.length,
      version,
    };
  }

  /**
   * Increment presence version (for delta sync)
   */
  async incrementPresenceVersion(roomId: string): Promise<number> {
    const key = `room:${roomId}:presence_version`;
    if (!this.isEnabled()) {
      const entry = this.memoryCache.get(key);
      const current = entry ? parseInt(entry.value) : 0;
      const newVersion = current + 1;
      this.memoryCache.set(key, { value: newVersion.toString() });
      return newVersion;
    }
    return await this.client!.incr(key);
  }
}
