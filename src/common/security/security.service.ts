/**
 * Ali Backend - Security Service
 * خدمة الأمان الرئيسية
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import * as crypto from 'crypto';

interface SecurityEvent {
  type: string;
  ip: string;
  userId?: string;
  details?: any;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);
  
  // In-memory fallback
  private readonly blockedIps = new Map<string, number>();
  private readonly loginAttempts = new Map<string, { count: number; firstAttempt: number }>();
  private readonly securityEvents: SecurityEvent[] = [];
  
  // Constants
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly BLOCK_DURATION = 15 * 60 * 1000; // 15 minutes
  private readonly ATTEMPT_WINDOW = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /**
   * تسجيل حدث أمني
   */
  async logSecurityEvent(event: Omit<SecurityEvent, 'timestamp'>): Promise<void> {
    const fullEvent: SecurityEvent = {
      ...event,
      timestamp: new Date(),
    };

    // Log to console
    const logMethod = event.severity === 'critical' || event.severity === 'high' 
      ? 'error' 
      : event.severity === 'medium' ? 'warn' : 'log';
    
    this.logger[logMethod](`🔒 Security Event [${event.severity.toUpperCase()}]: ${event.type}`, {
      ip: event.ip,
      userId: event.userId,
      details: event.details,
    });

    // Store in Redis or memory
    if (this.redis.isEnabled()) {
      const key = `security:events:${Date.now()}`;
      await this.redis.set(key, JSON.stringify(fullEvent), 86400 * 7); // 7 days
      
      // Increment counters
      await this.redis.incr(`security:count:${event.type}:${new Date().toISOString().split('T')[0]}`);
    } else {
      this.securityEvents.push(fullEvent);
      // Keep only last 1000 events in memory
      if (this.securityEvents.length > 1000) {
        this.securityEvents.shift();
      }
    }

    // Alert for critical events
    if (event.severity === 'critical') {
      await this.sendSecurityAlert(fullEvent);
    }
  }

  /**
   * فحص إذا كان IP محظور
   */
  async isIpBlocked(ip: string): Promise<boolean> {
    if (this.redis.isEnabled()) {
      const blocked = await this.redis.get(`blocked:ip:${ip}`);
      return blocked !== null;
    }
    
    const blockedUntil = this.blockedIps.get(ip);
    if (blockedUntil && blockedUntil > Date.now()) {
      return true;
    }
    
    this.blockedIps.delete(ip);
    return false;
  }

  /**
   * حظر IP
   */
  async blockIp(ip: string, reason: string, durationMs: number = this.BLOCK_DURATION): Promise<void> {
    if (this.redis.isEnabled()) {
      await this.redis.set(`blocked:ip:${ip}`, reason, Math.ceil(durationMs / 1000));
    } else {
      this.blockedIps.set(ip, Date.now() + durationMs);
    }

    await this.logSecurityEvent({
      type: 'IP_BLOCKED',
      ip,
      severity: 'high',
      details: { reason, durationMs },
    });
  }

  /**
   * إلغاء حظر IP
   */
  async unblockIp(ip: string): Promise<void> {
    if (this.redis.isEnabled()) {
      await this.redis.del(`blocked:ip:${ip}`);
    } else {
      this.blockedIps.delete(ip);
    }

    this.logger.log(`🔓 IP unblocked: ${ip}`);
  }

  /**
   * تسجيل محاولة تسجيل دخول فاشلة
   */
  async recordFailedLogin(ip: string, email?: string): Promise<{ blocked: boolean; attemptsLeft: number }> {
    const key = `login:attempts:${ip}`;
    
    if (this.redis.isEnabled()) {
      const attempts = await this.redis.incr(key);
      await this.redis.expire(key, Math.ceil(this.ATTEMPT_WINDOW / 1000));
      
      if (attempts >= this.MAX_LOGIN_ATTEMPTS) {
        await this.blockIp(ip, 'Too many failed login attempts');
        return { blocked: true, attemptsLeft: 0 };
      }
      
      return { blocked: false, attemptsLeft: this.MAX_LOGIN_ATTEMPTS - attempts };
    }
    
    // In-memory fallback
    const now = Date.now();
    const attempt = this.loginAttempts.get(ip);
    
    if (!attempt || now - attempt.firstAttempt > this.ATTEMPT_WINDOW) {
      this.loginAttempts.set(ip, { count: 1, firstAttempt: now });
      return { blocked: false, attemptsLeft: this.MAX_LOGIN_ATTEMPTS - 1 };
    }
    
    attempt.count++;
    
    if (attempt.count >= this.MAX_LOGIN_ATTEMPTS) {
      await this.blockIp(ip, 'Too many failed login attempts');
      return { blocked: true, attemptsLeft: 0 };
    }
    
    return { blocked: false, attemptsLeft: this.MAX_LOGIN_ATTEMPTS - attempt.count };
  }

  /**
   * إعادة تعيين محاولات تسجيل الدخول
   */
  async resetLoginAttempts(ip: string): Promise<void> {
    if (this.redis.isEnabled()) {
      await this.redis.del(`login:attempts:${ip}`);
    } else {
      this.loginAttempts.delete(ip);
    }
  }

  /**
   * Rate Limiting متقدم
   */
  async checkRateLimit(
    identifier: string,
    maxRequests: number,
    windowSec: number,
  ): Promise<RateLimitResult> {
    const key = `ratelimit:${identifier}`;
    const now = Date.now();
    const windowStart = now - windowSec * 1000;

    if (this.redis.isEnabled()) {
      // Remove old entries
      await this.redis.zremrangebyscore(key, 0, windowStart);
      
      // Count current requests
      const count = await this.redis.zcard(key);
      
      if (count >= maxRequests) {
        const oldest = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
        const resetAt = oldest.length > 1 ? parseInt(oldest[1]) + windowSec * 1000 : now + windowSec * 1000;
        
        return {
          allowed: false,
          remaining: 0,
          resetAt,
        };
      }
      
      // Add current request
      await this.redis.zadd(key, now, `${now}-${Math.random()}`);
      await this.redis.expire(key, windowSec);
      
      return {
        allowed: true,
        remaining: maxRequests - count - 1,
        resetAt: now + windowSec * 1000,
      };
    }

    // Fallback: allow all in development
    return { allowed: true, remaining: maxRequests, resetAt: now + windowSec * 1000 };
  }

  /**
   * تشفير بيانات حساسة
   */
  encrypt(text: string): string {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(
      this.config.get('ENCRYPTION_KEY', 'default-encryption-key-32chars!!'),
      'salt',
      32,
    );
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * فك تشفير بيانات
   */
  decrypt(encryptedText: string): string {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(
      this.config.get('ENCRYPTION_KEY', 'default-encryption-key-32chars!!'),
      'salt',
      32,
    );
    
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * توليد Token آمن
   */
  generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Hash لكلمات المرور
   */
  hashPassword(password: string): string {
    return crypto
      .createHash('sha256')
      .update(password + this.config.get('PASSWORD_SALT', 'default-salt'))
      .digest('hex');
  }

  /**
   * تحقق من صحة كلمة المرور
   */
  verifyPassword(password: string, hash: string): boolean {
    return this.hashPassword(password) === hash;
  }

  /**
   * إرسال تنبيه أمني
   */
  private async sendSecurityAlert(event: SecurityEvent): Promise<void> {
    // TODO: Implement email/SMS/webhook notifications
    this.logger.error(`🚨 CRITICAL SECURITY ALERT: ${event.type}`, {
      ...event,
    });
  }

  /**
   * الحصول على إحصائيات الأمان
   */
  async getSecurityStats(): Promise<any> {
    const today = new Date().toISOString().split('T')[0];
    
    if (this.redis.isEnabled()) {
      const keys = await this.redis.keys(`security:count:*:${today}`);
      const stats: Record<string, number> = {};
      
      for (const key of keys) {
        const type = key.split(':')[2];
        const count = await this.redis.get(key);
        stats[type] = parseInt(count || '0');
      }
      
      // Get blocked IPs count
      const blockedKeys = await this.redis.keys('blocked:ip:*');
      stats.blockedIps = blockedKeys.length;
      
      return {
        date: today,
        events: stats,
        totalEvents: Object.values(stats).reduce((a, b) => a + b, 0),
      };
    }

    return {
      date: today,
      events: {},
      eventsInMemory: this.securityEvents.length,
      blockedIps: this.blockedIps.size,
    };
  }
}
