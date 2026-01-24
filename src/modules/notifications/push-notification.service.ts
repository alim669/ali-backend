/**
 * Push Notification Service - خدمة الإشعارات الفورية
 * تم تعطيل مزود الإشعارات (بدون Firebase)
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
  badge?: number;
}

export interface SendResult {
  success: boolean;
  successCount: number;
  failureCount: number;
  errors?: string[];
}

@Injectable()
export class PushNotificationService implements OnModuleInit {
  private readonly logger = new Logger(PushNotificationService.name);
  private isInitialized = false;

  constructor(
    private prisma: PrismaService,
  ) {}

  async onModuleInit() {
    this.isInitialized = false;
    this.logger.warn('⚠️ Push notifications disabled (no provider configured)');
  }

  isEnabled(): boolean {
    return this.isInitialized;
  }

  // ================================
  // SEND TO SINGLE USER
  // ================================

  async sendToUser(userId: string, payload: PushNotificationPayload): Promise<SendResult> {
    if (!this.isEnabled()) {
      return { success: false, successCount: 0, failureCount: 0, errors: ['Push provider not configured'] };
    }

    // Get user's device tokens
    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId, isActive: true },
      select: { token: true, id: true },
    });

    if (tokens.length === 0) {
      this.logger.debug(`No active device tokens for user ${userId}`);
      return { success: false, successCount: 0, failureCount: 0, errors: ['No device tokens'] };
    }

    return this.sendToTokens(
      tokens.map((t) => t.token),
      payload,
    );
  }

  // ================================
  // SEND TO MULTIPLE USERS
  // ================================

  async sendToUsers(userIds: string[], payload: PushNotificationPayload): Promise<SendResult> {
    if (!this.isEnabled()) {
      return { success: false, successCount: 0, failureCount: 0, errors: ['Push provider not configured'] };
    }

    // Get all device tokens for users
    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId: { in: userIds }, isActive: true },
      select: { token: true },
    });

    if (tokens.length === 0) {
      return { success: false, successCount: 0, failureCount: 0, errors: ['No device tokens'] };
    }

    return this.sendToTokens(
      tokens.map((t) => t.token),
      payload,
    );
  }

  // ================================
  // SEND TO TOKENS
  // ================================

  async sendToTokens(tokens: string[], payload: PushNotificationPayload): Promise<SendResult> {
    if (!this.isEnabled()) {
      return { success: false, successCount: 0, failureCount: 0, errors: ['Push provider not configured'] };
    }

    if (tokens.length === 0) {
      return { success: false, successCount: 0, failureCount: 0, errors: ['No tokens provided'] };
    }

    this.logger.warn('Push provider not configured - message not sent');
    return {
      success: false,
      successCount: 0,
      failureCount: tokens.length,
      errors: ['Push provider not configured'],
    };
  }

  // ================================
  // SEND TO TOPIC
  // ================================

  async sendToTopic(topic: string, payload: PushNotificationPayload): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }
    this.logger.warn('Push provider not configured - topic message not sent');
    return false;
  }

  // ================================
  // DEVICE TOKEN MANAGEMENT
  // ================================

  async registerToken(userId: string, token: string, platform: 'ANDROID' | 'IOS' | 'WEB'): Promise<void> {
    await this.prisma.deviceToken.upsert({
      where: { token },
      update: {
        userId,
        platform,
        isActive: true,
        updatedAt: new Date(),
      },
      create: {
        userId,
        token,
        platform,
        isActive: true,
      },
    });

    this.logger.debug(`Device token registered for user ${userId}`);
  }

  async deactivateToken(token: string): Promise<void> {
    await this.prisma.deviceToken.updateMany({
      where: { token },
      data: { isActive: false },
    });
  }

  async removeToken(token: string): Promise<void> {
    await this.prisma.deviceToken.deleteMany({
      where: { token },
    });
  }

  async removeUserTokens(userId: string): Promise<void> {
    await this.prisma.deviceToken.deleteMany({
      where: { userId },
    });
  }

  // ================================
  // SUBSCRIBE/UNSUBSCRIBE TO TOPIC
  // ================================

  async subscribeToTopic(userId: string, topic: string): Promise<void> {
    if (!this.isEnabled()) return;

    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId, isActive: true },
      select: { token: true },
    });

    if (tokens.length === 0) return;

    this.logger.debug(`Push provider not configured - subscribe skipped for ${userId}`);
  }

  async unsubscribeFromTopic(userId: string, topic: string): Promise<void> {
    if (!this.isEnabled()) return;

    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId, isActive: true },
      select: { token: true },
    });

    if (tokens.length === 0) return;

    this.logger.debug(`Push provider not configured - unsubscribe skipped for ${userId}`);
  }
}
