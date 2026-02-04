/**
 * Push Notification Service - Firebase HTTP v1 API
 * خدمة الإشعارات باستخدام Firebase Cloud Messaging
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface ServiceAccount {
  project_id: string;
  private_key: string;
  client_email: string;
}

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
  private serviceAccount: ServiceAccount | null = null;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.loadServiceAccount();
  }

  private async loadServiceAccount() {
    try {
      // Try loading from file first
      const filePath = path.join(process.cwd(), 'firebase-service-account.json');
      
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        this.serviceAccount = JSON.parse(content);
        this.isInitialized = true;
        this.logger.log('✅ Firebase Push Notification Service initialized from file');
        return;
      }

      // Try loading from environment variables
      const projectId = this.configService.get<string>('firebase.projectId');
      const clientEmail = this.configService.get<string>('firebase.clientEmail');
      const privateKey = this.configService.get<string>('firebase.privateKey');

      if (projectId && clientEmail && privateKey) {
        this.serviceAccount = {
          project_id: projectId,
          private_key: privateKey.replace(/\\n/g, '\n'),
          client_email: clientEmail,
        };
        this.isInitialized = true;
        this.logger.log('✅ Firebase Push Notification Service initialized from env');
        return;
      }

      this.logger.warn('⚠️ Firebase not configured - Push notifications disabled');
      this.logger.warn('   Add firebase-service-account.json or set FIREBASE_* env vars');
    } catch (error) {
      this.logger.error(`Failed to load Firebase service account: ${error.message}`);
    }
  }

  isEnabled(): boolean {
    return this.isInitialized && this.serviceAccount !== null;
  }

  // ================================
  // OAuth 2.0 Token Management
  // ================================

  private async getAccessToken(): Promise<string | null> {
    if (!this.serviceAccount) return null;

    // Return cached token if still valid (with 1 minute buffer)
    if (this.accessToken && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }

    try {
      const now = Math.floor(Date.now() / 1000);
      const expiry = now + 3600; // 1 hour

      // Create JWT
      const header = { alg: 'RS256', typ: 'JWT' };
      const payload = {
        iss: this.serviceAccount.client_email,
        sub: this.serviceAccount.client_email,
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: expiry,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
      };

      const jwt = this.createJWT(header, payload, this.serviceAccount.private_key);

      // Exchange JWT for access token
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt,
        }),
      });

      const data = await response.json();

      if (data.access_token) {
        this.accessToken = data.access_token;
        this.tokenExpiry = Date.now() + (data.expires_in * 1000);
        this.logger.debug('Firebase access token refreshed');
        return this.accessToken;
      }

      this.logger.error(`Failed to get access token: ${JSON.stringify(data)}`);
      return null;
    } catch (error) {
      this.logger.error(`OAuth error: ${error.message}`);
      return null;
    }
  }

  private createJWT(header: object, payload: object, privateKey: string): string {
    const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signatureInput = `${base64Header}.${base64Payload}`;

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signatureInput);
    const signature = sign.sign(privateKey, 'base64url');

    return `${signatureInput}.${signature}`;
  }

  // ================================
  // FCM HTTP v1 API
  // ================================

  private async sendFCMMessage(token: string, payload: PushNotificationPayload): Promise<boolean> {
    const accessToken = await this.getAccessToken();
    if (!accessToken || !this.serviceAccount) return false;

    try {
      const message: any = {
        message: {
          token,
          notification: {
            title: payload.title,
            body: payload.body,
          },
        },
      };

      // Add image if provided
      if (payload.imageUrl) {
        message.message.notification.image = payload.imageUrl;
      }

      // Add data payload
      if (payload.data) {
        message.message.data = payload.data;
      }

      // Android specific config
      message.message.android = {
        priority: 'high',
        notification: {
          sound: 'default',
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
      };

      // iOS specific config
      message.message.apns = {
        payload: {
          aps: {
            sound: 'default',
            badge: payload.badge || 1,
          },
        },
      };

      const url = `https://fcm.googleapis.com/v1/projects/${this.serviceAccount.project_id}/messages:send`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      const result = await response.json();

      if (response.ok) {
        this.logger.debug(`FCM message sent: ${result.name}`);
        return true;
      }

      // Handle invalid token - deactivate it
      if (result.error?.code === 404 || result.error?.details?.some((d: any) => 
        d.errorCode === 'UNREGISTERED' || d.errorCode === 'INVALID_ARGUMENT')) {
        this.logger.warn(`Invalid FCM token, deactivating: ${token.substring(0, 20)}...`);
        await this.deactivateToken(token);
      }

      this.logger.error(`FCM error: ${JSON.stringify(result.error)}`);
      return false;
    } catch (error) {
      this.logger.error(`FCM request failed: ${error.message}`);
      return false;
    }
  }

  // ================================
  // SEND TO SINGLE USER
  // ================================

  async sendToUser(userId: string, payload: PushNotificationPayload): Promise<SendResult> {
    if (!this.isEnabled()) {
      return { success: false, successCount: 0, failureCount: 0, errors: ['FCM not configured'] };
    }

    // Get user's FCM tokens
    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId, isActive: true },
      select: { token: true },
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
      return { success: false, successCount: 0, failureCount: 0, errors: ['FCM not configured'] };
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
  // SEND TO TOKENS (FCM tokens)
  // ================================

  async sendToTokens(tokens: string[], payload: PushNotificationPayload): Promise<SendResult> {
    if (!this.isEnabled()) {
      return { success: false, successCount: 0, failureCount: 0, errors: ['FCM not configured'] };
    }

    if (tokens.length === 0) {
      return { success: false, successCount: 0, failureCount: 0, errors: ['No tokens provided'] };
    }

    let successCount = 0;
    let failureCount = 0;
    const errors: string[] = [];

    // Send to each token (FCM v1 doesn't support multicast directly)
    // Process in batches of 10 to avoid overwhelming the API
    const batchSize = 10;
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((token) => this.sendFCMMessage(token, payload)),
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          successCount++;
        } else {
          failureCount++;
          if (result.status === 'rejected') {
            errors.push(result.reason?.message || 'Unknown error');
          }
        }
      }
    }

    this.logger.log(`Push sent: ${successCount} success, ${failureCount} failed`);

    return {
      success: successCount > 0,
      successCount,
      failureCount,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // ================================
  // SEND TO EXTERNAL USER IDs
  // ================================

  async sendToExternalUserIds(externalUserIds: string[], payload: PushNotificationPayload): Promise<SendResult> {
    // For FCM, external user IDs are the same as user IDs
    return this.sendToUsers(externalUserIds, payload);
  }

  // ================================
  // SEND TO ALL USERS
  // ================================

  async sendToAll(payload: PushNotificationPayload): Promise<SendResult> {
    if (!this.isEnabled()) {
      return { success: false, successCount: 0, failureCount: 0, errors: ['FCM not configured'] };
    }

    // Get all active device tokens
    const tokens = await this.prisma.deviceToken.findMany({
      where: { isActive: true },
      select: { token: true },
    });

    if (tokens.length === 0) {
      return { success: false, successCount: 0, failureCount: 0, errors: ['No active tokens'] };
    }

    return this.sendToTokens(
      tokens.map((t) => t.token),
      payload,
    );
  }

  // ================================
  // SEND TO TOPIC
  // ================================

  async sendToTopic(topic: string, payload: PushNotificationPayload): Promise<boolean> {
    const accessToken = await this.getAccessToken();
    if (!accessToken || !this.serviceAccount) return false;

    try {
      const message = {
        message: {
          topic,
          notification: {
            title: payload.title,
            body: payload.body,
            image: payload.imageUrl,
          },
          data: payload.data,
          android: {
            priority: 'high',
            notification: {
              sound: 'default',
            },
          },
          apns: {
            payload: {
              aps: {
                sound: 'default',
              },
            },
          },
        },
      };

      const url = `https://fcm.googleapis.com/v1/projects/${this.serviceAccount.project_id}/messages:send`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      if (response.ok) {
        this.logger.log(`Topic notification sent to: ${topic}`);
        return true;
      }

      const error = await response.json();
      this.logger.error(`Topic notification failed: ${JSON.stringify(error)}`);
      return false;
    } catch (error) {
      this.logger.error(`Topic notification error: ${error.message}`);
      return false;
    }
  }

  // ================================
  // DEVICE TOKEN MANAGEMENT
  // ================================

  async registerToken(userId: string, token: string, platform: 'ANDROID' | 'IOS' | 'WEB'): Promise<void> {
    try {
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

      this.logger.debug(`FCM token registered for user ${userId} (${platform})`);
    } catch (error) {
      this.logger.error(`Failed to register token: ${error.message}`);
    }
  }

  async deactivateToken(token: string): Promise<void> {
    try {
      await this.prisma.deviceToken.updateMany({
        where: { token },
        data: { isActive: false },
      });
    } catch (error) {
      this.logger.error(`Failed to deactivate token: ${error.message}`);
    }
  }

  async removeToken(token: string): Promise<void> {
    try {
      await this.prisma.deviceToken.deleteMany({
        where: { token },
      });
    } catch (error) {
      this.logger.error(`Failed to remove token: ${error.message}`);
    }
  }

  async removeUserTokens(userId: string): Promise<void> {
    try {
      await this.prisma.deviceToken.deleteMany({
        where: { userId },
      });
    } catch (error) {
      this.logger.error(`Failed to remove user tokens: ${error.message}`);
    }
  }

  // ================================
  // TOPIC SUBSCRIPTION
  // ================================

  async subscribeToTopic(token: string, topic: string): Promise<boolean> {
    const accessToken = await this.getAccessToken();
    if (!accessToken || !this.serviceAccount) return false;

    try {
      const url = `https://iid.googleapis.com/iid/v1/${token}/rel/topics/${topic}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        this.logger.debug(`Token subscribed to topic: ${topic}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`Topic subscription failed: ${error.message}`);
      return false;
    }
  }

  async unsubscribeFromTopic(token: string, topic: string): Promise<boolean> {
    const accessToken = await this.getAccessToken();
    if (!accessToken || !this.serviceAccount) return false;

    try {
      const url = `https://iid.googleapis.com/iid/v1/${token}/rel/topics/${topic}`;
      
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        this.logger.debug(`Token unsubscribed from topic: ${topic}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`Topic unsubscription failed: ${error.message}`);
      return false;
    }
  }
}
