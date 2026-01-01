import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
}

@Injectable()
export class FirebasePushService {
  private readonly logger = new Logger(FirebasePushService.name);
  private app: admin.app.App | null = null;

  constructor(private configService: ConfigService) {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');

    if (projectId && clientEmail && privateKey) {
      try {
        this.app = admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            clientEmail,
            privateKey: privateKey.replace(/\\n/g, '\n'),
          }),
        });
        this.logger.log('🔔 Firebase Push initialized');
      } catch (error) {
        this.logger.error(`Firebase init failed: ${error.message}`);
      }
    } else {
      this.logger.warn('⚠️ Firebase Push not configured');
    }
  }

  async sendToDevice(token: string, payload: PushNotificationPayload): Promise<boolean> {
    if (!this.app) {
      this.logger.warn('Firebase not initialized');
      return false;
    }

    try {
      const message: admin.messaging.Message = {
        token,
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data: payload.data,
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      await admin.messaging().send(message);
      this.logger.log(`Push sent to ${token.substring(0, 20)}...`);
      return true;
    } catch (error) {
      this.logger.error(`Push failed: ${error.message}`);
      return false;
    }
  }

  async sendToMultipleDevices(
    tokens: string[],
    payload: PushNotificationPayload,
  ): Promise<{ success: number; failure: number }> {
    if (!this.app || tokens.length === 0) {
      return { success: 0, failure: tokens.length };
    }

    try {
      const message: admin.messaging.MulticastMessage = {
        tokens,
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data: payload.data,
        android: {
          priority: 'high',
        },
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      this.logger.log(
        `Push multicast: ${response.successCount} success, ${response.failureCount} failed`,
      );
      return {
        success: response.successCount,
        failure: response.failureCount,
      };
    } catch (error) {
      this.logger.error(`Multicast failed: ${error.message}`);
      return { success: 0, failure: tokens.length };
    }
  }

  async sendToTopic(topic: string, payload: PushNotificationPayload): Promise<boolean> {
    if (!this.app) {
      return false;
    }

    try {
      const message: admin.messaging.Message = {
        topic,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data,
      };

      await admin.messaging().send(message);
      this.logger.log(`Push sent to topic: ${topic}`);
      return true;
    } catch (error) {
      this.logger.error(`Topic push failed: ${error.message}`);
      return false;
    }
  }

  async subscribeToTopic(tokens: string[], topic: string): Promise<void> {
    if (!this.app || tokens.length === 0) return;

    try {
      await admin.messaging().subscribeToTopic(tokens, topic);
      this.logger.log(`${tokens.length} devices subscribed to ${topic}`);
    } catch (error) {
      this.logger.error(`Subscribe failed: ${error.message}`);
    }
  }

  async unsubscribeFromTopic(tokens: string[], topic: string): Promise<void> {
    if (!this.app || tokens.length === 0) return;

    try {
      await admin.messaging().unsubscribeFromTopic(tokens, topic);
      this.logger.log(`${tokens.length} devices unsubscribed from ${topic}`);
    } catch (error) {
      this.logger.error(`Unsubscribe failed: ${error.message}`);
    }
  }
}
