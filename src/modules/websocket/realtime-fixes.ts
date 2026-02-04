/**
 * ==========================================================
 * Real-time Performance & Reliability Fixes
 * ==========================================================
 * 
 * هذا الملف يحتوي على الخدمات المحسّنة للـ Real-time
 * يتم استيراده في app.gateway.ts
 * 
 * المشاكل المعالجة:
 * 1. تأخر ظهور التعليقات (Latency)
 * 2. تذبذب قائمة الموجودين (Presence flicker)
 * 3. الحظر غير الفعال (Ban enforcement)
 * 4. الهدايا لا تظهر للجميع (Gift broadcast)
 */

import { Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

// ==========================================================
// TELEMETRY & INSTRUMENTATION
// ==========================================================

export interface EventTelemetry {
  correlationId: string;
  eventType: string;
  roomId?: string;
  userId?: string;
  socketId?: string;
  serverTs: number;
  clientTs?: number;
  latencyMs?: number;
  success: boolean;
  error?: string;
}

export class TelemetryService {
  private static logger = new Logger('Telemetry');
  private static eventTimings = new Map<string, number[]>();
  private static readonly MAX_SAMPLES = 100;

  /**
   * Generate correlation ID for request tracking
   */
  static generateCorrelationId(): string {
    return `evt_${Date.now()}_${uuidv4().substring(0, 8)}`;
  }

  /**
   * Create telemetry context for an event
   */
  static createContext(eventType: string, data: {
    roomId?: string;
    userId?: string;
    socketId?: string;
    clientTs?: number;
  }): EventTelemetry {
    const serverTs = Date.now();
    return {
      correlationId: this.generateCorrelationId(),
      eventType,
      roomId: data.roomId,
      userId: data.userId,
      socketId: data.socketId,
      serverTs,
      clientTs: data.clientTs,
      latencyMs: data.clientTs ? serverTs - data.clientTs : undefined,
      success: true,
    };
  }

  /**
   * Record event timing for p95 calculation
   */
  static recordTiming(eventType: string, latencyMs: number): void {
    if (!this.eventTimings.has(eventType)) {
      this.eventTimings.set(eventType, []);
    }
    const timings = this.eventTimings.get(eventType)!;
    timings.push(latencyMs);
    
    // Keep only last MAX_SAMPLES
    if (timings.length > this.MAX_SAMPLES) {
      timings.shift();
    }
  }

  /**
   * Get p95 latency for event type
   */
  static getP95(eventType: string): number | null {
    const timings = this.eventTimings.get(eventType);
    if (!timings || timings.length < 10) return null;
    
    const sorted = [...timings].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    return sorted[p95Index];
  }

  /**
   * Log event with telemetry
   */
  static logEvent(ctx: EventTelemetry, message?: string): void {
    const p95 = this.getP95(ctx.eventType);
    const p95Str = p95 ? ` [p95=${p95}ms]` : '';
    
    if (ctx.latencyMs && ctx.latencyMs > 150) {
      this.logger.warn(
        `⚠️ [${ctx.eventType}] ${ctx.correlationId} latency=${ctx.latencyMs}ms${p95Str} ${message || ''}`
      );
    } else {
      this.logger.debug(
        `📊 [${ctx.eventType}] ${ctx.correlationId} latency=${ctx.latencyMs || 'N/A'}ms${p95Str} ${message || ''}`
      );
    }

    if (ctx.latencyMs) {
      this.recordTiming(ctx.eventType, ctx.latencyMs);
    }
  }
}

// ==========================================================
// PRESENCE SYSTEM (AUTHORITATIVE)
// ==========================================================

export interface PresenceMember {
  odaId: string;
  odaName: string;
  odaAvatar?: string;
  role: string;
  joinedAt: number;
  lastHeartbeat: number;
  socketIds: string[];
}

export interface PresenceSnapshot {
  roomId: string;
  members: PresenceMember[];
  onlineCount: number;
  serverTs: number;
  version: number;
}

export class PresenceManager {
  private static logger = new Logger('PresenceManager');
  
  // Reconnection grace period (10 seconds)
  static readonly RECONNECT_GRACE_MS = 10000;
  // Heartbeat timeout
  static readonly HEARTBEAT_TIMEOUT_MS = 30000;
  // Presence TTL in Redis
  static readonly PRESENCE_TTL_SECONDS = 120;

  /**
   * Create Redis key for room members
   */
  static roomMembersKey(roomId: string): string {
    return `room:${roomId}:members`;
  }

  /**
   * Create Redis key for join lock (dedupe)
   */
  static joinLockKey(roomId: string, userId: string): string {
    return `room:${roomId}:join_lock:${userId}`;
  }

  /**
   * Create Redis key for leave grace period
   */
  static leaveGraceKey(roomId: string, userId: string): string {
    return `room:${roomId}:leave_grace:${userId}`;
  }

  /**
   * Create Redis key for room bans
   */
  static roomBansKey(roomId: string): string {
    return `room:${roomId}:bans`;
  }

  /**
   * Create Redis key for gift idempotency
   */
  static giftIdempotencyKey(giftTxId: string): string {
    return `gift:tx:${giftTxId}`;
  }
}

// ==========================================================
// BAN ENFORCEMENT
// ==========================================================

export interface BanInfo {
  odaId: string;
  bannedBy: string;
  reason?: string;
  bannedAt: number;
  expiresAt?: number;
}

export class BanEnforcer {
  private static logger = new Logger('BanEnforcer');

  /**
   * Check if user is banned from room
   */
  static async checkBan(
    redis: any,
    roomId: string,
    userId: string,
  ): Promise<{ banned: boolean; banInfo?: BanInfo }> {
    try {
      // Check Redis cache first
      const banKey = PresenceManager.roomBansKey(roomId);
      const banData = await redis.hget(banKey, userId);
      
      if (banData) {
        const banInfo: BanInfo = JSON.parse(banData);
        
        // Check if ban expired
        if (banInfo.expiresAt && banInfo.expiresAt < Date.now()) {
          // Remove expired ban
          await redis.hdel(banKey, userId);
          return { banned: false };
        }
        
        return { banned: true, banInfo };
      }
      
      return { banned: false };
    } catch (error) {
      this.logger.error(`Ban check error: ${error.message}`);
      return { banned: false };
    }
  }

  /**
   * Add user to room ban list
   */
  static async addBan(
    redis: any,
    roomId: string,
    banInfo: BanInfo,
  ): Promise<void> {
    const banKey = PresenceManager.roomBansKey(roomId);
    await redis.hset(banKey, banInfo.odaId, JSON.stringify(banInfo));
    
    // Set expiry on the hash if this is a temporary ban
    if (banInfo.expiresAt) {
      const ttl = Math.ceil((banInfo.expiresAt - Date.now()) / 1000);
      if (ttl > 0) {
        // Note: Can't set per-field TTL in Redis hash
        // The cleanup job will handle expired bans
      }
    }
  }

  /**
   * Remove user from room ban list
   */
  static async removeBan(
    redis: any,
    roomId: string,
    userId: string,
  ): Promise<void> {
    const banKey = PresenceManager.roomBansKey(roomId);
    await redis.hdel(banKey, userId);
  }
}

// ==========================================================
// GIFT IDEMPOTENCY
// ==========================================================

export class GiftIdempotency {
  private static logger = new Logger('GiftIdempotency');
  private static readonly IDEMPOTENCY_TTL_SECONDS = 300; // 5 minutes

  /**
   * Check if gift transaction already processed
   */
  static async checkAndSet(
    redis: any,
    giftTxId: string,
  ): Promise<{ duplicate: boolean; existingId?: string }> {
    const key = PresenceManager.giftIdempotencyKey(giftTxId);
    
    // Try to set with NX (only if not exists)
    const result = await redis.set(key, Date.now().toString(), 'EX', this.IDEMPOTENCY_TTL_SECONDS, 'NX');
    
    if (result === 'OK') {
      return { duplicate: false };
    }
    
    const existingId = await redis.get(key);
    return { duplicate: true, existingId };
  }

  /**
   * Mark gift as processed with result ID
   */
  static async markProcessed(
    redis: any,
    giftTxId: string,
    resultId: string,
  ): Promise<void> {
    const key = PresenceManager.giftIdempotencyKey(giftTxId);
    await redis.set(key, resultId, 'EX', this.IDEMPOTENCY_TTL_SECONDS);
  }
}

// ==========================================================
// RATE LIMITER (Per-socket)
// ==========================================================

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export class SocketRateLimiter {
  private static limits = new Map<string, Map<string, number[]>>();
  
  static readonly LIMITS: Record<string, RateLimitConfig> = {
    'send_message': { maxRequests: 20, windowMs: 10000 },  // 20 msgs per 10s
    'gift_send': { maxRequests: 10, windowMs: 60000 },     // 10 gifts per minute
    'typing_start': { maxRequests: 5, windowMs: 5000 },    // 5 per 5s
    'heartbeat': { maxRequests: 2, windowMs: 5000 },       // 2 per 5s
  };

  /**
   * Check if request is rate limited
   */
  static check(socketId: string, eventType: string): { allowed: boolean; retryAfterMs?: number } {
    const config = this.LIMITS[eventType];
    if (!config) return { allowed: true };

    if (!this.limits.has(socketId)) {
      this.limits.set(socketId, new Map());
    }
    const socketLimits = this.limits.get(socketId)!;

    const now = Date.now();
    const windowStart = now - config.windowMs;

    // Get timestamps for this event
    let timestamps = socketLimits.get(eventType) || [];
    
    // Remove old timestamps
    timestamps = timestamps.filter(ts => ts > windowStart);
    
    if (timestamps.length >= config.maxRequests) {
      const oldestInWindow = timestamps[0];
      const retryAfterMs = oldestInWindow + config.windowMs - now;
      return { allowed: false, retryAfterMs };
    }

    // Add current timestamp
    timestamps.push(now);
    socketLimits.set(eventType, timestamps);

    return { allowed: true };
  }

  /**
   * Clear rate limits for disconnected socket
   */
  static clear(socketId: string): void {
    this.limits.delete(socketId);
  }
}

// ==========================================================
// OPTIMISTIC BROADCAST QUEUE
// ==========================================================

export interface BroadcastItem {
  id: string;
  roomId: string;
  eventType: string;
  data: any;
  createdAt: number;
  confirmed: boolean;
  retryCount: number;
}

export class BroadcastQueue {
  private static pending = new Map<string, BroadcastItem>();
  private static readonly MAX_RETRY = 3;
  private static readonly CONFIRM_TIMEOUT_MS = 5000;

  /**
   * Add item to pending confirmation
   */
  static addPending(item: BroadcastItem): void {
    this.pending.set(item.id, item);
    
    // Auto-cleanup after timeout
    setTimeout(() => {
      const existing = this.pending.get(item.id);
      if (existing && !existing.confirmed) {
        this.pending.delete(item.id);
      }
    }, this.CONFIRM_TIMEOUT_MS);
  }

  /**
   * Confirm item was persisted
   */
  static confirm(id: string): void {
    const item = this.pending.get(id);
    if (item) {
      item.confirmed = true;
      this.pending.delete(id);
    }
  }

  /**
   * Mark item as failed (for rollback)
   */
  static fail(id: string): BroadcastItem | undefined {
    const item = this.pending.get(id);
    this.pending.delete(id);
    return item;
  }
}

export default {
  TelemetryService,
  PresenceManager,
  BanEnforcer,
  GiftIdempotency,
  SocketRateLimiter,
  BroadcastQueue,
};
