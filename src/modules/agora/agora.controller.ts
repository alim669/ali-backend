import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { AgoraService, AgoraTokenRole } from './agora.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';

class GenerateTokenDto {
  channelName?: string;
  roomId?: string;
  uid?: number;
  role?: string;
  expireTime?: number;
}

@ApiTags('agora')
@Controller('agora')
export class AgoraController {
  constructor(private readonly agoraService: AgoraService) {}

  @Get('config')
  @Public()
  @ApiOperation({ summary: 'Get Agora configuration status' })
  @ApiResponse({ status: 200, description: 'Agora configuration status' })
  getConfig() {
    return {
      configured: this.agoraService.isConfigured(),
      appId: this.agoraService.isConfigured() ? this.agoraService.getAppId() : null,
    };
  }

  @Get('token')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate Agora RTC token (GET)' })
  @ApiQuery({ name: 'channel', required: false, description: 'Channel name' })
  @ApiQuery({ name: 'roomId', required: false, description: 'Room ID (alternative to channel)' })
  @ApiQuery({ name: 'uid', required: false, description: 'User ID (numeric)' })
  @ApiQuery({ name: 'role', required: false, enum: ['broadcaster', 'audience'] })
  @ApiQuery({ name: 'userId', required: false, description: 'User ID for auto UID generation' })
  @ApiResponse({ status: 200, description: 'Token generated successfully' })
  async getToken(
    @Query('channel') channel: string,
    @Query('roomId') roomId: string,
    @Query('uid') uid: string,
    @Query('role') role: string,
    @Query('userId') userId: string,
    @CurrentUser('id') currentUserId: string,
  ) {
    // Use roomId if provided, otherwise use channel
    if (roomId) {
      const tokenRole = role === 'broadcaster' 
        ? AgoraTokenRole.BROADCASTER 
        : AgoraTokenRole.AUDIENCE;
      
      return this.agoraService.generateRoomToken(
        roomId,
        userId || currentUserId,
        tokenRole,
      );
    }

    if (!channel) {
      throw new BadRequestException('Either channel or roomId is required');
    }

    const numericUid = uid ? parseInt(uid, 10) : this.hashStringToUid(userId || currentUserId);
    const tokenRole = role === 'broadcaster' 
      ? AgoraTokenRole.BROADCASTER 
      : AgoraTokenRole.AUDIENCE;

    return this.agoraService.generateToken({
      channelName: channel,
      uid: numericUid,
      role: tokenRole,
    });
  }

  @Post('token')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate Agora RTC token (POST)' })
  @ApiResponse({ status: 200, description: 'Token generated successfully' })
  async postToken(
    @Body() dto: GenerateTokenDto,
    @CurrentUser('id') currentUserId: string,
  ) {
    // Use roomId if provided
    if (dto.roomId) {
      const tokenRole = dto.role === 'broadcaster' 
        ? AgoraTokenRole.BROADCASTER 
        : AgoraTokenRole.AUDIENCE;
      
      return this.agoraService.generateRoomToken(
        dto.roomId,
        currentUserId,
        tokenRole,
        dto.expireTime,
      );
    }

    if (!dto.channelName) {
      throw new BadRequestException('Either channelName or roomId is required');
    }

    const numericUid = dto.uid || this.hashStringToUid(currentUserId);
    const tokenRole = dto.role === 'broadcaster' 
      ? AgoraTokenRole.BROADCASTER 
      : AgoraTokenRole.AUDIENCE;

    return this.agoraService.generateToken({
      channelName: dto.channelName,
      uid: numericUid,
      role: tokenRole,
      expireTimeInSeconds: dto.expireTime,
    });
  }

  /**
   * Hash string to numeric UID
   */
  private hashStringToUid(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash) % 100000000;
  }
}
