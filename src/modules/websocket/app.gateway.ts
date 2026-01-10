import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { Logger, UseGuards } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../common/prisma/prisma.service";
import { RedisService } from "../../common/redis/redis.service";

// ================================
// TYPES & INTERFACES
// ================================

interface AuthenticatedSocket extends Socket {
  user?: {
    id: string;
    email: string;
    username: string;
    displayName: string;
    role: string;
    avatar?: string;
  };
  connectedAt?: Date;
  lastHeartbeat?: Date;
  joinedRooms?: Set<string>;
}

// User presence states
enum UserPresenceState {
  ONLINE = "ONLINE",
  OFFLINE = "OFFLINE",
  TYPING = "TYPING",
  IN_ROOM = "IN_ROOM",
  IDLE = "IDLE",
}

// Message delivery states
enum MessageState {
  SENDING = "sending",
  SENT = "sent",
  DELIVERED = "delivered",
  READ = "read",
}

// Unified room event types for consistent event system
type RoomEventType =
  | "message"
  | "gift"
  | "user_joined"
  | "user_left"
  | "system";

interface RoomEvent {
  type: RoomEventType;
  roomId: string;
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  serverTs: number;
  data: Record<string, any>;
}

@WebSocketGateway({
  cors: {
    origin: "*",
    credentials: true,
  },
  namespace: "/",
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
})
export class AppGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AppGateway.name);

  // Track all active connections per user (userId -> Set of socketIds)
  private userConnections = new Map<string, Set<string>>();
  // Track socket to user mapping (socketId -> userId)
  private socketToUser = new Map<string, string>();
  // Room presence: roomId -> Set of userIds (in-memory for fast lookups)
  private roomPresence = new Map<string, Set<string>>();
  // Track reconnection state to prevent duplicate join notifications
  private recentJoins = new Map<string, number>(); // `${roomId}:${userId}` -> timestamp
  // Heartbeat interval for stale connection cleanup
  private heartbeatCheckInterval: NodeJS.Timeout | null = null;
  // Rate limiting for events (userId -> { event: lastTime })
  private eventRateLimits = new Map<string, Map<string, number>>();
  // Stale connection timeout (2 minutes)
  private readonly STALE_CONNECTION_TIMEOUT = 120000;
  // Duplicate join prevention window (5 seconds)
  private readonly DUPLICATE_JOIN_WINDOW = 5000;

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  afterInit(server: Server) {
    this.logger.log("🔌 WebSocket Gateway initialized");

    // Subscribe to Redis channels for cross-instance messaging
    this.subscribeToRedisChannels();

    // Start heartbeat check interval (every 30 seconds)
    this.heartbeatCheckInterval = setInterval(() => {
      this.cleanupStaleConnections();
    }, 30000);
  }

  // ================================
  // STALE CONNECTION CLEANUP
  // ================================

  private async cleanupStaleConnections() {
    const now = Date.now();
    const sockets = await this.server.fetchSockets();

    for (const socket of sockets) {
      const authSocket = socket as unknown as AuthenticatedSocket;
      if (authSocket.lastHeartbeat) {
        const timeSinceHeartbeat = now - authSocket.lastHeartbeat.getTime();
        if (timeSinceHeartbeat > this.STALE_CONNECTION_TIMEOUT) {
          this.logger.warn(
            `🔌 Cleaning up stale connection: ${socket.id} (${authSocket.user?.username || "unknown"})`,
          );
          socket.disconnect(true);
        }
      }
    }

    // Cleanup old recent join entries
    const joinCutoff = now - this.DUPLICATE_JOIN_WINDOW;
    for (const [key, timestamp] of this.recentJoins.entries()) {
      if (timestamp < joinCutoff) {
        this.recentJoins.delete(key);
      }
    }
  }

  // ================================
  // UNIFIED ROOM EVENT BROADCASTING
  // ================================

  /**
   * Broadcast a unified room_event to all users in a room
   * This ensures consistent event format across all event types
   */
  private broadcastRoomEvent(roomId: string, event: RoomEvent) {
    // Emit unified room_event (primary channel)
    this.server.to(`room:${roomId}`).emit("room_event", event);

    // Also emit legacy event names for backwards compatibility
    switch (event.type) {
      case "message":
        this.server.to(`room:${roomId}`).emit("newMessage", event.data);
        this.server.to(`room:${roomId}`).emit("new_message", event.data);
        break;
      case "gift":
        this.server.to(`room:${roomId}`).emit("giftSent", event.data);
        this.server.to(`room:${roomId}`).emit("gift_sent", event.data);
        break;
      case "user_joined":
        this.server.to(`room:${roomId}`).emit("userJoined", event.data);
        this.server.to(`room:${roomId}`).emit("user_joined", event.data);
        break;
      case "user_left":
        this.server.to(`room:${roomId}`).emit("userLeft", event.data);
        this.server.to(`room:${roomId}`).emit("user_left", event.data);
        break;
      case "system":
        this.server.to(`room:${roomId}`).emit("system_message", event.data);
        break;
    }

    this.logger.debug(
      `📡 [BROADCAST] room_event(${event.type}) -> room:${roomId} (id: ${event.id})`,
    );
  }

  /**
   * Check if this is a duplicate join within the prevention window
   */
  private isDuplicateJoin(roomId: string, userId: string): boolean {
    const key = `${roomId}:${userId}`;
    const lastJoin = this.recentJoins.get(key);
    const now = Date.now();

    if (lastJoin && now - lastJoin < this.DUPLICATE_JOIN_WINDOW) {
      return true;
    }

    this.recentJoins.set(key, now);
    return false;
  }

  /**
   * Get current online users in a room from in-memory cache
   */
  private getRoomOnlineCount(roomId: string): number {
    return this.roomPresence.get(roomId)?.size || 0;
  }

  /**
   * Add user to room presence
   */
  private addToRoomPresence(roomId: string, userId: string) {
    if (!this.roomPresence.has(roomId)) {
      this.roomPresence.set(roomId, new Set());
    }
    this.roomPresence.get(roomId)!.add(userId);
  }

  /**
   * Remove user from room presence
   */
  private removeFromRoomPresence(roomId: string, userId: string) {
    const roomUsers = this.roomPresence.get(roomId);
    if (roomUsers) {
      roomUsers.delete(userId);
      if (roomUsers.size === 0) {
        this.roomPresence.delete(roomId);
      }
    }
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ================================
  // CONNECTION HANDLING (CRITICAL)
  // ================================

  async handleConnection(client: AuthenticatedSocket) {
    const connectionTime = new Date();

    try {
      // Extract token from handshake
      const token = this.extractToken(client);

      if (!token) {
        this.logger.warn(
          `❌ [CONNECT] Client ${client.id} - No token provided`,
        );
        client.emit("error", {
          code: "AUTH_REQUIRED",
          message: "Token required",
        });
        client.disconnect();
        return;
      }

      // Verify JWT
      let payload: any;
      try {
        payload = this.jwtService.verify(token, {
          secret: this.configService.get<string>("JWT_SECRET"),
        });
      } catch (jwtError) {
        this.logger.warn(
          `❌ [CONNECT] Client ${client.id} - Invalid token: ${jwtError.message}`,
        );
        client.emit("error", {
          code: "INVALID_TOKEN",
          message: "Token expired or invalid",
        });
        client.disconnect();
        return;
      }

      if (payload.type !== "access") {
        this.logger.warn(`❌ [CONNECT] Client ${client.id} - Wrong token type`);
        client.emit("error", {
          code: "INVALID_TOKEN_TYPE",
          message: "Access token required",
        });
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
          avatar: true,
        },
      });

      if (!user) {
        this.logger.warn(
          `❌ [CONNECT] Client ${client.id} - User not found: ${payload.sub}`,
        );
        client.emit("error", {
          code: "USER_NOT_FOUND",
          message: "User not found",
        });
        client.disconnect();
        return;
      }

      if (user.status === "BANNED") {
        this.logger.warn(
          `❌ [CONNECT] Client ${client.id} - User banned: ${user.username}`,
        );
        client.emit("error", {
          code: "USER_BANNED",
          message: "Account is banned",
        });
        client.disconnect();
        return;
      }

      // Attach user and metadata to socket
      client.user = {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        avatar: user.avatar || undefined,
      };
      client.connectedAt = connectionTime;
      client.lastHeartbeat = connectionTime;
      client.joinedRooms = new Set();

      // Track connection (support multiple connections per user)
      this.socketToUser.set(client.id, user.id);
      if (!this.userConnections.has(user.id)) {
        this.userConnections.set(user.id, new Set());
      }
      this.userConnections.get(user.id)!.add(client.id);

      // Store connection in Redis with extended metadata
      await this.redis.setUserOnline(user.id, client.id, {
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        connectedAt: connectionTime.toISOString(),
        connectionCount: this.userConnections.get(user.id)!.size,
      });

      // Update user's last seen in database
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: connectionTime },
      });

      // Join user's personal room for direct messages
      client.join(`user:${user.id}`);

      this.logger.log(
        `✅ [CONNECT] User ${user.username} connected (socket: ${client.id}, total connections: ${this.userConnections.get(user.id)!.size})`,
      );

      // Emit connection success
      client.emit("connected", {
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        connectedAt: connectionTime.toISOString(),
      });

      // Broadcast user online to friends (if needed)
      await this.broadcastPresenceChange(user.id, UserPresenceState.ONLINE);

      // Deliver pending private messages
      await this.deliverPendingPrivateMessages(user.id);

      // Get unread private message count
      const unreadCount = await this.getUnreadPrivateMessageCount(user.id);
      if (unreadCount > 0) {
        client.emit("unread_messages_count", { count: unreadCount });
      }
    } catch (error) {
      this.logger.error(
        `❌ [CONNECT] Connection error for ${client.id}: ${error.message}`,
        error.stack,
      );
      client.emit("error", {
        code: "CONNECTION_ERROR",
        message: "Connection failed",
      });
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    const disconnectTime = new Date();

    if (client.user) {
      const userId = client.user.id;
      const username = client.user.username;

      this.logger.log(
        `🔌 [DISCONNECT] User ${username} disconnecting (socket: ${client.id})`,
      );

      // Remove socket from tracking
      this.socketToUser.delete(client.id);
      const userSockets = this.userConnections.get(userId);

      if (userSockets) {
        userSockets.delete(client.id);

        // Get all rooms user was in from this socket
        const joinedRooms = client.joinedRooms || new Set();

        // Leave all rooms from this socket
        for (const roomId of joinedRooms) {
          await this.forceLeaveRoom(client, roomId, "disconnect");
        }

        // Only mark offline if this was the last connection
        if (userSockets.size === 0) {
          this.userConnections.delete(userId);

          // Set user offline in Redis
          await this.redis.setUserOffline(userId);

          // Broadcast offline status
          await this.broadcastPresenceChange(userId, UserPresenceState.OFFLINE);

          // Clean up rate limits for this user
          this.cleanupRateLimits(userId);

          this.logger.log(
            `👤 [OFFLINE] User ${username} is now offline (all connections closed)`,
          );
        } else {
          // Update connection count in Redis
          await this.redis.setUserOnline(userId, Array.from(userSockets)[0], {
            username,
            connectionCount: userSockets.size,
          });

          this.logger.log(
            `🔌 [DISCONNECT] User ${username} still online (${userSockets.size} connections remaining)`,
          );
        }
      }
    } else {
      // Unauthenticated disconnect
      this.logger.debug(
        `🔌 [DISCONNECT] Unauthenticated client disconnected: ${client.id}`,
      );
    }
  }

  // ================================
  // PRESENCE BROADCASTING
  // ================================

  private async broadcastPresenceChange(
    userId: string,
    state: UserPresenceState,
  ) {
    try {
      // Get user's followers/friends to notify
      const follows = await this.prisma.follow.findMany({
        where: { followingId: userId },
        select: { followerId: true },
      });

      const presenceData = {
        userId,
        state,
        timestamp: new Date().toISOString(),
      };

      // Notify each follower
      for (const follow of follows) {
        this.server
          .to(`user:${follow.followerId}`)
          .emit("presence_update", presenceData);
      }

      // Also publish to Redis for cross-instance sync
      await this.redis.publish("presence:updates", presenceData);
    } catch (error) {
      this.logger.error(
        `Failed to broadcast presence change: ${error.message}`,
      );
    }
  }

  // ================================
  // FORCE LEAVE ROOM (for disconnect cleanup)
  // ================================

  private async forceLeaveRoom(
    client: AuthenticatedSocket,
    roomId: string,
    reason: string,
  ) {
    if (!client.user) return;

    try {
      // Leave socket room
      client.leave(`room:${roomId}`);

      // Remove from Redis
      await this.redis.removeUserFromRoom(roomId, client.user.id);

      // Remove from tracking
      client.joinedRooms?.delete(roomId);

      // Remove from presence
      this.removeFromRoomPresence(roomId, client.user.id);

      const onlineCount = this.getRoomOnlineCount(roomId);

      const leaveEventData = {
        userId: client.user.id,
        username: client.user.username,
        displayName: client.user.displayName,
        reason,
        timestamp: new Date().toISOString(),
        onlineCount,
      };

      // Broadcast using unified event system
      this.broadcastRoomEvent(roomId, {
        type: "user_left",
        roomId,
        id: this.generateEventId(),
        senderId: client.user.id,
        senderName: client.user.displayName,
        senderAvatar: client.user.avatar,
        serverTs: Date.now(),
        data: leaveEventData,
      });

      this.logger.log(
        `🚪 [LEAVE] User ${client.user.username} left room ${roomId} (reason: ${reason})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to force leave room ${roomId}: ${error.message}`,
      );
    }
  }

  // ================================
  // ROOM EVENTS (IMPROVED)
  // ================================

  // Support both snake_case and camelCase event names for backwards compatibility
  @SubscribeMessage("joinRoom")
  async handleJoinRoomCamelCase(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    return this.handleJoinRoom(client, data);
  }

  @SubscribeMessage("join_room")
  async handleJoinRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) {
      return {
        success: false,
        error: "NOT_AUTHENTICATED",
        message: "غير مصرح",
      };
    }

    const { roomId } = data;

    if (!roomId) {
      return {
        success: false,
        error: "INVALID_ROOM_ID",
        message: "معرف الغرفة مطلوب",
      };
    }

    try {
      // Check if room exists
      const room = await this.prisma.room.findUnique({
        where: { id: roomId },
        select: { id: true, name: true, status: true, maxMembers: true },
      });

      if (!room) {
        this.logger.warn(
          `🚪 [JOIN] User ${client.user.username} tried to join non-existent room: ${roomId}`,
        );
        return {
          success: false,
          error: "ROOM_NOT_FOUND",
          message: "الغرفة غير موجودة",
        };
      }

      if (room.status !== "ACTIVE") {
        return {
          success: false,
          error: "ROOM_INACTIVE",
          message: "الغرفة غير نشطة",
        };
      }

      // Verify user is member of the room
      const membership = await this.prisma.roomMember.findUnique({
        where: { roomId_userId: { roomId, userId: client.user.id } },
      });

      if (!membership) {
        return {
          success: false,
          error: "NOT_A_MEMBER",
          message: "أنت لست عضواً في هذه الغرفة",
        };
      }

      if (membership.isBanned) {
        const bannedMessage = membership.bannedUntil
          ? `أنت محظور حتى ${membership.bannedUntil.toISOString()}`
          : "أنت محظور من هذه الغرفة";
        return { success: false, error: "USER_BANNED", message: bannedMessage };
      }

      if (membership.leftAt) {
        // User left before, rejoin
        await this.prisma.roomMember.update({
          where: { id: membership.id },
          data: { leftAt: null, joinedAt: new Date() },
        });
      }

      // Check if already in this room (prevent duplicate notifications on reconnect)
      const isReconnect = client.joinedRooms?.has(roomId);
      const isDuplicate = this.isDuplicateJoin(roomId, client.user.id);

      if (isReconnect) {
        this.logger.debug(
          `🚪 [JOIN] User ${client.user.username} already in room ${roomId} (reconnect)`,
        );
        const onlineUsers = await this.redis.getRoomOnlineUsers(roomId);
        return { success: true, roomId, onlineUsers, alreadyJoined: true };
      }

      // Join socket room
      client.join(`room:${roomId}`);

      // Track in client's joined rooms
      if (!client.joinedRooms) {
        client.joinedRooms = new Set();
      }
      client.joinedRooms.add(roomId);

      // Add to presence tracking
      this.addToRoomPresence(roomId, client.user.id);

      // Add to Redis online list
      await this.redis.addUserToRoom(roomId, client.user.id);

      // Get online members (including current user)
      const onlineUsers = await this.redis.getRoomOnlineUsers(roomId);
      const onlineCount = this.getRoomOnlineCount(roomId);

      // Only broadcast user_joined if this is NOT a duplicate within the window
      if (!isDuplicate) {
        const joinEventData = {
          userId: client.user.id,
          username: client.user.username,
          displayName: client.user.displayName,
          avatar: client.user.avatar,
          role: membership.role,
          timestamp: new Date().toISOString(),
          onlineCount: onlineUsers.length,
        };

        // Broadcast using unified event system
        this.broadcastRoomEvent(roomId, {
          type: "user_joined",
          roomId,
          id: this.generateEventId(),
          senderId: client.user.id,
          senderName: client.user.displayName,
          senderAvatar: client.user.avatar,
          serverTs: Date.now(),
          data: joinEventData,
        });

        this.logger.log(
          `✅ [JOIN] User ${client.user.username} joined room ${roomId} (online: ${onlineUsers.length})`,
        );
      } else {
        this.logger.debug(
          `🚪 [JOIN] Duplicate join suppressed for ${client.user.username} in room ${roomId}`,
        );
      }

      // Send current online list to the joining user
      client.emit("onlineUsers", onlineUsers);

      return {
        success: true,
        roomId,
        roomName: room.name,
        onlineUsers,
        onlineCount: onlineUsers.length,
        userRole: membership.role,
      };
    } catch (error) {
      this.logger.error(
        `❌ [JOIN] Error joining room ${roomId}: ${error.message}`,
      );
      return {
        success: false,
        error: "JOIN_ERROR",
        message: "حدث خطأ أثناء الانضمام",
      };
    }
  }

  // Support both snake_case and camelCase for leave_room
  @SubscribeMessage("leaveRoom")
  async handleLeaveRoomCamelCase(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    return this.handleLeaveRoom(client, data);
  }

  @SubscribeMessage("leave_room")
  async handleLeaveRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { roomId } = data;

    try {
      // Leave socket room
      client.leave(`room:${roomId}`);

      // Remove from tracking
      client.joinedRooms?.delete(roomId);

      // Remove from presence
      this.removeFromRoomPresence(roomId, client.user.id);

      // Remove from Redis
      await this.redis.removeUserFromRoom(roomId, client.user.id);

      // Get updated online count
      const onlineCount = this.getRoomOnlineCount(roomId);

      const leaveEventData = {
        userId: client.user.id,
        username: client.user.username,
        displayName: client.user.displayName,
        reason: "manual",
        timestamp: new Date().toISOString(),
        onlineCount,
      };

      // Broadcast using unified event system
      this.broadcastRoomEvent(roomId, {
        type: "user_left",
        roomId,
        id: this.generateEventId(),
        senderId: client.user.id,
        senderName: client.user.displayName,
        senderAvatar: client.user.avatar,
        serverTs: Date.now(),
        data: leaveEventData,
      });

      this.logger.log(
        `✅ [LEAVE] User ${client.user.username} left room ${roomId}`,
      );

      return { success: true, roomId };
    } catch (error) {
      this.logger.error(
        `❌ [LEAVE] Error leaving room ${roomId}: ${error.message}`,
      );
      return { success: false, error: "LEAVE_ERROR" };
    }
  }

  // ================================
  // MESSAGE EVENTS (IMPROVED)
  // ================================

  // Support both snake_case and camelCase for send_message
  @SubscribeMessage("sendMessage")
  async handleSendMessageCamelCase(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      roomId: string;
      content: string;
      type?: string;
      metadata?: any;
      tempId?: string;
    },
  ) {
    return this.handleSendMessage(client, data);
  }

  @SubscribeMessage("send_message")
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      roomId: string;
      content: string;
      type?: string;
      metadata?: any;
      tempId?: string;
    },
  ) {
    if (!client.user) {
      return {
        success: false,
        error: "NOT_AUTHENTICATED",
        state: MessageState.SENDING,
      };
    }

    const { roomId, content, type = "TEXT", metadata, tempId } = data;

    // Emit sending state to sender immediately
    if (tempId) {
      client.emit("message_state", { tempId, state: MessageState.SENDING });
    }

    try {
      // Verify membership and check if muted
      const membership = await this.prisma.roomMember.findUnique({
        where: { roomId_userId: { roomId, userId: client.user.id } },
      });

      if (!membership || membership.leftAt || membership.isBanned) {
        return {
          success: false,
          error: "NOT_A_MEMBER",
          message: "لست عضواً في هذه الغرفة",
        };
      }

      if (membership.isMuted) {
        if (membership.mutedUntil && membership.mutedUntil > new Date()) {
          const remainingTime = Math.ceil(
            (membership.mutedUntil.getTime() - Date.now()) / 60000,
          );
          return {
            success: false,
            error: "USER_MUTED",
            message: `أنت كتوم لمدة ${remainingTime} دقيقة`,
          };
        }
        // Unmute if time expired
        await this.prisma.roomMember.update({
          where: { id: membership.id },
          data: { isMuted: false, mutedUntil: null },
        });
      }

      // Create message in database (IMPORTANT: store before sending)
      const message = await this.prisma.message.create({
        data: {
          roomId,
          senderId: client.user.id,
          type: type as any,
          content,
          metadata: { ...(metadata || {}), tempId },
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

      // Emit sent state to sender
      if (tempId) {
        client.emit("message_state", {
          tempId,
          messageId: message.id,
          state: MessageState.SENT,
          createdAt: message.createdAt.toISOString(),
        });
      }

      // Prepare message data for broadcast
      const messageData = {
        id: message.id,
        roomId: message.roomId,
        senderId: message.senderId,
        senderName: message.sender.displayName,
        senderAvatar: message.sender.avatar,
        type: message.type,
        content: message.content,
        metadata: message.metadata,
        createdAt: message.createdAt.toISOString(),
        tempId, // Include for client reconciliation
      };

      // Broadcast using unified event system
      this.broadcastRoomEvent(roomId, {
        type: "message",
        roomId,
        id: message.id,
        senderId: client.user.id,
        senderName: message.sender.displayName,
        senderAvatar: message.sender.avatar ?? undefined,
        serverTs: message.createdAt.getTime(),
        data: messageData,
      });

      // Remove typing indicator
      await this.redis.removeTyping(roomId, client.user.id);

      this.logger.debug(
        `💬 [MESSAGE] ${client.user.username} -> room ${roomId}: ${content.substring(0, 50)}...`,
      );

      return {
        success: true,
        messageId: message.id,
        tempId,
        state: MessageState.SENT,
        createdAt: message.createdAt.toISOString(),
      };
    } catch (error) {
      this.logger.error(`❌ [MESSAGE] Error sending message: ${error.message}`);
      if (tempId) {
        client.emit("message_state", {
          tempId,
          state: "failed",
          error: error.message,
        });
      }
      return {
        success: false,
        error: "SEND_ERROR",
        message: "فشل إرسال الرسالة",
      };
    }
  }

  // ================================
  // MESSAGE ACKNOWLEDGMENTS (WhatsApp-style)
  // ================================

  @SubscribeMessage("message_delivered")
  async handleMessageDelivered(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string; roomId: string },
  ) {
    if (!client.user) return;

    const { messageId, roomId } = data;

    // Notify sender that message was delivered
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { senderId: true },
    });

    if (message && message.senderId !== client.user.id) {
      this.server.to(`user:${message.senderId}`).emit("message_state", {
        messageId,
        roomId,
        state: MessageState.DELIVERED,
        deliveredTo: client.user.id,
        deliveredAt: new Date().toISOString(),
      });
    }
  }

  @SubscribeMessage("message_read")
  async handleMessageRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string; roomId: string },
  ) {
    if (!client.user) return;

    const { messageId, roomId } = data;

    // Notify sender that message was read
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { senderId: true },
    });

    if (message && message.senderId !== client.user.id) {
      this.server.to(`user:${message.senderId}`).emit("message_state", {
        messageId,
        roomId,
        state: MessageState.READ,
        readBy: client.user.id,
        readAt: new Date().toISOString(),
      });
    }
  }

  @SubscribeMessage("messages_read_all")
  async handleMessagesReadAll(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; lastMessageId?: string },
  ) {
    if (!client.user) return;

    const { roomId, lastMessageId } = data;

    // Broadcast to room that this user has read all messages
    this.server.to(`room:${roomId}`).emit("user_read_messages", {
      userId: client.user.id,
      roomId,
      lastMessageId,
      readAt: new Date().toISOString(),
    });
  }

  @SubscribeMessage("typing_start")
  async handleTypingStart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) return;

    await this.redis.setTyping(data.roomId, client.user.id);

    // Broadcast to room (except sender) - with debounce via Redis TTL
    client.to(`room:${data.roomId}`).emit("user_typing", {
      userId: client.user.id,
      username: client.user.username,
      displayName: client.user.displayName,
    });
  }

  @SubscribeMessage("typing_stop")
  async handleTypingStop(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) return;

    await this.redis.removeTyping(data.roomId, client.user.id);

    client.to(`room:${data.roomId}`).emit("user_stopped_typing", {
      userId: client.user.id,
    });
  }

  // ================================
  // PRIVATE MESSAGING (Enhanced with DB storage & VIP check)
  // ================================

  /**
   * Check if a user is VIP (has active VIP subscription)
   */
  private async isUserVIP(userId: string): Promise<boolean> {
    try {
      const users = await this.prisma.$queryRaw<any[]>`
        SELECT role, "isVIP", "vipExpiresAt" FROM "User"
        WHERE id = ${userId}
        LIMIT 1
      `;

      if (!users || users.length === 0) return false;

      const user = users[0];

      // Admins always have VIP privileges
      if (["ADMIN", "SUPER_ADMIN", "MODERATOR"].includes(user.role)) {
        return true;
      }

      // Check VIP status and expiry
      if (user.isVIP) {
        if (!user.vipExpiresAt || new Date(user.vipExpiresAt) > new Date()) {
          return true;
        }
      }

      return false;
    } catch (error) {
      // If isVIP column doesn't exist yet, fall back to role check only
      this.logger.debug(`VIP check fallback: ${error.message}`);
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      return user ? ["ADMIN", "SUPER_ADMIN", "MODERATOR"].includes(user.role) : false;
    }
  }

  /**
   * Check if user A has blocked user B or vice versa
   */
  private async isBlocked(
    userAId: string,
    userBId: string,
  ): Promise<{ blocked: boolean; direction?: "blocker" | "blocked" }> {
    // Check raw SQL for UserBlock table (it may not be generated yet)
    try {
      const block = await this.prisma.$queryRaw<any[]>`
        SELECT id, "blockerId", "blockedId" FROM "UserBlock"
        WHERE ("blockerId" = ${userAId} AND "blockedId" = ${userBId})
           OR ("blockerId" = ${userBId} AND "blockedId" = ${userAId})
        LIMIT 1
      `;

      if (block && block.length > 0) {
        const direction = block[0].blockerId === userAId ? "blocker" : "blocked";
        return { blocked: true, direction };
      }
    } catch (error) {
      // Table may not exist yet, ignore
      this.logger.debug(`Block check skipped: ${error.message}`);
    }

    return { blocked: false };
  }

  /**
   * Check if two users are friends
   */
  private async areFriends(userAId: string, userBId: string): Promise<boolean> {
    try {
      const friendship = await this.prisma.$queryRaw<any[]>`
        SELECT id FROM friendships
        WHERE (user1_id = ${userAId} AND user2_id = ${userBId})
           OR (user1_id = ${userBId} AND user2_id = ${userAId})
        LIMIT 1
      `;
      return friendship && friendship.length > 0;
    } catch (error) {
      return false;
    }
  }

  @SubscribeMessage("send_private_message")
  async handleSendPrivateMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      receiverId: string;
      content: string;
      type?: string;
      metadata?: any;
      tempId?: string;
    },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { receiverId, content, type = "TEXT", metadata, tempId } = data;

    // Emit sending state immediately
    if (tempId) {
      client.emit("private_message_state", {
        tempId,
        state: MessageState.SENDING,
      });
    }

    try {
      // Validate content
      if (!content || content.trim().length === 0) {
        return {
          success: false,
          error: "EMPTY_MESSAGE",
          message: "لا يمكن إرسال رسالة فارغة",
        };
      }

      if (content.length > 5000) {
        return {
          success: false,
          error: "MESSAGE_TOO_LONG",
          message: "الرسالة طويلة جداً (الحد الأقصى 5000 حرف)",
        };
      }

      // Cannot send to self
      if (receiverId === client.user.id) {
        return {
          success: false,
          error: "CANNOT_MESSAGE_SELF",
          message: "لا يمكن إرسال رسالة لنفسك",
        };
      }

      // Check if receiver exists
      const receiver = await this.prisma.user.findUnique({
        where: { id: receiverId },
        select: { id: true, username: true, displayName: true, status: true, avatar: true },
      });

      if (!receiver) {
        return {
          success: false,
          error: "USER_NOT_FOUND",
          message: "المستخدم غير موجود",
        };
      }

      if (receiver.status === "BANNED") {
        return {
          success: false,
          error: "USER_BANNED",
          message: "هذا المستخدم محظور",
        };
      }

      // Check block status
      const blockStatus = await this.isBlocked(client.user.id, receiverId);
      if (blockStatus.blocked) {
        if (blockStatus.direction === "blocker") {
          return {
            success: false,
            error: "USER_BLOCKED",
            message: "لقد قمت بحظر هذا المستخدم",
          };
        } else {
          return {
            success: false,
            error: "BLOCKED_BY_USER",
            message: "لا يمكنك مراسلة هذا المستخدم",
          };
        }
      }

      // Check VIP or friendship for non-friends messaging
      const isSenderVIP = await this.isUserVIP(client.user.id);
      const areUsersFriends = await this.areFriends(client.user.id, receiverId);

      if (!isSenderVIP && !areUsersFriends) {
        return {
          success: false,
          error: "VIP_REQUIRED",
          message: "يجب أن تكون VIP أو صديقاً لإرسال رسائل خاصة",
        };
      }

      // Store message in database using raw SQL (until migration is applied)
      const messageId = `pm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = new Date();

      try {
        await this.prisma.$executeRaw`
          INSERT INTO "PrivateMessage" (id, "senderId", "receiverId", type, content, metadata, status, "createdAt", "updatedAt")
          VALUES (${messageId}, ${client.user.id}, ${receiverId}, ${type}::"PrivateMessageType", ${content.trim()}, ${JSON.stringify({ ...(metadata || {}), tempId })}::jsonb, 'SENT'::"PrivateMessageStatus", ${now}, ${now})
        `;
      } catch (dbError) {
        this.logger.error(`Failed to store private message: ${dbError.message}`);
        // Fallback: still send the message in realtime but warn about persistence
      }

      // Get sender info for message data
      const senderInfo = {
        id: client.user.id,
        username: client.user.username,
        displayName: client.user.displayName,
        avatar: client.user.avatar,
      };

      // Prepare message data for broadcast
      const messageData = {
        id: messageId,
        senderId: client.user.id,
        receiverId,
        type,
        content: content.trim(),
        metadata: { ...(metadata || {}), tempId },
        status: "SENT",
        tempId,
        createdAt: now.toISOString(),
        sender: senderInfo,
        receiver: {
          id: receiver.id,
          username: receiver.username,
          displayName: receiver.displayName,
          avatar: receiver.avatar,
        },
      };

      // Emit sent state to sender
      if (tempId) {
        client.emit("private_message_state", {
          tempId,
          messageId,
          state: MessageState.SENT,
          createdAt: now.toISOString(),
        });
      }

      // Check if receiver is online
      const isReceiverOnline = await this.redis.isUserOnline(receiverId);

      if (isReceiverOnline) {
        // Send to receiver in realtime
        this.server
          .to(`user:${receiverId}`)
          .emit("private_message", messageData);

        this.logger.debug(
          `📨 [PM] ${client.user.username} -> ${receiver.username}: delivered`,
        );
      } else {
        // Store in Redis pending queue for delivery when user comes online
        await this.addPendingPrivateMessage(receiverId, messageData);

        this.logger.debug(
          `📨 [PM] ${client.user.username} -> ${receiver.username}: queued (offline)`,
        );
      }

      // Publish to Redis for cross-instance sync
      await this.redis.publish("private:messages", messageData);

      return {
        success: true,
        messageId,
        tempId,
        state: isReceiverOnline ? MessageState.SENT : "pending",
        createdAt: now.toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `❌ [PM] Error sending private message: ${error.message}`,
        error.stack,
      );

      if (tempId) {
        client.emit("private_message_state", {
          tempId,
          state: "failed",
          error: error.message,
        });
      }

      return {
        success: false,
        error: "SEND_ERROR",
        message: "فشل إرسال الرسالة",
      };
    }
  }

  /**
   * Add message to pending queue for offline user
   */
  private async addPendingPrivateMessage(
    userId: string,
    message: any,
  ): Promise<void> {
    const key = `pending:pm:${userId}`;
    await this.redis.lpush(key, JSON.stringify(message));
    // Keep only last 100 pending messages
    await this.redis.ltrim(key, 0, 99);
  }

  /**
   * Get and deliver pending messages when user comes online
   */
  private async deliverPendingPrivateMessages(userId: string): Promise<void> {
    const key = `pending:pm:${userId}`;
    const messages = await this.redis.lrange(key, 0, -1);

    if (messages.length > 0) {
      for (const msgStr of messages) {
        try {
          const message = JSON.parse(msgStr);
          this.server.to(`user:${userId}`).emit("private_message", message);
        } catch (e) {
          this.logger.error(`Failed to deliver pending message: ${e.message}`);
        }
      }

      // Clear pending messages after delivery
      await this.redis.del(key);

      this.logger.log(
        `📬 [PM] Delivered ${messages.length} pending messages to user ${userId}`,
      );
    }
  }

  @SubscribeMessage("get_private_messages")
  async handleGetPrivateMessages(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      otherUserId: string;
      cursor?: string;
      limit?: number;
    },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { otherUserId, limit = 50 } = data;
    const actualLimit = Math.min(limit, 100);

    try {
      const messages = await this.prisma.$queryRaw<any[]>`
        SELECT pm.*, 
               u.id as "sender_id", u.username as "sender_username", 
               u."displayName" as "sender_displayName", u.avatar as "sender_avatar"
        FROM "PrivateMessage" pm
        JOIN "User" u ON u.id = pm."senderId"
        WHERE pm."isDeleted" = false
          AND (
            (pm."senderId" = ${client.user.id} AND pm."receiverId" = ${otherUserId})
            OR (pm."senderId" = ${otherUserId} AND pm."receiverId" = ${client.user.id})
          )
        ORDER BY pm."createdAt" DESC
        LIMIT ${actualLimit}
      `;

      const formattedMessages = messages.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        receiverId: m.receiverId,
        type: m.type,
        content: m.content,
        metadata: m.metadata,
        status: m.status,
        createdAt: m.createdAt,
        sender: {
          id: m.sender_id,
          username: m.sender_username,
          displayName: m.sender_displayName,
          avatar: m.sender_avatar,
        },
      }));

      return {
        success: true,
        messages: formattedMessages.reverse(),
        hasMore: messages.length === actualLimit,
      };
    } catch (error) {
      this.logger.error(`Failed to get private messages: ${error.message}`);
      return { success: false, error: "FETCH_ERROR", messages: [] };
    }
  }

  @SubscribeMessage("get_conversations")
  async handleGetConversations(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { limit?: number },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const limit = data?.limit || 50;

    try {
      // Get latest message from each conversation
      const conversations = await this.prisma.$queryRaw<any[]>`
        WITH latest_messages AS (
          SELECT DISTINCT ON (
            CASE
              WHEN "senderId" = ${client.user.id} THEN "receiverId"
              ELSE "senderId"
            END
          )
          *,
          CASE
            WHEN "senderId" = ${client.user.id} THEN "receiverId"
            ELSE "senderId"
          END as "otherUserId"
          FROM "PrivateMessage"
          WHERE ("senderId" = ${client.user.id} OR "receiverId" = ${client.user.id})
            AND "isDeleted" = false
          ORDER BY
            CASE
              WHEN "senderId" = ${client.user.id} THEN "receiverId"
              ELSE "senderId"
            END,
            "createdAt" DESC
        )
        SELECT * FROM latest_messages
        ORDER BY "createdAt" DESC
        LIMIT ${limit}
      `;

      // Get user details and unread counts
      const conversationsWithDetails = await Promise.all(
        conversations.map(async (conv) => {
          const otherUser = await this.prisma.user.findUnique({
            where: { id: conv.otherUserId },
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          });

          // Get unread count using raw SQL
          const unreadResult = await this.prisma.$queryRaw<any[]>`
            SELECT COUNT(*) as count FROM "PrivateMessage"
            WHERE "senderId" = ${conv.otherUserId}
              AND "receiverId" = ${client.user!.id}
              AND status != 'READ'
              AND "isDeleted" = false
          `;
          const unreadCount = parseInt(unreadResult[0]?.count || '0');

          const isOnline = await this.redis.isUserOnline(conv.otherUserId);

          return {
            otherUser,
            lastMessage: {
              id: conv.id,
              content: conv.content,
              type: conv.type,
              senderId: conv.senderId,
              createdAt: conv.createdAt,
            },
            unreadCount,
            isOnline,
          };
        }),
      );

      return {
        success: true,
        conversations: conversationsWithDetails,
      };
    } catch (error) {
      this.logger.error(`Failed to get conversations: ${error.message}`);
      return { success: false, error: "FETCH_ERROR", conversations: [] };
    }
  }

  @SubscribeMessage("private_message_delivered")
  async handlePrivateMessageDelivered(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string; senderId: string },
  ) {
    if (!client.user) return { success: false };

    const { messageId, senderId } = data;

    try {
      // Update message status in database using raw SQL
      await this.prisma.$executeRaw`
        UPDATE "PrivateMessage"
        SET status = 'DELIVERED'::"PrivateMessageStatus", "deliveredAt" = NOW(), "updatedAt" = NOW()
        WHERE id = ${messageId}
      `;

      // Notify original sender
      this.server.to(`user:${senderId}`).emit("private_message_state", {
        messageId,
        state: MessageState.DELIVERED,
        deliveredAt: new Date().toISOString(),
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to mark message as delivered: ${error.message}`);
      return { success: false };
    }
  }

  @SubscribeMessage("private_message_read")
  async handlePrivateMessageRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string; senderId: string },
  ) {
    if (!client.user) return { success: false };

    const { messageId, senderId } = data;

    try {
      // Update message status in database using raw SQL
      await this.prisma.$executeRaw`
        UPDATE "PrivateMessage"
        SET status = 'READ'::"PrivateMessageStatus", "readAt" = NOW(), "updatedAt" = NOW()
        WHERE id = ${messageId}
      `;

      // Notify original sender
      this.server.to(`user:${senderId}`).emit("private_message_state", {
        messageId,
        state: MessageState.READ,
        readAt: new Date().toISOString(),
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to mark message as read: ${error.message}`);
      return { success: false };
    }
  }

  @SubscribeMessage("mark_conversation_read")
  async handleMarkConversationRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { otherUserId: string },
  ) {
    if (!client.user) return { success: false };

    try {
      // Update all unread messages from this user using raw SQL
      const result = await this.prisma.$executeRaw`
        UPDATE "PrivateMessage"
        SET status = 'READ'::"PrivateMessageStatus", "readAt" = NOW(), "updatedAt" = NOW()
        WHERE "senderId" = ${data.otherUserId}
          AND "receiverId" = ${client.user.id}
          AND status != 'READ'
      `;

      // Notify the other user
      this.server.to(`user:${data.otherUserId}`).emit("conversation_read", {
        readBy: client.user.id,
        readAt: new Date().toISOString(),
        count: result,
      });

      return { success: true, count: result };
    } catch (error) {
      this.logger.error(`Failed to mark conversation as read: ${error.message}`);
      return { success: false };
    }
  }

  @SubscribeMessage("delete_private_message")
  async handleDeletePrivateMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string },
  ) {
    if (!client.user) return { success: false, error: "NOT_AUTHENTICATED" };

    try {
      // Get message using raw SQL
      const messages = await this.prisma.$queryRaw<any[]>`
        SELECT id, "senderId", "receiverId" FROM "PrivateMessage"
        WHERE id = ${data.messageId}
        LIMIT 1
      `;

      if (!messages || messages.length === 0) {
        return { success: false, error: "MESSAGE_NOT_FOUND" };
      }

      const message = messages[0];

      // Only sender can delete
      if (message.senderId !== client.user.id) {
        return { success: false, error: "NOT_AUTHORIZED" };
      }

      // Soft delete using raw SQL
      await this.prisma.$executeRaw`
        UPDATE "PrivateMessage"
        SET "isDeleted" = true, "deletedAt" = NOW(), "deletedBy" = ${client.user.id}, "updatedAt" = NOW()
        WHERE id = ${data.messageId}
      `;

      // Notify receiver
      this.server.to(`user:${message.receiverId}`).emit("private_message_deleted", {
        messageId: data.messageId,
        deletedBy: client.user.id,
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to delete private message: ${error.message}`);
      return { success: false, error: "DELETE_ERROR" };
    }
  }

  @SubscribeMessage("get_user_presence")
  async handleGetUserPresence(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { userId: string },
  ) {
    if (!client.user) return { success: false };

    const presence = await this.redis.getUserPresence(data.userId);
    const isOnline = await this.redis.isUserOnline(data.userId);

    return {
      success: true,
      userId: data.userId,
      isOnline,
      presence,
    };
  }

  // ================================
  // GIFT EVENTS
  // ================================

  @SubscribeMessage("gift_animation_complete")
  async handleGiftAnimationComplete(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; giftSendId: string },
  ) {
    // This can be used to track when gift animations finish on clients
    return { success: true };
  }

  // ================================
  // USER BLOCK SYSTEM
  // ================================

  @SubscribeMessage("block_user")
  async handleBlockUser(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { userId: string; reason?: string },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { userId, reason } = data;

    // Cannot block self
    if (userId === client.user.id) {
      return { success: false, error: "CANNOT_BLOCK_SELF" };
    }

    try {
      // Check if user exists
      const userToBlock = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true },
      });

      if (!userToBlock) {
        return { success: false, error: "USER_NOT_FOUND" };
      }

      // Check if already blocked
      const existingBlock = await this.prisma.$queryRaw<any[]>`
        SELECT id FROM "UserBlock"
        WHERE "blockerId" = ${client.user.id} AND "blockedId" = ${userId}
        LIMIT 1
      `;

      if (existingBlock && existingBlock.length > 0) {
        return { success: false, error: "ALREADY_BLOCKED" };
      }

      // Create block
      await this.prisma.$executeRaw`
        INSERT INTO "UserBlock" (id, "blockerId", "blockedId", reason, "createdAt")
        VALUES (gen_random_uuid(), ${client.user.id}, ${userId}, ${reason || null}, NOW())
      `;

      // Publish block event for cross-instance sync
      await this.redis.publish("user:blocked", {
        blockerId: client.user.id,
        blockedId: userId,
      });

      // Notify blocked user if online
      if (this.userConnections.has(userId)) {
        this.server.to(`user:${userId}`).emit("blocked_by_user", {
          blockerId: client.user.id,
          timestamp: new Date().toISOString(),
        });
      }

      this.logger.log(`🚫 User ${client.user.username} blocked ${userToBlock.username}`);

      return { success: true, blockedUserId: userId };
    } catch (error) {
      this.logger.error(`Failed to block user: ${error.message}`);
      return { success: false, error: "BLOCK_ERROR" };
    }
  }

  @SubscribeMessage("unblock_user")
  async handleUnblockUser(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { userId: string },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    try {
      await this.prisma.$executeRaw`
        DELETE FROM "UserBlock"
        WHERE "blockerId" = ${client.user.id} AND "blockedId" = ${data.userId}
      `;

      this.logger.log(`✅ User ${client.user.username} unblocked ${data.userId}`);

      return { success: true, unblockedUserId: data.userId };
    } catch (error) {
      this.logger.error(`Failed to unblock user: ${error.message}`);
      return { success: false, error: "UNBLOCK_ERROR" };
    }
  }

  @SubscribeMessage("get_blocked_users")
  async handleGetBlockedUsers(
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    try {
      const blockedUsers = await this.prisma.$queryRaw<any[]>`
        SELECT ub.id, ub."blockedId", ub.reason, ub."createdAt",
               u.username, u."displayName", u.avatar
        FROM "UserBlock" ub
        JOIN "User" u ON u.id = ub."blockedId"
        WHERE ub."blockerId" = ${client.user.id}
        ORDER BY ub."createdAt" DESC
      `;

      return {
        success: true,
        blockedUsers: blockedUsers.map((b) => ({
          id: b.blockedId,
          username: b.username,
          displayName: b.displayName,
          avatar: b.avatar,
          reason: b.reason,
          blockedAt: b.createdAt,
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to get blocked users: ${error.message}`);
      return { success: false, error: "FETCH_ERROR", blockedUsers: [] };
    }
  }

  @SubscribeMessage("check_block_status")
  async handleCheckBlockStatus(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { userId: string },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const blockStatus = await this.isBlocked(client.user.id, data.userId);

    return {
      success: true,
      userId: data.userId,
      isBlocked: blockStatus.blocked,
      direction: blockStatus.direction,
    };
  }

  // ================================
  // PRESENCE & HEARTBEAT (IMPROVED)
  // ================================

  @SubscribeMessage("heartbeat")
  async handleHeartbeat(@ConnectedSocket() client: AuthenticatedSocket) {
    if (!client.user) return { success: false };

    // Update last heartbeat timestamp
    client.lastHeartbeat = new Date();

    // Refresh presence TTL in Redis
    await this.redis.setUserOnline(client.user.id, client.id, {
      username: client.user.username,
      lastHeartbeat: client.lastHeartbeat.toISOString(),
    });

    return {
      success: true,
      timestamp: Date.now(),
      serverTime: new Date().toISOString(),
    };
  }

  @SubscribeMessage("update_presence")
  async handleUpdatePresence(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { state: string },
  ) {
    if (!client.user) return;

    const validStates = Object.values(UserPresenceState);
    if (!validStates.includes(data.state as UserPresenceState)) {
      return { success: false, error: "INVALID_STATE" };
    }

    // Broadcast presence change
    await this.broadcastPresenceChange(
      client.user.id,
      data.state as UserPresenceState,
    );

    return { success: true, state: data.state };
  }

  @SubscribeMessage("get_online_users")
  async handleGetOnlineUsers(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    const onlineUsers = await this.redis.getRoomOnlineUsers(data.roomId);
    const onlineCount = onlineUsers.length;

    return {
      success: true,
      onlineUsers,
      onlineCount,
    };
  }

  @SubscribeMessage("get_typing_users")
  async handleGetTypingUsers(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    const typingUsers = await this.redis.getTypingUsers(data.roomId);
    return { success: true, typingUsers };
  }

  // ================================
  // HELPER METHODS
  // ================================

  private extractToken(client: Socket): string | null {
    // Try Authorization header
    const authHeader = client.handshake.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }

    // Try query parameter
    const token = client.handshake.query.token;
    if (typeof token === "string") {
      return token;
    }

    // Try auth object
    if (client.handshake.auth?.token) {
      return client.handshake.auth.token;
    }

    return null;
  }

  /**
   * Get unread private message count for a user
   */
  private async getUnreadPrivateMessageCount(userId: string): Promise<number> {
    try {
      const result = await this.prisma.$queryRaw<any[]>`
        SELECT COUNT(*) as count FROM "PrivateMessage"
        WHERE "receiverId" = ${userId}
          AND status != 'READ'
          AND "isDeleted" = false
      `;
      return parseInt(result[0]?.count || '0');
    } catch (error) {
      this.logger.debug(`Failed to get unread count: ${error.message}`);
      return 0;
    }
  }

  private async subscribeToRedisChannels() {
    // Subscribe to gift events from other instances
    await this.redis.subscribe("gifts:sent", (message) => {
      try {
        const parsedMessage = JSON.parse(message);
        const giftData = parsedMessage.data;

        if (giftData?.roomId) {
          // Prepare gift event data
          const giftEventData = {
            id: giftData.giftSend?.id || this.generateEventId(),
            roomId: giftData.roomId,
            senderId: giftData.senderId,
            senderName: giftData.giftSend?.senderName || "Unknown",
            senderAvatar: giftData.giftSend?.senderAvatar,
            receiverId: giftData.receiverId,
            receiverName: giftData.giftSend?.receiverName || "Unknown",
            giftId: giftData.gift?.id,
            giftName: giftData.gift?.name,
            giftImage: giftData.gift?.imageUrl,
            giftPrice: giftData.gift?.price,
            quantity: giftData.giftSend?.quantity || 1,
            totalValue: giftData.giftSend?.totalPrice || 0,
            createdAt: new Date().toISOString(),
          };

          // Broadcast using unified event system
          this.broadcastRoomEvent(giftData.roomId, {
            type: "gift",
            roomId: giftData.roomId,
            id: giftEventData.id,
            senderId: giftData.senderId,
            senderName: giftEventData.senderName,
            senderAvatar: giftEventData.senderAvatar,
            serverTs: Date.now(),
            data: giftEventData,
          });
        }

        // Also notify receiver directly
        if (giftData?.receiverId) {
          this.server
            .to(`user:${giftData.receiverId}`)
            .emit("gift_received", giftData);
        }
      } catch (e) {
        this.logger.error(`Failed to process gift event: ${e.message}`);
      }
    });

    // Subscribe to presence updates from other instances
    await this.redis.subscribe("presence:updates", async (message) => {
      try {
        const data = JSON.parse(message);
        const { userId, state, timestamp } = data;

        // Get followers of this user who are connected to THIS instance
        const followers = await this.prisma.follow.findMany({
          where: { followingId: userId },
          select: { followerId: true },
        });

        // Only emit to users connected to this instance
        for (const follow of followers) {
          if (this.userConnections.has(follow.followerId)) {
            this.server.to(`user:${follow.followerId}`).emit("presence_update", {
              userId,
              state,
              timestamp,
            });
          }
        }
      } catch (e) {
        this.logger.error(`Failed to process presence update: ${e.message}`);
      }
    });

    // Subscribe to private messages from other instances
    await this.redis.subscribe("private:messages", (message) => {
      try {
        const data = JSON.parse(message);
        // Only emit if the receiver is connected to this instance
        if (data.receiverId && this.userConnections.has(data.receiverId)) {
          this.server
            .to(`user:${data.receiverId}`)
            .emit("private_message", data);
        }
      } catch (e) {
        this.logger.error(`Failed to process private message: ${e.message}`);
      }
    });

    // Subscribe to user block events
    await this.redis.subscribe("user:blocked", async (message) => {
      try {
        const data = JSON.parse(message);
        const { blockerId, blockedId } = data;

        // Notify blocked user if online
        if (this.userConnections.has(blockedId)) {
          this.server.to(`user:${blockedId}`).emit("blocked_by_user", {
            blockerId,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (e) {
        this.logger.error(`Failed to process block event: ${e.message}`);
      }
    });

    // Subscribe to notification events
    await this.redis.subscribe("notifications:new", (message) => {
      try {
        const data = JSON.parse(message);
        if (data.userId && this.userConnections.has(data.userId)) {
          this.server.to(`user:${data.userId}`).emit("notification", data);
        }
      } catch (e) {
        this.logger.error(`Failed to process notification: ${e.message}`);
      }
    });

    this.logger.log(
      "📡 Subscribed to Redis channels (gifts, presence, private messages, blocks, notifications)",
    );
  }

  // ================================
  // PUBLIC METHODS (for use in services)
  // ================================

  async broadcastToRoom(roomId: string, event: string, data: any) {
    this.server.to(`room:${roomId}`).emit(event, data);
    this.logger.debug(`📢 [BROADCAST] ${event} -> room:${roomId}`);
  }

  async sendToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
    this.logger.debug(`📤 [SEND] ${event} -> user:${userId}`);
  }

  async notifyGiftSent(
    roomId: string | null,
    senderId: string,
    receiverId: string,
    giftData: any,
  ) {
    if (roomId) {
      this.server.to(`room:${roomId}`).emit("gift_sent", giftData);
    }
    this.server.to(`user:${receiverId}`).emit("gift_received", giftData);

    // Publish to Redis for other instances
    await this.redis.publish("gifts:sent", {
      data: { ...giftData, roomId, receiverId },
    });
  }

  // ================================
  // ADMIN METHODS
  // ================================

  async kickUserFromRoom(
    roomId: string,
    userId: string,
    reason: string = "admin_action",
  ) {
    // Find all sockets for this user
    const userSockets = this.userConnections.get(userId);
    if (!userSockets) return;

    const sockets = await this.server.fetchSockets();
    for (const socket of sockets) {
      if (userSockets.has(socket.id)) {
        const authSocket = socket as unknown as AuthenticatedSocket;
        await this.forceLeaveRoom(authSocket, roomId, reason);

        // Notify the kicked user
        socket.emit("kicked_from_room", { roomId, reason });
      }
    }
  }

  async banUserFromRoom(roomId: string, userId: string, duration?: number) {
    // First kick
    await this.kickUserFromRoom(roomId, userId, "banned");

    // Update database
    await this.prisma.roomMember.updateMany({
      where: { roomId, userId },
      data: {
        isBanned: true,
        bannedUntil: duration ? new Date(Date.now() + duration * 60000) : null,
      },
    });

    // Notify user
    this.server.to(`user:${userId}`).emit("banned_from_room", {
      roomId,
      duration,
      message: duration
        ? `تم حظرك لمدة ${duration} دقيقة`
        : "تم حظرك من الغرفة",
    });
  }

  // ================================
  // STATISTICS & MONITORING
  // ================================

  getConnectionStats() {
    return {
      totalConnections: this.socketToUser.size,
      uniqueUsers: this.userConnections.size,
      connectionsByUser: Object.fromEntries(
        Array.from(this.userConnections.entries()).map(([userId, sockets]) => [
          userId,
          sockets.size,
        ]),
      ),
    };
  }

  // ================================
  // DEVICE TOKEN MANAGEMENT (for Push Notifications)
  // ================================

  @SubscribeMessage("register_device_token")
  async handleRegisterDeviceToken(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      token: string;
      platform: "ANDROID" | "IOS" | "WEB";
    },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { token, platform = "ANDROID" } = data;

    if (!token || token.length < 10) {
      return { success: false, error: "INVALID_TOKEN" };
    }

    try {
      // Check if token already exists using raw SQL
      const existing = await this.prisma.$queryRaw<any[]>`
        SELECT id, "userId" FROM "DeviceToken"
        WHERE token = ${token}
        LIMIT 1
      `;

      if (existing && existing.length > 0) {
        // Update if belongs to different user
        if (existing[0].userId !== client.user.id) {
          await this.prisma.$executeRaw`
            UPDATE "DeviceToken"
            SET "userId" = ${client.user.id}, platform = ${platform}::"Platform", "isActive" = true, "updatedAt" = NOW()
            WHERE token = ${token}
          `;
        }
      } else {
        // Create new token
        await this.prisma.$executeRaw`
          INSERT INTO "DeviceToken" (id, "userId", token, platform, "isActive", "createdAt", "updatedAt")
          VALUES (gen_random_uuid(), ${client.user.id}, ${token}, ${platform}::"Platform", true, NOW(), NOW())
          ON CONFLICT (token) DO UPDATE SET "userId" = ${client.user.id}, "isActive" = true, "updatedAt" = NOW()
        `;
      }

      this.logger.log(
        `📱 Device token registered for user ${client.user.username} (${platform})`,
      );

      return { success: true };
    } catch (error) {
      this.logger.debug(`Device token registration skipped: ${error.message}`);
      return { success: true }; // Don't fail silently if table doesn't exist yet
    }
  }

  @SubscribeMessage("unregister_device_token")
  async handleUnregisterDeviceToken(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { token: string },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    try {
      await this.prisma.$executeRaw`
        UPDATE "DeviceToken"
        SET "isActive" = false, "updatedAt" = NOW()
        WHERE token = ${data.token} AND "userId" = ${client.user.id}
      `;

      return { success: true };
    } catch (error) {
      this.logger.debug(`Failed to unregister device token: ${error.message}`);
      return { success: true }; // Don't fail if table doesn't exist
    }
  }

  // ================================
  // RATE LIMITING HELPER
  // ================================

  /**
   * Check if an event is rate limited for a user
   * @param userId User ID
   * @param eventName Event name
   * @param limitMs Minimum time between events in milliseconds
   * @returns true if rate limited, false if allowed
   */
  private isRateLimited(
    userId: string,
    eventName: string,
    limitMs: number,
  ): boolean {
    const now = Date.now();
    
    if (!this.eventRateLimits.has(userId)) {
      this.eventRateLimits.set(userId, new Map());
    }
    
    const userLimits = this.eventRateLimits.get(userId)!;
    const lastTime = userLimits.get(eventName) || 0;
    
    if (now - lastTime < limitMs) {
      return true;
    }
    
    userLimits.set(eventName, now);
    return false;
  }

  /**
   * Clean up rate limit entries for disconnected users
   */
  private cleanupRateLimits(userId: string) {
    this.eventRateLimits.delete(userId);
  }

  // ================================
  // ADDITIONAL UTILITY EVENTS
  // ================================

  @SubscribeMessage("ping")
  async handlePing(@ConnectedSocket() client: AuthenticatedSocket) {
    return {
      success: true,
      pong: true,
      timestamp: Date.now(),
      serverTime: new Date().toISOString(),
    };
  }

  @SubscribeMessage("get_server_time")
  async handleGetServerTime() {
    return {
      success: true,
      timestamp: Date.now(),
      serverTime: new Date().toISOString(),
    };
  }

  @SubscribeMessage("get_my_rooms")
  async handleGetMyRooms(@ConnectedSocket() client: AuthenticatedSocket) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    return {
      success: true,
      rooms: Array.from(client.joinedRooms || []),
    };
  }

  @SubscribeMessage("get_connection_info")
  async handleGetConnectionInfo(@ConnectedSocket() client: AuthenticatedSocket) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const userSockets = this.userConnections.get(client.user.id);

    return {
      success: true,
      socketId: client.id,
      userId: client.user.id,
      username: client.user.username,
      connectedAt: client.connectedAt?.toISOString(),
      lastHeartbeat: client.lastHeartbeat?.toISOString(),
      joinedRooms: Array.from(client.joinedRooms || []),
      totalConnections: userSockets?.size || 1,
    };
  }
}
