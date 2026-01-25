import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RtcTokenBuilder, RtcRole } from 'agora-access-token';

export enum AgoraTokenRole {
  BROADCASTER = 'broadcaster',
  AUDIENCE = 'audience',
}

export interface AgoraTokenRequest {
  channelName: string;
  uid: number;
  role: AgoraTokenRole;
  expireTimeInSeconds?: number;
}

export interface AgoraTokenResponse {
  token: string;
  uid: number;
  channelName: string;
  role: string;
  expireTime: number;
}

@Injectable()
export class AgoraService {
  private readonly logger = new Logger(AgoraService.name);
  private readonly appId: string;
  private readonly appCertificate: string;
  private readonly defaultExpireTime = 3600; // 1 hour

  constructor(private configService: ConfigService) {
    this.appId = this.configService.get<string>('agora.appId') || '';
    this.appCertificate = this.configService.get<string>('agora.appCertificate') || '';

    if (this.isConfigured()) {
      this.logger.log('✅ Agora Service initialized with App ID');
    } else {
      this.logger.warn('⚠️ Agora Service not configured - missing App ID or Certificate');
    }
  }

  /**
   * Check if Agora is properly configured
   */
  isConfigured(): boolean {
    return !!(this.appId && this.appCertificate);
  }

  /**
   * Get App ID (for client-side initialization)
   */
  getAppId(): string {
    return this.appId;
  }

  /**
   * Generate RTC Token for voice/video channels
   */
  generateToken(request: AgoraTokenRequest): AgoraTokenResponse {
    if (!this.isConfigured()) {
      throw new BadRequestException('Agora is not configured. Please set AGORA_APP_ID and AGORA_APP_CERTIFICATE.');
    }

    const { channelName, uid, role, expireTimeInSeconds } = request;

    if (!channelName || channelName.trim() === '') {
      throw new BadRequestException('Channel name is required');
    }

    if (uid === undefined || uid === null) {
      throw new BadRequestException('UID is required');
    }

    // Calculate privilege expire time
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const expireTime = expireTimeInSeconds || this.defaultExpireTime;
    const privilegeExpiredTs = currentTimestamp + expireTime;

    // Determine RTC role
    const rtcRole = role === AgoraTokenRole.BROADCASTER 
      ? RtcRole.PUBLISHER 
      : RtcRole.SUBSCRIBER;

    try {
      // Generate token using Agora SDK
      const token = RtcTokenBuilder.buildTokenWithUid(
        this.appId,
        this.appCertificate,
        channelName,
        uid,
        rtcRole,
        privilegeExpiredTs,
      );

      this.logger.debug(`🎫 Generated Agora token for channel: ${channelName}, uid: ${uid}, role: ${role}`);

      return {
        token,
        uid,
        channelName,
        role: role || AgoraTokenRole.AUDIENCE,
        expireTime: privilegeExpiredTs,
      };
    } catch (error) {
      this.logger.error(`Failed to generate Agora token: ${error.message}`);
      throw new BadRequestException(`Failed to generate token: ${error.message}`);
    }
  }

  /**
   * Generate token for a room (helper method)
   */
  generateRoomToken(
    roomId: string,
    userId: string,
    role: AgoraTokenRole = AgoraTokenRole.AUDIENCE,
    expireTimeInSeconds?: number,
  ): AgoraTokenResponse {
    // Create channel name from room ID
    const channelName = `room_${roomId}`;
    
    // Create numeric UID from user ID (hash)
    const uid = this.hashStringToUid(userId);

    return this.generateToken({
      channelName,
      uid,
      role,
      expireTimeInSeconds,
    });
  }

  /**
   * Convert string user ID to numeric UID for Agora
   * Agora requires numeric UIDs
   */
  private hashStringToUid(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) % 100000000; // Keep it within a reasonable range
  }
}
