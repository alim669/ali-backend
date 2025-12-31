import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger, UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

interface AuthenticatedSocket extends Socket {
  user?: {
    id: string;
    email: string;
    username: string;
    displayName: string;
    role: string;
  };
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/',
  transports: ['websocket', 'polling'],
})
export class AppGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AppGateway.name);

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('🔌 WebSocket Gateway initialized');
    
    // Subscribe to Redis channels for cross-instance messaging
    this.subscribeToRedisChannels();
  }

  // ================================
  // CONNECTION HANDLING
  // ================================

  async handleConnection(client: AuthenticatedSocket) {
    try {
      // Extract token from handshake
      const token = this.extractToken(client);
      
      if (!token) {
        this.logger.warn(`Client ${client.id} connected without token`);
        client.disconnect();
        return;
      }

      // Verify JWT
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      if (payload.type !== 'access') {
        client.disconnect();
        return;
      }

      // Get user from database
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          role: true,
          status: true,
        },
      });

      if (!user || user.status === 'BANNED') {
        client.disconnect();
        return;
      }

      // Attach user to socket
      client.user = user;

      // Store connection in Redis
      await this.redis.setUserOnline(user.id, client.id, {
        username: user.username,
        displayName: user.displayName,
      });

      // Join user's personal room for direct messages
      client.join(`user:${user.id}`);

      this.logger.log(`👤 User ${user.username} connected (${client.id})`);

      // Emit connection success
      client.emit('connected', {
        userId: user.id,
        username: user.username,
      });

    } catch (error) {
      this.logger.error(`Connection error: ${error.message}`);
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    if (client.user) {
      // Get all rooms the user was in
      const rooms = Array.from(client.rooms).filter(
        (room) => room.startsWith('room:') && !room.includes(':'),
      );

      // Remove from all room online lists
      for (const room of rooms) {
        const roomId = room.replace('room:', '');
        await this.redis.removeUserFromRoom(roomId, client.user.id);
        
        // Notify room members
        this.server.to(room).emit('user_left', {
          userId: client.user.id,
          username: client.user.username,
        });
      }

      // Set user offline
      await this.redis.setUserOffline(client.user.id);

      this.logger.log(`👤 User ${client.user.username} disconnected`);
    }
  }

  // ================================
  // ROOM EVENTS
  // ================================

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) {
      return { error: 'Not authenticated' };
    }

    const { roomId } = data;

    // Verify user is member of the room
    const membership = await this.prisma.roomMember.findUnique({
      where: {
        roomId_userId: { roomId, userId: client.user.id },
      },
    });

    if (!membership || membership.leftAt || membership.isBanned) {
      return { error: 'Not a member of this room' };
    }

    // Join socket room
    client.join(`room:${roomId}`);

    // Add to Redis online list
    await this.redis.addUserToRoom(roomId, client.user.id);

    // Notify room members
    this.server.to(`room:${roomId}`).emit('user_joined', {
      userId: client.user.id,
      username: client.user.username,
      displayName: client.user.displayName,
    });

    // Get online members
    const onlineUsers = await this.redis.getRoomOnlineUsers(roomId);

    this.logger.log(`User ${client.user.username} joined room ${roomId}`);

    return {
      success: true,
      roomId,
      onlineUsers,
    };
  }

  @SubscribeMessage('leave_room')
  async handleLeaveRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) {
      return { error: 'Not authenticated' };
    }

    const { roomId } = data;

    // Leave socket room
    client.leave(`room:${roomId}`);

    // Remove from Redis
    await this.redis.removeUserFromRoom(roomId, client.user.id);

    // Notify room
    this.server.to(`room:${roomId}`).emit('user_left', {
      userId: client.user.id,
      username: client.user.username,
    });

    this.logger.log(`User ${client.user.username} left room ${roomId}`);

    return { success: true };
  }

  // ================================
  // MESSAGE EVENTS
  // ================================

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; content: string; type?: string; metadata?: any },
  ) {
    if (!client.user) {
      return { error: 'Not authenticated' };
    }

    const { roomId, content, type = 'TEXT', metadata } = data;

    // Verify membership and check if muted
    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: client.user.id } },
    });

    if (!membership || membership.leftAt || membership.isBanned) {
      return { error: 'Not a member of this room' };
    }

    if (membership.isMuted) {
      if (membership.mutedUntil && membership.mutedUntil > new Date()) {
        return { error: 'You are muted in this room' };
      }
    }

    // Create message
    const message = await this.prisma.message.create({
      data: {
        roomId,
        senderId: client.user.id,
        type: type as any,
        content,
        metadata: metadata || {},
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
      },
    });

    // Broadcast to room
    this.server.to(`room:${roomId}`).emit('new_message', message);

    // Remove typing indicator
    await this.redis.removeTyping(roomId, client.user.id);

    return { success: true, messageId: message.id };
  }

  @SubscribeMessage('typing_start')
  async handleTypingStart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) return;

    await this.redis.setTyping(data.roomId, client.user.id);

    // Broadcast to room (except sender)
    client.to(`room:${data.roomId}`).emit('user_typing', {
      userId: client.user.id,
      username: client.user.username,
    });
  }

  @SubscribeMessage('typing_stop')
  async handleTypingStop(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) return;

    await this.redis.removeTyping(data.roomId, client.user.id);

    client.to(`room:${data.roomId}`).emit('user_stopped_typing', {
      userId: client.user.id,
    });
  }

  // ================================
  // GIFT EVENTS
  // ================================

  @SubscribeMessage('gift_animation_complete')
  async handleGiftAnimationComplete(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; giftSendId: string },
  ) {
    // This can be used to track when gift animations finish on clients
    return { success: true };
  }

  // ================================
  // PRESENCE EVENTS
  // ================================

  @SubscribeMessage('heartbeat')
  async handleHeartbeat(@ConnectedSocket() client: AuthenticatedSocket) {
    if (!client.user) return;

    // Refresh presence TTL
    await this.redis.setUserOnline(client.user.id, client.id);

    return { timestamp: Date.now() };
  }

  @SubscribeMessage('get_online_users')
  async handleGetOnlineUsers(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    const onlineUsers = await this.redis.getRoomOnlineUsers(data.roomId);
    return { onlineUsers };
  }

  // ================================
  // HELPER METHODS
  // ================================

  private extractToken(client: Socket): string | null {
    // Try Authorization header
    const authHeader = client.handshake.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Try query parameter
    const token = client.handshake.query.token;
    if (typeof token === 'string') {
      return token;
    }

    // Try auth object
    if (client.handshake.auth?.token) {
      return client.handshake.auth.token;
    }

    return null;
  }

  private async subscribeToRedisChannels() {
    // Subscribe to gift events from other instances
    await this.redis.subscribe('gifts:sent', (message) => {
      const data = JSON.parse(message);
      if (data.data.roomId) {
        this.server.to(`room:${data.data.roomId}`).emit('gift_received', data.data);
      }
      // Also notify receiver directly
      this.server.to(`user:${data.data.receiverId}`).emit('gift_received', data.data);
    });

    // Subscribe to message events from REST API
    // This is handled per-room subscription

    this.logger.log('📡 Subscribed to Redis channels');
  }

  // ================================
  // PUBLIC METHODS (for use in services)
  // ================================

  async broadcastToRoom(roomId: string, event: string, data: any) {
    this.server.to(`room:${roomId}`).emit(event, data);
  }

  async sendToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  async notifyGiftSent(roomId: string | null, senderId: string, receiverId: string, giftData: any) {
    if (roomId) {
      this.server.to(`room:${roomId}`).emit('gift_sent', giftData);
    }
    this.server.to(`user:${receiverId}`).emit('gift_received', giftData);
  }
}
