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
import { NotificationType } from "@prisma/client";

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
  | "system"
  | "room_updated";

interface RoomEvent {
  type: RoomEventType;
  roomId: string;
  id: string;
  senderId: string;
  senderNumericId?: string;
  senderName: string;
  senderAvatar?: string;
  senderVerificationType?: string | null;
  serverTs: number;
  data: Record<string, any>;
}

interface RoomMusicSong {
  id: string;
  name?: string;
  title?: string;
  artist?: string;
  url: string;
  coverUrl?: string;
  category?: string;
  durationSeconds?: number;
}

interface RoomMusicState {
  roomId: string;
  playlist: RoomMusicSong[];
  currentSong: RoomMusicSong | null;
  isPlaying: boolean;
  positionMs: number;
  startedAt?: number | null;
  updatedAt: number;
  stateVersion: number;
  updatedBy?: string;
}

interface GameQueueEntry {
  socketId: string;
  userId: string;
}

interface GameMatchPlayer {
  userId: string;
  socketId: string;
  symbol: "X" | "O";
}

interface GameMatchState {
  matchId: string;
  game: string;
  players: GameMatchPlayer[];
  createdAt: number;
}

// ============ ROOM GAMES SYSTEM ============
interface RoomGameRequest {
  id: string;
  roomId: string;
  gameType: 'dice' | 'xo'; // فقط نرد و XO
  userId: string;
  userName: string;
  userAvatar?: string;
  createdAt: number;
}

interface RoomGamePlayer {
  userId: string;
  userName: string;
  userAvatar?: string;
  socketId: string;
  score: number;
  hasPlayed: boolean; // للجولة الحالية
  diceValues?: number[];
  symbol?: 'X' | 'O'; // لـ XO
}

interface RoomGameState {
  gameId: string;
  roomId: string;
  gameType: 'dice' | 'xo';
  status: 'waiting' | 'playing' | 'finished';
  players: RoomGamePlayer[];
  spectators: string[]; // userIds
  currentRound: number;
  maxRounds: number;
  currentTurn?: string; // userId
  board?: string[]; // لـ XO
  winnerId?: string;
  winnerName?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}
// ============================================

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
  // Presence TTL (seconds) refreshed by heartbeat
  private readonly PRESENCE_TTL_SECONDS = 120;
  // Mark offline if no sockets and lastSeen older than this (ms)
  private readonly PRESENCE_OFFLINE_THRESHOLD_MS = 90000;
  // Cleanup interval (ms)
  private readonly PRESENCE_CLEANUP_INTERVAL_MS = 30000;
  // Duplicate join prevention window (5 seconds)
  private readonly DUPLICATE_JOIN_WINDOW = 5000;
  // Room music state (in-memory)
  private roomMusicState = new Map<string, RoomMusicState>();
  // Game matchmaking state (in-memory)
  private gameMatches = new Map<string, GameMatchState>();
  private socketToMatch = new Map<string, string>();
  // Idempotency for clientMessageId (roomId:userId:clientMessageId -> messageId)
  private recentMessageTempIds = new Map<string, { messageId: string; createdAt: number }>();
  private readonly MESSAGE_TEMP_ID_TTL = 60000; // 60s

  // ============ ROOM GAMES STATE ============
  // طلبات اللعب في الغرف: roomId -> Map<requestId, RoomGameRequest>
  private roomGameRequests = new Map<string, Map<string, RoomGameRequest>>();
  // الألعاب النشطة في الغرف: roomId -> RoomGameState
  private roomActiveGames = new Map<string, RoomGameState>();
  // ==========================================

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
      // Technical note: disconnect events are not reliable on mobile networks;
      // we use Redis + heartbeat lastSeen as source of truth.
      this.cleanupStaleConnections();
      this.cleanupPresenceState();
    }, this.PRESENCE_CLEANUP_INTERVAL_MS);
  }

  // ================================
  // STALE CONNECTION CLEANUP
  // ================================

  private async cleanupStaleConnections() {
    const now = Date.now();
    // Cleanup old recent join entries
    const joinCutoff = now - this.DUPLICATE_JOIN_WINDOW;
    for (const [key, timestamp] of this.recentJoins.entries()) {
      if (timestamp < joinCutoff) {
        this.recentJoins.delete(key);
      }
    }

    // Cleanup old message temp IDs
    const msgCutoff = now - this.MESSAGE_TEMP_ID_TTL;
    for (const [key, value] of this.recentMessageTempIds.entries()) {
      if (value.createdAt < msgCutoff) {
        this.recentMessageTempIds.delete(key);
      }
    }
  }

  // ================================
  // PRESENCE CLEANUP (REDIS SOURCE OF TRUTH)
  // ================================

  private async cleanupPresenceState() {
    try {
      const now = Date.now();
      const userIds = await this.redis.getOnlineUsers();

      for (const userId of userIds) {
        const presence = await this.redis.getUserPresence(userId);
        const lastSeen = typeof presence?.lastSeen === "number"
          ? presence.lastSeen
          : Number(presence?.lastSeen || 0);
        const socketCount = await this.redis.getUserSocketCount(userId);
        const isStale = !lastSeen || now - lastSeen > this.PRESENCE_OFFLINE_THRESHOLD_MS;

        if (socketCount === 0 && isStale) {
          // Diagnosis: user stays Online after exit when disconnect is missed.
          // Fix: use lastSeen + no sockets to mark Offline deterministically.
          await this.redis.setUserOffline(userId);
          await this.broadcastPresenceChange(userId, UserPresenceState.OFFLINE);
          this.logger.warn(`👤 [OFFLINE] User ${userId} marked offline by cleanup`);
          continue;
        }

        // If presence expired but sockets exist, re-hydrate presence
        if (!presence && socketCount > 0) {
          const sockets = await this.redis.getUserSockets(userId);
          const socketId = sockets[0];
          if (socketId) {
            await this.redis.setUserOnline(
              userId,
              socketId,
              { connectionCount: socketCount },
              this.PRESENCE_TTL_SECONDS,
            );
          }
        }
      }
    } catch (error) {
      this.logger.error(`Presence cleanup failed: ${error.message}`);
    }
  }

  private async getRoomOnlineUsersDetailed(roomId: string) {
    const onlineUserIds = await this.redis.getRoomOnlineUsers(roomId);
    if (!onlineUserIds || onlineUserIds.length === 0) return [];

    const members = await this.prisma.roomMember.findMany({
      where: {
        roomId,
        userId: { in: onlineUserIds },
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
            numericId: true,
          },
        },
      },
    });

    const memberMap = new Map(
      members.map((m) => [m.userId, { role: m.role, user: m.user }]),
    );

    return onlineUserIds.map((userId) => {
      const member = memberMap.get(userId);
      const user = member?.user;
      const name =
        user?.displayName || user?.username || userId;

      return {
        id: userId,
        name,
        avatar: user?.avatar,
        role: member?.role ?? "USER",
        numericId: user?.numericId?.toString(),
        userNumericId: user?.numericId?.toString(),
      };
    });
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
      case "room_updated":
        this.server.to(`room:${roomId}`).emit("room_updated", event.data);
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
  private async getRoomOnlineCount(roomId: string): Promise<number> {
    return this.redis.getRoomOnlineCount(roomId);
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

  /**
   * Emit event to a specific room (public method for other services)
   */
  public emitToRoom(roomId: string, event: string, data: any) {
    this.server.to(`room:${roomId}`).emit(event, data);
    this.logger.debug(`📡 [EMIT] ${event} -> room:${roomId}`);
  }

  /**
   * Emit event to a specific user by userId (public method for other services)
   */
  public emitToUser(userId: string, event: string, data: any) {
    // Find all sockets for this user and emit to them
    this.server.to(`user:${userId}`).emit(event, data);
    this.logger.debug(`📡 [EMIT] ${event} -> user:${userId}`);
  }

  // ================================
  // GAME MATCHMAKING HELPERS
  // ================================

  private gameQueueKey(game: string): string {
    return `game:queue:${game}`;
  }

  private gameMatchKey(matchId: string): string {
    return `game:match:${matchId}`;
  }

  private createQueueEntry(socketId: string, userId: string): string {
    return `${socketId}:${userId}`;
  }

  private parseQueueEntry(entry: string): GameQueueEntry | null {
    const [socketId, userId] = entry.split(":");
    if (!socketId || !userId) return null;
    return { socketId, userId };
  }

  private async removeFromGameQueue(game: string, socketId: string) {
    const key = this.gameQueueKey(game);
    const entries = await this.redis.lrange(key, 0, -1);
    const matches = entries.filter((entry) => entry.startsWith(`${socketId}:`));
    for (const entry of matches) {
      await this.redis.lrem(key, 0, entry);
    }
  }

  private async popValidOpponent(
    game: string,
    currentUserId: string,
    currentSocketId: string,
  ): Promise<GameQueueEntry | null> {
    const key = this.gameQueueKey(game);

    while (true) {
      const entry = await this.redis.rpop(key);
      if (!entry) return null;

      const parsed = this.parseQueueEntry(entry);
      if (!parsed) continue;

      if (parsed.socketId === currentSocketId || parsed.userId === currentUserId) {
        continue;
      }

      const socketAlive = this.server.sockets.sockets.has(parsed.socketId);
      if (!socketAlive) {
        continue;
      }

      return parsed;
    }
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
      // Diagnosis: relying on a single socket causes flicker when user opens multiple screens.
      this.socketToUser.set(client.id, user.id);
      if (!this.userConnections.has(user.id)) {
        this.userConnections.set(user.id, new Set());
      }
      this.userConnections.get(user.id)!.add(client.id);

      // Redis sockets set is the source of truth across instances/restarts
      await this.redis.addUserSocket(user.id, client.id, this.PRESENCE_TTL_SECONDS);
      const socketCount = await this.redis.getUserSocketCount(user.id);

      // Store connection in Redis with extended metadata
      await this.redis.setUserOnline(user.id, client.id, {
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        connectedAt: connectionTime.toISOString(),
        connectionCount: socketCount,
        lastHeartbeat: connectionTime.toISOString(),
      }, this.PRESENCE_TTL_SECONDS);

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

      // Remove from Redis socket set
      await this.redis.removeUserSocket(userId, client.id);
      // Remove from game queues
      await this.removeFromGameQueue("xo", client.id);

      const matchId = this.socketToMatch.get(client.id);
      if (matchId) {
        this.socketToMatch.delete(client.id);
        let match = this.gameMatches.get(matchId);
        if (!match) {
          match = (await this.redis.getJson<GameMatchState>(
            this.gameMatchKey(matchId),
          )) ?? undefined;
        }
        if (match) {
          this.gameMatches.delete(matchId);
          for (const player of match.players) {
            if (player.socketId !== client.id) {
              this.socketToMatch.delete(player.socketId);
              this.server.to(player.socketId).emit("game_opponent_left", {
                matchId,
                game: match.game,
              });
            }
          }
          await this.redis.del(this.gameMatchKey(matchId));
        }
      }
      const redisSocketCount = await this.redis.getUserSocketCount(userId);
      const presence = await this.redis.getUserPresence(userId);
      const lastSeen = typeof presence?.lastSeen === "number"
        ? presence.lastSeen
        : Number(presence?.lastSeen || 0);
      const isStale = !lastSeen || Date.now() - lastSeen > this.PRESENCE_OFFLINE_THRESHOLD_MS;
      const localSocketCount = userSockets?.size ?? 0;

      if (userSockets) {
        userSockets.delete(client.id);

        // Get all rooms user was in from this socket
        const joinedRooms = client.joinedRooms || new Set();

        // Leave all rooms from this socket
        for (const roomId of joinedRooms) {
          await this.forceLeaveRoom(client, roomId, "disconnect");
        }

        // Only mark offline if this was the last connection AND no recent heartbeat
        // Diagnosis: mobile background/network drops often skip disconnect.
        if (localSocketCount === 0 && redisSocketCount === 0 && isStale) {
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
          const remainingSocket =
            presence?.socketId || Array.from(userSockets)[0] || client.id;
          const connectionCount = Math.max(redisSocketCount, localSocketCount);
          await this.redis.setUserOnline(userId, remainingSocket, {
            username,
            connectionCount,
            lastHeartbeat: new Date().toISOString(),
          }, this.PRESENCE_TTL_SECONDS);

          this.logger.log(
            `🔌 [DISCONNECT] User ${username} still online (${connectionCount} connections remaining)`,
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

      const onlineCount = await this.getRoomOnlineCount(roomId);

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
  // GAME MATCHMAKING
  // ================================

  @SubscribeMessage("game_queue_join")
  async handleGameQueueJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { game: string },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const game = data?.game;
    if (!game) {
      return { success: false, error: "INVALID_GAME" };
    }

    await this.removeFromGameQueue(game, client.id);

    const opponent = await this.popValidOpponent(
      game,
      client.user.id,
      client.id,
    );

    if (!opponent) {
      await this.redis.lpush(
        this.gameQueueKey(game),
        this.createQueueEntry(client.id, client.user.id),
      );
      return { success: true, status: "queued" };
    }

    const matchId = `${game}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const mySymbol: "X" | "O" = Math.random() < 0.5 ? "X" : "O";
    const opponentSymbol: "X" | "O" = mySymbol === "X" ? "O" : "X";

    const match: GameMatchState = {
      matchId,
      game,
      createdAt: Date.now(),
      players: [
        {
          userId: client.user.id,
          socketId: client.id,
          symbol: mySymbol,
        },
        {
          userId: opponent.userId,
          socketId: opponent.socketId,
          symbol: opponentSymbol,
        },
      ],
    };

    this.gameMatches.set(matchId, match);
    this.socketToMatch.set(client.id, matchId);
    this.socketToMatch.set(opponent.socketId, matchId);
    await this.redis.setJson(this.gameMatchKey(matchId), match, 3600);

    // Get user names for display
    const [myUser, opponentUser] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: client.user.id }, select: { displayName: true, username: true } }),
      this.prisma.user.findUnique({ where: { id: opponent.userId }, select: { displayName: true, username: true } }),
    ]);
    const myName = myUser?.displayName || myUser?.username || 'لاعب';
    const opponentName = opponentUser?.displayName || opponentUser?.username || 'لاعب';

    this.server.to(client.id).emit("game_match_found", {
      matchId,
      game,
      symbol: mySymbol,
      isFirst: mySymbol === 'X',
      opponentName: opponentName,
    });
    this.server.to(opponent.socketId).emit("game_match_found", {
      matchId,
      game,
      symbol: opponentSymbol,
      isFirst: opponentSymbol === 'X',
      opponentName: myName,
    });

    return { success: true, status: "matched", matchId };
  }

  @SubscribeMessage("game_queue_leave")
  async handleGameQueueLeave(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { game: string },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }
    const game = data?.game;
    if (!game) {
      return { success: false, error: "INVALID_GAME" };
    }

    await this.removeFromGameQueue(game, client.id);
    return { success: true };
  }

  @SubscribeMessage("game_move")
  async handleGameMove(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: { matchId: string; game: string; move: Record<string, any> },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { matchId, game, move } = data || {};
    if (!matchId || !game || !move) {
      return { success: false, error: "INVALID_PAYLOAD" };
    }

    let match = this.gameMatches.get(matchId);
    if (!match) {
      match = (await this.redis.getJson<GameMatchState>(
        this.gameMatchKey(matchId),
      )) ?? undefined;
      if (match) this.gameMatches.set(matchId, match);
    }

    if (!match || match.game !== game) {
      return { success: false, error: "MATCH_NOT_FOUND" };
    }

    const isParticipant = match.players.some(
      (player) => player.socketId === client.id,
    );
    if (!isParticipant) {
      return { success: false, error: "NOT_IN_MATCH" };
    }

    // Send move to all players, marking if it's from opponent or self
    for (const player of match.players) {
      const isOpponent = player.socketId !== client.id;
      this.server.to(player.socketId).emit("game_move", {
        matchId,
        game,
        move: { ...move, isOpponent },
        fromUserId: client.user.id,
      });
    }

    return { success: true };
  }

  // ================================
  // ROOM GAMES SYSTEM - نظام الألعاب داخل الغرف
  // ================================

  // فتح اللعبة للطلبات (المالك فقط)
  @SubscribeMessage("room_game:open_for_requests")
  async handleRoomGameOpen(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; gameType: 'dice' | 'xo' },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { roomId, gameType } = data || {};
    if (!roomId || !gameType) {
      return { success: false, error: "INVALID_PAYLOAD" };
    }

    // التحقق من أن المستخدم هو المالك
    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: client.user.id } },
      include: { room: true },
    });

    if (!membership || membership.role !== 'OWNER') {
      return { success: false, error: "NOT_OWNER", message: "فقط مالك الغرفة يمكنه فتح اللعبة" };
    }

    // التحقق من عدم وجود لعبة نشطة
    if (this.roomActiveGames.has(roomId)) {
      return { success: false, error: "GAME_IN_PROGRESS", message: "يوجد لعبة نشطة حالياً" };
    }

    // مسح الطلبات القديمة
    this.roomGameRequests.set(roomId, new Map());

    // إرسال إشعار للجميع في الغرفة
    this.server.to(`room:${roomId}`).emit("room_game:opened", {
      roomId,
      gameType,
      gameName: this.getGameName(gameType),
      ownerName: client.user.displayName || client.user.email?.split('@')[0] || 'المالك',
      message: `${client.user.displayName || 'المالك'} فتح ${this.getGameName(gameType)} - اضغط للانضمام!`,
    });

    return { success: true, message: `تم فتح ${this.getGameName(gameType)} للطلبات` };
  }

  // إغلاق اللعبة وإلغاء الطلبات
  @SubscribeMessage("room_game:close_requests")
  async handleRoomGameClose(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { roomId } = data || {};

    // التحقق من أن المستخدم هو المالك
    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: client.user.id } },
    });

    if (!membership || membership.role !== 'OWNER') {
      return { success: false, error: "NOT_OWNER" };
    }

    // مسح الطلبات
    this.roomGameRequests.delete(roomId);

    // إرسال إشعار للجميع
    this.server.to(`room:${roomId}`).emit("room_game:closed", {
      roomId,
      message: "تم إغلاق اللعبة",
    });

    return { success: true };
  }

  // طلب اللعب من المستخدم
  @SubscribeMessage("room_game:request_play")
  async handleRoomGameRequest(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; gameType: 'dice' | 'xo' },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { roomId, gameType } = data || {};
    if (!roomId || !gameType) {
      return { success: false, error: "INVALID_PAYLOAD" };
    }

    // التحقق من أن المستخدم في الغرفة
    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: client.user.id } },
      include: { room: { include: { owner: true } } },
    });

    if (!membership) {
      return { success: false, error: "NOT_IN_ROOM" };
    }

    // التحقق من عدم وجود لعبة نشطة
    if (this.roomActiveGames.has(roomId)) {
      return { success: false, error: "GAME_IN_PROGRESS", message: "يوجد لعبة نشطة حالياً" };
    }

    // إنشاء أو استخراج قائمة الطلبات
    if (!this.roomGameRequests.has(roomId)) {
      this.roomGameRequests.set(roomId, new Map());
    }
    const requests = this.roomGameRequests.get(roomId)!;

    // التحقق من عدم وجود طلب سابق من هذا المستخدم لنفس اللعبة
    const existingRequest = Array.from(requests.values()).find(
      r => r.userId === client.user!.id && r.gameType === gameType
    );
    if (existingRequest) {
      return { success: false, error: "ALREADY_REQUESTED", message: "لديك طلب معلق بالفعل" };
    }

    // إنشاء الطلب
    const request: RoomGameRequest = {
      id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      roomId,
      gameType,
      userId: client.user.id,
      userName: client.user.displayName || client.user.email?.split('@')[0] || 'مستخدم',
      userAvatar: client.user.avatar,
      createdAt: Date.now(),
    };

    requests.set(request.id, request);

    // إرسال إشعار للمالك
    const ownerSockets = this.userConnections.get(membership.room.ownerId);
    if (ownerSockets && ownerSockets.size > 0) {
      for (const socketId of ownerSockets) {
        this.server.to(socketId).emit("room_game:new_request", {
          request,
          roomId,
          pendingCount: requests.size,
        });
      }
    }

    // إشعار الجميع في الغرفة
    this.server.to(`room:${roomId}`).emit("room_game:request_added", {
      gameType,
      userName: request.userName,
      pendingCount: requests.size,
    });

    return { success: true, requestId: request.id };
  }

  // إلغاء طلب اللعب
  @SubscribeMessage("room_game:cancel_request")
  async handleRoomGameCancelRequest(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; requestId: string },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { roomId, requestId } = data || {};
    const requests = this.roomGameRequests.get(roomId);
    if (!requests) {
      return { success: false, error: "NO_REQUESTS" };
    }

    const request = requests.get(requestId);
    if (!request) {
      return { success: false, error: "REQUEST_NOT_FOUND" };
    }

    // فقط صاحب الطلب أو المالك يمكنه الإلغاء
    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: client.user.id } },
    });

    if (request.userId !== client.user.id && membership?.role !== 'OWNER') {
      return { success: false, error: "NOT_AUTHORIZED" };
    }

    requests.delete(requestId);

    this.server.to(`room:${roomId}`).emit("room_game:request_removed", {
      requestId,
      pendingCount: requests.size,
    });

    return { success: true };
  }

  // الحصول على قائمة الطلبات (للمالك)
  @SubscribeMessage("room_game:get_requests")
  async handleRoomGameGetRequests(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { roomId } = data || {};

    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: client.user.id } },
    });

    if (!membership) {
      return { success: false, error: "NOT_IN_ROOM" };
    }

    const requests = this.roomGameRequests.get(roomId);
    const requestList = requests ? Array.from(requests.values()) : [];

    return { 
      success: true, 
      requests: requestList,
      isOwner: membership.role === 'OWNER',
    };
  }

  // موافقة المالك على اللاعبين وبدء اللعبة
  @SubscribeMessage("room_game:start_game")
  async handleRoomGameStart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { 
      roomId: string; 
      gameType: 'dice' | 'xo';
      playerIds: string[]; // userIds of approved players
    },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { roomId, gameType, playerIds } = data || {};
    if (!roomId || !gameType || !playerIds || playerIds.length < 2) {
      return { success: false, error: "INVALID_PAYLOAD", message: "يجب اختيار لاعبين على الأقل" };
    }

    // التحقق من أن المستخدم هو المالك
    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: client.user.id } },
    });

    if (!membership || membership.role !== 'OWNER') {
      return { success: false, error: "NOT_OWNER", message: "فقط مالك الغرفة يمكنه بدء اللعبة" };
    }

    // التحقق من عدم وجود لعبة نشطة
    if (this.roomActiveGames.has(roomId)) {
      return { success: false, error: "GAME_IN_PROGRESS", message: "يوجد لعبة نشطة حالياً" };
    }

    // جلب بيانات اللاعبين
    const players: RoomGamePlayer[] = [];
    for (const odaId of playerIds) {
      const user = await this.prisma.user.findUnique({
        where: { id: odaId },
      });
      if (user) {
        const userSockets = this.userConnections.get(odaId);
        const socketId = userSockets && userSockets.size > 0 ? Array.from(userSockets)[0] : '';
        players.push({
          userId: odaId,
          userName: user.displayName || user.email?.split('@')[0] || 'لاعب',
          userAvatar: user.avatar || undefined,
          socketId,
          score: 0,
          hasPlayed: false,
          diceValues: gameType === 'dice' ? [] : undefined,
          symbol: gameType === 'xo' ? (players.length === 0 ? 'X' : 'O') : undefined,
        });
      }
    }

    if (players.length < 2) {
      return { success: false, error: "INSUFFICIENT_PLAYERS", message: "لم يتم العثور على لاعبين كافيين" };
    }

    // إنشاء اللعبة
    const gameId = `game_${roomId}_${Date.now()}`;
    const gameState: RoomGameState = {
      gameId,
      roomId,
      gameType,
      status: 'playing',
      players,
      spectators: [],
      currentRound: 1,
      maxRounds: gameType === 'dice' ? 5 : 1,
      currentTurn: players[0].userId,
      board: gameType === 'xo' ? Array(9).fill('') : undefined,
      winnerId: undefined,
      winnerName: undefined,
      createdAt: Date.now(),
      startedAt: Date.now(),
      finishedAt: undefined,
    };

    this.roomActiveGames.set(roomId, gameState);

    // حذف طلبات اللعب للاعبين المختارين
    const requests = this.roomGameRequests.get(roomId);
    if (requests) {
      for (const [reqId, req] of requests) {
        if (playerIds.includes(req.userId)) {
          requests.delete(reqId);
        }
      }
    }

    // إرسال إشعار للجميع في الغرفة
    this.server.to(`room:${roomId}`).emit("room_game:started", {
      gameState,
      message: `بدأت لعبة ${this.getGameName(gameType)}!`,
    });

    return { success: true, gameId, gameState };
  }

  // حركة في اللعبة (رمي النرد، وضع X/O، إلخ)
  @SubscribeMessage("room_game:move")
  async handleRoomGameMove(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { 
      roomId: string; 
      move: {
        type: 'roll_dice' | 'place_mark' | 'play_domino';
        position?: number; // for XO
        diceValues?: number[]; // for dice
        dominoData?: any; // for domino
      };
    },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { roomId, move } = data || {};
    const gameState = this.roomActiveGames.get(roomId);
    
    if (!gameState) {
      return { success: false, error: "NO_ACTIVE_GAME" };
    }

    if (gameState.status !== 'playing') {
      return { success: false, error: "GAME_NOT_PLAYING" };
    }

    // التحقق من أن المستخدم لاعب
    const playerIndex = gameState.players.findIndex(p => p.userId === client.user!.id);
    if (playerIndex === -1) {
      return { success: false, error: "NOT_A_PLAYER" };
    }

    // التحقق من الدور
    if (gameState.currentTurn !== client.user.id) {
      return { success: false, error: "NOT_YOUR_TURN" };
    }

    const player = gameState.players[playerIndex];
    let gameEnded = false;
    let roundEnded = false;

    // معالجة الحركة حسب نوع اللعبة
    if (gameState.gameType === 'dice' && move.type === 'roll_dice') {
      // رمي النرد
      const diceValues = move.diceValues || [
        Math.floor(Math.random() * 6) + 1,
        Math.floor(Math.random() * 6) + 1,
      ];
      const total = diceValues.reduce((a, b) => a + b, 0);
      
      player.diceValues = diceValues;
      player.score += total;
      player.hasPlayed = true;

      // التحقق من إكمال جميع اللاعبين للجولة
      const allPlayed = gameState.players.every(p => p.hasPlayed);
      if (allPlayed) {
        roundEnded = true;
        if (gameState.currentRound >= gameState.maxRounds) {
          gameEnded = true;
        } else {
          // جولة جديدة
          gameState.currentRound++;
          gameState.players.forEach(p => {
            p.hasPlayed = false;
            p.diceValues = [];
          });
          gameState.currentTurn = gameState.players[0].userId;
        }
      } else {
        // الانتقال للاعب التالي
        const nextIndex = (playerIndex + 1) % gameState.players.length;
        gameState.currentTurn = gameState.players[nextIndex].userId;
      }

    } else if (gameState.gameType === 'xo' && move.type === 'place_mark') {
      // وضع X أو O
      const position = move.position;
      if (position === undefined || position < 0 || position > 8) {
        return { success: false, error: "INVALID_POSITION" };
      }

      if (gameState.board![position] !== '') {
        return { success: false, error: "POSITION_TAKEN" };
      }

      gameState.board![position] = player.symbol!;

      // التحقق من الفوز
      const winPatterns = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
        [0, 4, 8], [2, 4, 6], // diagonals
      ];

      for (const pattern of winPatterns) {
        const [a, b, c] = pattern;
        if (
          gameState.board![a] &&
          gameState.board![a] === gameState.board![b] &&
          gameState.board![a] === gameState.board![c]
        ) {
          gameEnded = true;
          gameState.winnerId = player.userId;
          gameState.winnerName = player.userName;
          break;
        }
      }

      // التحقق من التعادل
      if (!gameEnded && !gameState.board!.some(cell => cell === '')) {
        gameEnded = true;
        // تعادل - لا فائز
      }

      if (!gameEnded) {
        // الانتقال للاعب التالي
        const nextIndex = (playerIndex + 1) % gameState.players.length;
        gameState.currentTurn = gameState.players[nextIndex].userId;
      }
    }

    // تحديد الفائز في النرد
    if (gameEnded && gameState.gameType === 'dice') {
      const winner = gameState.players.reduce((prev, curr) => 
        prev.score > curr.score ? prev : curr
      );
      gameState.winnerId = winner.userId;
      gameState.winnerName = winner.userName;
    }

    if (gameEnded) {
      gameState.status = 'finished';
      gameState.finishedAt = Date.now();
      
      // إزالة اللعبة بعد 30 ثانية
      setTimeout(() => {
        if (this.roomActiveGames.get(roomId)?.gameId === gameState.gameId) {
          this.roomActiveGames.delete(roomId);
        }
      }, 30000);
    }

    // إرسال تحديث للجميع
    this.server.to(`room:${roomId}`).emit("room_game:update", {
      gameState,
      lastMove: {
        playerId: client.user.id,
        playerName: player.userName,
        move,
        roundEnded,
        gameEnded,
      },
    });

    return { success: true, gameState };
  }

  // الحصول على حالة اللعبة الحالية
  @SubscribeMessage("room_game:get_state")
  async handleRoomGameGetState(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { roomId } = data || {};
    const gameState = this.roomActiveGames.get(roomId);
    
    if (!gameState) {
      return { success: true, hasGame: false, gameState: null };
    }

    // إضافة المستخدم كمتفرج إذا لم يكن لاعباً
    const isPlayer = gameState.players.some(p => p.userId === client.user!.id);
    if (!isPlayer && !gameState.spectators.includes(client.user.id)) {
      gameState.spectators.push(client.user.id);
    }

    return { 
      success: true, 
      hasGame: true, 
      gameState,
      isPlayer,
      isMyTurn: gameState.currentTurn === client.user.id,
    };
  }

  // إنهاء اللعبة (للمالك فقط)
  @SubscribeMessage("room_game:end")
  async handleRoomGameEnd(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { roomId } = data || {};

    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: client.user.id } },
    });

    if (!membership || membership.role !== 'OWNER') {
      return { success: false, error: "NOT_OWNER" };
    }

    const gameState = this.roomActiveGames.get(roomId);
    if (!gameState) {
      return { success: false, error: "NO_ACTIVE_GAME" };
    }

    gameState.status = 'finished';
    gameState.finishedAt = Date.now();
    this.roomActiveGames.delete(roomId);

    this.server.to(`room:${roomId}`).emit("room_game:ended", {
      gameState,
      reason: 'cancelled_by_owner',
      message: 'تم إنهاء اللعبة بواسطة مالك الغرفة',
    });

    return { success: true };
  }

  // Helper: اسم اللعبة بالعربي
  private getGameName(gameType: string): string {
    const names: Record<string, string> = {
      'dice': 'النرد',
      'xo': 'إكس أو',
      'domino': 'الدومينو',
    };
    return names[gameType] || gameType;
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
        const onlineUsers = await this.getRoomOnlineUsersDetailed(roomId);
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
      const onlineUsers = await this.getRoomOnlineUsersDetailed(roomId);

      // Only broadcast user_joined if this is NOT a duplicate within the window
      if (!isDuplicate) {
        const joinEventData = {
          userId: client.user.id,
          name: client.user.displayName || client.user.username,
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

      // Send current room music state (if exists)
      const musicState = this.roomMusicState.get(roomId);
      if (musicState) {
        client.emit("room_music_state", musicState);
      }

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
      const onlineCount = await this.getRoomOnlineCount(roomId);

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
  // ROOM UPDATE EVENTS
  // ================================

  @SubscribeMessage("update_room")
  async handleUpdateRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; avatar?: string; name?: string; description?: string },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { roomId, avatar, name, description } = data;

    try {
      // Broadcast room update to all users in the room
      const updateEventData = {
        roomId,
        avatar,
        name,
        description,
        updatedBy: client.user.id,
        updatedByName: client.user.displayName,
        timestamp: new Date().toISOString(),
      };

      this.broadcastRoomEvent(roomId, {
        type: "room_updated",
        roomId,
        id: this.generateEventId(),
        senderId: client.user.id,
        senderName: client.user.displayName,
        senderAvatar: client.user.avatar,
        serverTs: Date.now(),
        data: updateEventData,
      });

      this.logger.log(
        `✅ [ROOM_UPDATE] Room ${roomId} updated by ${client.user.username}`,
      );

      return { success: true, roomId };
    } catch (error) {
      this.logger.error(
        `❌ [ROOM_UPDATE] Error updating room ${roomId}: ${error.message}`,
      );
      return { success: false, error: "UPDATE_ERROR" };
    }
  }

  // ================================
  // ROOM MUSIC EVENTS
  // ================================

  private broadcastRoomMusicState(roomId: string) {
    const state = this.roomMusicState.get(roomId);
    if (state) {
      this.server.to(`room:${roomId}`).emit("room_music_state", state);
    }
  }

  private createDefaultRoomMusicState(roomId: string): RoomMusicState {
    return {
      roomId,
      playlist: [],
      currentSong: null,
      isPlaying: false,
      positionMs: 0,
      startedAt: null,
      updatedAt: Date.now(),
      stateVersion: 1,
    };
  }

  private bumpRoomMusicState(state: RoomMusicState, userId?: string) {
    state.updatedAt = Date.now();
    state.stateVersion = (state.stateVersion ?? 0) + 1;
    if (userId) {
      state.updatedBy = userId;
    }
  }

  @SubscribeMessage("room_music_state_request")
  async handleRoomMusicStateRequest(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) return;
    const roomId = data?.roomId;
    if (!roomId) return;
    const state = this.roomMusicState.get(roomId);
    if (state) {
      client.emit("room_music_state", state);
    }
  }

  @SubscribeMessage("room_music_add")
  async handleRoomMusicAdd(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; song: RoomMusicSong },
  ) {
    if (!client.user) return;
    const { roomId, song } = data || {};
    if (!roomId || !song?.url) return;

    const existing =
      this.roomMusicState.get(roomId) || this.createDefaultRoomMusicState(roomId);

    const already = existing.playlist.find((s) => s.id === song.id);
    if (!already) {
      existing.playlist.push(song);
    }

    if (!existing.currentSong) {
      existing.currentSong = song;
      existing.isPlaying = true;
      existing.positionMs = 0;
      existing.startedAt = Date.now();
    }

    this.bumpRoomMusicState(existing, client.user.id);

    this.roomMusicState.set(roomId, existing);
    this.broadcastRoomMusicState(roomId);
  }

  @SubscribeMessage("room_music_remove")
  async handleRoomMusicRemove(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; songId: string },
  ) {
    if (!client.user) return;
    const { roomId, songId } = data || {};
    if (!roomId || !songId) return;

    const existing = this.roomMusicState.get(roomId);
    if (!existing) return;

    existing.playlist = existing.playlist.filter((s) => s.id !== songId);
    if (existing.currentSong?.id === songId) {
      existing.currentSong = existing.playlist[0] || null;
      existing.positionMs = 0;
      existing.isPlaying = existing.currentSong != null;
      existing.startedAt = existing.isPlaying ? Date.now() : null;
    }

    this.bumpRoomMusicState(existing, client.user.id);

    this.roomMusicState.set(roomId, existing);
    this.broadcastRoomMusicState(roomId);
  }

  @SubscribeMessage("room_music_play")
  async handleRoomMusicPlay(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: { roomId: string; song?: RoomMusicSong; positionMs?: number },
  ) {
    if (!client.user) return;
    const { roomId, song, positionMs } = data || {};
    if (!roomId) return;

    const existing =
      this.roomMusicState.get(roomId) || this.createDefaultRoomMusicState(roomId);

    if (song?.url) {
      const already = existing.playlist.find((s) => s.id === song.id);
      if (!already) {
        existing.playlist.push(song);
      }
      existing.currentSong = song;
    }

    existing.isPlaying = true;
    if (Number.isFinite(positionMs ?? NaN)) {
      existing.positionMs = Math.max(0, Math.trunc(positionMs as number));
    } else if (song?.url) {
      existing.positionMs = 0;
    }
    existing.startedAt = Date.now();
    this.bumpRoomMusicState(existing, client.user.id);

    this.roomMusicState.set(roomId, existing);
    this.broadcastRoomMusicState(roomId);
  }

  @SubscribeMessage("room_music_pause")
  async handleRoomMusicPause(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; positionMs?: number },
  ) {
    if (!client.user) return;
    const { roomId, positionMs } = data || {};
    if (!roomId) return;

    const existing = this.roomMusicState.get(roomId);
    if (!existing) return;

    const now = Date.now();
    if (existing.isPlaying && existing.startedAt) {
      const elapsed = now - existing.startedAt;
      if (elapsed > 0) {
        existing.positionMs = Math.max(0, existing.positionMs + elapsed);
      }
    }

    existing.isPlaying = false;
    if (Number.isFinite(positionMs)) {
      existing.positionMs = Math.max(0, Math.trunc(positionMs as number));
    }
    existing.startedAt = null;
    this.bumpRoomMusicState(existing, client.user.id);

    this.roomMusicState.set(roomId, existing);
    this.broadcastRoomMusicState(roomId);
  }

  @SubscribeMessage("room_music_seek")
  async handleRoomMusicSeek(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; positionMs: number },
  ) {
    if (!client.user) return;
    const { roomId, positionMs } = data || {};
    if (!roomId || !Number.isFinite(positionMs)) return;

    const existing = this.roomMusicState.get(roomId);
    if (!existing) return;

    existing.positionMs = Math.max(0, Math.trunc(positionMs));
    if (existing.isPlaying) {
      existing.startedAt = Date.now();
    }
    this.bumpRoomMusicState(existing, client.user.id);

    this.roomMusicState.set(roomId, existing);
    this.broadcastRoomMusicState(roomId);
  }

  // ================================
  // MIC STATUS EVENTS
  // ================================

  @SubscribeMessage("micStatus")
  async handleMicStatus(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; slotId: string; isActive: boolean },
  ) {
    if (!client.user) return;
    const { roomId, slotId, isActive } = data || {};
    if (!roomId || slotId === undefined) return;

    const userId = client.user.id;
    const slotIndex = parseInt(slotId, 10);
    const slotKey = `room:${roomId}:mic_slots`;

    try {
      if (isActive) {
        // User is taking the mic
        const existingSlot = await this.redis.hget(slotKey, slotId);
        let slotData: any = { userId: null, isLocked: false, isMuted: false };

        if (existingSlot) {
          slotData = JSON.parse(existingSlot);
          if (slotData.userId && slotData.userId !== userId) {
            client.emit("mic_error", { error: "المايك مشغول" });
            return;
          }
          if (slotData.isLocked) {
            client.emit("mic_error", { error: "المايك مقفل" });
            return;
          }
        }

        // Get user info
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, displayName: true, username: true, avatar: true, numericId: true },
        });

        slotData = {
          ...slotData,
          userId,
          userName: user?.displayName || user?.username || userId,
          userAvatar: user?.avatar,
          userNumericId: user?.numericId?.toString(),
          isSpeaking: true,
          joinedAt: Date.now(),
        };

        await this.redis.hset(slotKey, slotId, JSON.stringify(slotData));
        await this.redis.expire(slotKey, 86400);

        // Broadcast to room
        this.server.to(`room:${roomId}`).emit("mic_slot_updated", {
          roomId,
          slotIndex,
          ...slotData,
        });

        this.logger.debug(`🎤 User ${userId} entered mic slot ${slotIndex} in room ${roomId}`);
      } else {
        // User is leaving the mic
        const existingSlot = await this.redis.hget(slotKey, slotId);
        if (existingSlot) {
          const slotData = JSON.parse(existingSlot);
          if (slotData.userId === userId) {
            const emptySlot = {
              userId: null,
              userName: null,
              userAvatar: null,
              isLocked: slotData.isLocked || false,
              isMuted: false,
              isSpeaking: false,
            };

            await this.redis.hset(slotKey, slotId, JSON.stringify(emptySlot));

            this.server.to(`room:${roomId}`).emit("mic_slot_updated", {
              roomId,
              slotIndex,
              ...emptySlot,
            });

            this.logger.debug(`🎤 User ${userId} left mic slot ${slotIndex} in room ${roomId}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Mic status error: ${error.message}`);
      client.emit("mic_error", { error: "حدث خطأ" });
    }
  }

  @SubscribeMessage("mic_speaking")
  async handleMicSpeaking(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; slotId: string; isSpeaking: boolean },
  ) {
    if (!client.user) return;
    const { roomId, slotId, isSpeaking } = data || {};
    if (!roomId || slotId === undefined) return;

    // Broadcast speaking state to room (for speaking animation)
    this.server.to(`room:${roomId}`).emit("mic_speaking_update", {
      roomId,
      slotIndex: parseInt(slotId, 10),
      userId: client.user.id,
      isSpeaking,
    });
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

    const { roomId, content, type: rawType = "TEXT", metadata, tempId } = data;
    // Ensure type is uppercase to match Prisma enum
    const type = rawType?.toUpperCase() || "TEXT";
    const clientMessageId =
      metadata?.clientMessageId || metadata?.tempId || tempId;

    // Emit sending state to sender immediately
    if (tempId) {
      client.emit("message_state", { tempId, state: MessageState.SENDING });
    }

    try {
      // Idempotency: prevent duplicate sends for same clientMessageId
      if (clientMessageId) {
        const key = `${roomId}:${client.user.id}:${clientMessageId}`;
        const existing = this.recentMessageTempIds.get(key);
        if (existing) {
          client.emit("message_state", {
            tempId: clientMessageId,
            messageId: existing.messageId,
            state: MessageState.SENT,
          });
          return {
            success: true,
            messageId: existing.messageId,
            tempId: clientMessageId,
            state: MessageState.SENT,
          };
        }
      }

      // Verify membership and check if muted
      const membership = await this.prisma.roomMember.findUnique({
        where: { roomId_userId: { roomId, userId: client.user.id } },
      });

      if (!membership || membership.leftAt || membership.isBanned) {
        if (clientMessageId) {
          client.emit("message_state", {
            tempId: clientMessageId,
            state: "failed",
            error: "NOT_A_MEMBER",
          });
        }
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
          if (clientMessageId) {
            client.emit("message_state", {
              tempId: clientMessageId,
              state: "failed",
              error: "USER_MUTED",
            });
          }
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
          metadata: { ...(metadata || {}), tempId: clientMessageId || tempId },
        },
        include: {
          sender: {
            select: {
              id: true,
              numericId: true,
              username: true,
              displayName: true,
              avatar: true,
              verification: {
                select: {
                  type: true,
                  expiresAt: true,
                },
              },
            },
          },
        },
      });

      const now = new Date();
      const senderVerificationType =
        message.sender?.verification &&
        message.sender.verification.expiresAt > now
          ? message.sender.verification.type
          : null;

      // Emit sent state to sender
      if (clientMessageId || tempId) {
        client.emit("message_state", {
          tempId: clientMessageId || tempId,
          messageId: message.id,
          state: MessageState.SENT,
          createdAt: message.createdAt.toISOString(),
        });
      }

      if (clientMessageId) {
        const key = `${roomId}:${client.user.id}:${clientMessageId}`;
        this.recentMessageTempIds.set(key, {
          messageId: message.id,
          createdAt: Date.now(),
        });
      }

      // Prepare message data for broadcast
      const messageData = {
        id: message.id,
        roomId: message.roomId,
        senderId: message.senderId,
        senderNumericId: message.sender.numericId?.toString(),
        senderName: message.sender.displayName,
        senderAvatar: message.sender.avatar,
        senderVerificationType,
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
        senderNumericId: message.sender.numericId?.toString(),
        senderName: message.sender.displayName,
        senderAvatar: message.sender.avatar ?? undefined,
        senderVerificationType,
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
      this.logger.error(`❌ [MESSAGE] Error sending message: ${error.message}`, error.stack);
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
        message: `فشل إرسال الرسالة: ${error.message}`,
        details: error.message,
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

    // Ensure socket is tracked in Redis (multi-connection safe)
    await this.redis.addUserSocket(
      client.user.id,
      client.id,
      this.PRESENCE_TTL_SECONDS,
    );
    const socketCount = await this.redis.getUserSocketCount(client.user.id);

    // Refresh presence TTL in Redis
    await this.redis.setUserOnline(client.user.id, client.id, {
      username: client.user.username,
      lastHeartbeat: client.lastHeartbeat.toISOString(),
      connectionCount: socketCount,
    }, this.PRESENCE_TTL_SECONDS);

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
    const onlineUsers = await this.getRoomOnlineUsersDetailed(data.roomId);
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
        this.logger.log(`🎁📥 Received gift event from Redis: ${message.substring(0, 200)}...`);
        const parsedMessage = JSON.parse(message);
        const giftData = parsedMessage.data;

        if (giftData?.roomId) {
          // Prepare gift event data with sender/receiver info
          const giftEventData = {
            id: giftData.giftSend?.id || this.generateEventId(),
            roomId: giftData.roomId,
            senderId: giftData.senderId,
            senderName: giftData.senderName || giftData.giftSend?.senderName || "Unknown",
            senderAvatar: giftData.senderAvatar || giftData.giftSend?.senderAvatar,
            receiverId: giftData.receiverId,
            receiverName: giftData.receiverName || giftData.giftSend?.receiverName || "Unknown",
            receiverAvatar: giftData.receiverAvatar || giftData.giftSend?.receiverAvatar,
            giftId: giftData.gift?.id,
            giftName: giftData.gift?.name,
            giftImage: giftData.gift?.imageUrl,
            giftPrice: giftData.gift?.price,
            quantity: giftData.quantity || giftData.giftSend?.quantity || 1,
            totalValue: giftData.totalPrice || giftData.giftSend?.totalPrice || 0,
            createdAt: new Date().toISOString(),
          };

          this.logger.log(`🎁📡 Broadcasting gift to room:${giftData.roomId} - from ${giftEventData.senderName} to ${giftEventData.receiverName}`);

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
          
          this.logger.log(`🎁✅ Gift broadcast complete for room:${giftData.roomId}`);
        } else {
          this.logger.warn(`🎁⚠️ Gift event missing roomId: ${JSON.stringify(giftData)}`);
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

    // Subscribe to verification events
    await this.redis.subscribe("verification:updated", (message) => {
      try {
        const data = JSON.parse(message);
        if (data.data?.userId) {
          // Notify the user
          this.server.to(`user:${data.data.userId}`).emit("verification_updated", data.data);
          // Broadcast to all rooms the user is in
          this.server.emit("user_verification_changed", {
            userId: data.data.userId,
            verificationType: data.data.verificationType,
            expiresAt: data.data.expiresAt,
          });
          this.logger.debug(`📢 Verification updated for user ${data.data.userId}`);
        }
      } catch (e) {
        this.logger.error(`Failed to process verification update: ${e.message}`);
      }
    });

    await this.redis.subscribe("verification:expired", (message) => {
      try {
        const data = JSON.parse(message);
        if (data.data?.userId) {
          // Notify the user
          this.server.to(`user:${data.data.userId}`).emit("verification_expired", data.data);
          // Broadcast to all
          this.server.emit("user_verification_changed", {
            userId: data.data.userId,
            verificationType: null,
            expiresAt: null,
          });
          this.logger.debug(`📢 Verification expired for user ${data.data.userId}`);
        }
      } catch (e) {
        this.logger.error(`Failed to process verification expiration: ${e.message}`);
      }
    });

    await this.redis.subscribe("verification:revoked", (message) => {
      try {
        const data = JSON.parse(message);
        if (data.data?.userId) {
          this.server.to(`user:${data.data.userId}`).emit("verification_revoked", data.data);
          this.server.emit("user_verification_changed", {
            userId: data.data.userId,
            verificationType: null,
            expiresAt: null,
          });
          this.logger.debug(`📢 Verification revoked for user ${data.data.userId}`);
        }
      } catch (e) {
        this.logger.error(`Failed to process verification revocation: ${e.message}`);
      }
    });

    // Subscribe to friend request events
    await this.redis.subscribe("friend:request:new", (message) => {
      try {
        const data = JSON.parse(message);
        if (data.toUserId && this.userConnections.has(data.toUserId)) {
          this.server.to(`user:${data.toUserId}`).emit("friend_request_received", data);
          this.logger.debug(`👥 Friend request forwarded to user ${data.toUserId}`);
        }
      } catch (e) {
        this.logger.error(`Failed to process friend request: ${e.message}`);
      }
    });

    await this.redis.subscribe("friend:request:accepted", (message) => {
      try {
        const data = JSON.parse(message);
        if (data.toUserId && this.userConnections.has(data.toUserId)) {
          this.server.to(`user:${data.toUserId}`).emit("friend_request_accepted", data);
          this.logger.debug(`👥 Friend accept notification forwarded to user ${data.toUserId}`);
        }
      } catch (e) {
        this.logger.error(`Failed to process friend accept: ${e.message}`);
      }
    });

    this.logger.log(
      "📡 Subscribed to Redis channels (gifts, presence, private messages, blocks, notifications, verification, friends)",
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

  async notifyRoomUpdated(
    roomId: string,
    data: Record<string, any>,
    senderId: string = "system",
  ) {
    const event: RoomEvent = {
      type: "room_updated",
      roomId,
      id: this.generateEventId(),
      senderId,
      senderName: "system",
      senderAvatar: undefined,
      serverTs: Date.now(),
      data,
    };

    this.broadcastRoomEvent(roomId, event);
    this.logger.debug(`📢 [ROOM_UPDATED] room:${roomId}`);
  }

  async notifyUserUpdated(data: {
    id: string;
    numericId?: string;
    username?: string | null;
    displayName?: string | null;
    avatar?: string | null;
  }) {
    this.server.emit("user_updated", {
      userId: data.id,
      numericId: data.numericId,
      username: data.username,
      displayName: data.displayName,
      avatar: data.avatar,
    });
    this.logger.debug(`📢 [USER_UPDATED] user:${data.id}`);
  }

  async notifyGiftSent(
    roomId: string | null,
    senderId: string,
    receiverId: string,
    giftData: any,
  ) {
    this.logger.log(`🎁🚀 notifyGiftSent called - roomId: ${roomId}, sender: ${senderId}, receiver: ${receiverId}`);
    
    if (roomId) {
      // استخدام unified broadcast system للتأكد من وصول الهدية لكل المستخدمين
      const giftEvent = {
        type: "gift" as const,
        roomId,
        id: giftData.id || this.generateEventId(),
        senderId,
        senderName: giftData.senderName || "Unknown",
        senderAvatar: giftData.senderAvatar,
        serverTs: Date.now(),
        data: giftData,
      };
      
      this.logger.log(`🎁📡 Broadcasting gift to room:${roomId} via unified system`);
      
      // بث عبر الـ unified system (room_event)
      this.broadcastRoomEvent(roomId, giftEvent);
      
      // بث إضافي للتأكد من وصول الهدية (backwards compatibility)
      this.server.to(`room:${roomId}`).emit("gift_sent", giftData);
      this.server.to(`room:${roomId}`).emit("giftSent", giftData);
      
      this.logger.log(`🎁✅ Gift broadcast complete to room:${roomId}`);
    }
    
    // إشعار المستلم مباشرة
    this.server.to(`user:${receiverId}`).emit("gift_received", giftData);
    this.logger.log(`🎁📥 Gift notification sent to user:${receiverId}`);
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

  // ================================
  // FRIEND REQUESTS - طلبات الصداقة الفورية
  // ================================

  /**
   * إرسال طلب صداقة فوري عبر WebSocket
   */
  @SubscribeMessage("send_friend_request")
  async handleSendFriendRequest(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { toUserId: string },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { toUserId } = data || {};
    if (!toUserId) {
      return { success: false, error: "INVALID_PAYLOAD", message: "toUserId مطلوب" };
    }

    if (client.user.id === toUserId) {
      return { success: false, error: "SELF_REQUEST", message: "لا يمكنك إرسال طلب لنفسك" };
    }

    try {
      // التحقق من وجود المستخدم
      const targetUser = await this.prisma.user.findUnique({
        where: { id: toUserId },
        select: { id: true, username: true, displayName: true, avatar: true },
      });

      if (!targetUser) {
        return { success: false, error: "USER_NOT_FOUND", message: "المستخدم غير موجود" };
      }

      // التحقق من عدم وجود صداقة مسبقة
      const existingFriendship = await this.prisma.$queryRaw`
        SELECT id FROM friendships 
        WHERE (user1_id = ${client.user.id} AND user2_id = ${toUserId}) 
           OR (user1_id = ${toUserId} AND user2_id = ${client.user.id})
        LIMIT 1
      ` as any[];

      if (existingFriendship.length > 0) {
        return { success: false, error: "ALREADY_FRIENDS", message: "أنتما أصدقاء بالفعل" };
      }

      // التحقق من عدم وجود طلب معلق
      const existingRequest = await this.prisma.$queryRaw`
        SELECT id, status FROM friend_requests 
        WHERE from_user_id = ${client.user.id} AND to_user_id = ${toUserId} AND status = 'pending'
        LIMIT 1
      ` as any[];

      if (existingRequest.length > 0) {
        return { success: false, error: "REQUEST_EXISTS", message: "لديك طلب صداقة معلق بالفعل" };
      }

      // التحقق من طلب عكسي
      const reverseRequest = await this.prisma.$queryRaw`
        SELECT id FROM friend_requests 
        WHERE from_user_id = ${toUserId} AND to_user_id = ${client.user.id} AND status = 'pending'
        LIMIT 1
      ` as any[];

      if (reverseRequest.length > 0) {
        // قبول الطلب العكسي تلقائياً
        await this.prisma.$executeRaw`
          UPDATE friend_requests SET status = 'accepted', updated_at = NOW() WHERE id = ${reverseRequest[0].id}
        `;
        await this.prisma.$executeRaw`
          INSERT INTO friendships (user1_id, user2_id) VALUES (${client.user.id}, ${toUserId}) ON CONFLICT DO NOTHING
        `;

        // إرسال إشعار قبول للطرفين
        const acceptData = {
          type: 'friend_request_accepted',
          friendId: client.user.id,
          friendName: client.user.displayName || client.user.username,
          friendAvatar: client.user.avatar,
          timestamp: new Date().toISOString(),
        };
        this.server.to(`user:${toUserId}`).emit("friend_request_accepted", acceptData);
        client.emit("friend_request_accepted", {
          type: 'friend_request_accepted',
          friendId: toUserId,
          friendName: targetUser.displayName || targetUser.username,
          friendAvatar: targetUser.avatar,
          timestamp: new Date().toISOString(),
        });

        // ✅ إنشاء إشعارات في قاعدة البيانات للطرفين
        await this.prisma.notification.createMany({
          data: [
            {
              userId: toUserId,
              type: NotificationType.FRIEND_REQUEST_ACCEPTED,
              title: "✅ أصبحتما أصدقاء",
              body: `${client.user.displayName || client.user.username} قبل طلب صداقتك`,
              data: { friendId: client.user.id },
            },
            {
              userId: client.user.id,
              type: NotificationType.FRIEND_REQUEST_ACCEPTED,
              title: "✅ أصبحتما أصدقاء",
              body: `${targetUser.displayName || targetUser.username} الآن صديقك`,
              data: { friendId: toUserId },
            },
          ],
        });

        return { success: true, message: "تم قبول طلب الصداقة تلقائياً - كان لديه طلب معلق لك", autoAccepted: true };
      }

      // إنشاء طلب جديد
      const requestResult = await this.prisma.$queryRaw`
        INSERT INTO friend_requests (from_user_id, to_user_id, status, created_at, updated_at)
        VALUES (${client.user.id}, ${toUserId}, 'pending', NOW(), NOW())
        ON CONFLICT (from_user_id, to_user_id) 
        DO UPDATE SET status = 'pending', updated_at = NOW()
        RETURNING id, created_at
      ` as any[];

      const requestId = requestResult[0]?.id;

      // إرسال إشعار فوري للمستخدم المستهدف
      const requestData = {
        type: 'friend_request_received',
        requestId: requestId,
        fromUserId: client.user.id,
        fromUserName: client.user.displayName || client.user.username,
        fromUserAvatar: client.user.avatar,
        timestamp: new Date().toISOString(),
      };

      // إرسال عبر Socket مباشرة
      this.server.to(`user:${toUserId}`).emit("friend_request_received", requestData);

      // إرسال عبر Redis للـ instances الأخرى
      await this.redis.publish("friend:request:new", JSON.stringify({
        toUserId,
        ...requestData,
      }));

      // ✅ إنشاء إشعار في قاعدة البيانات للمستخدم المستهدف
      await this.prisma.notification.create({
        data: {
          userId: toUserId,
          type: NotificationType.FRIEND_REQUEST_RECEIVED,
          title: "📨 طلب صداقة جديد",
          body: `${client.user.displayName || client.user.username} أرسل لك طلب صداقة`,
          data: { 
            requestId: requestId,
            fromUserId: client.user.id, 
            fromUserName: client.user.displayName || client.user.username,
            fromUserAvatar: client.user.avatar,
          },
        },
      });

      this.logger.log(`👥 Friend request sent: ${client.user.username} -> ${targetUser.username}`);

      return { 
        success: true, 
        message: "تم إرسال طلب الصداقة بنجاح",
        requestId: requestId,
      };
    } catch (error) {
      this.logger.error(`Failed to send friend request: ${error.message}`);
      return { success: false, error: "SERVER_ERROR", message: "حدث خطأ في الخادم" };
    }
  }

  /**
   * قبول طلب صداقة فوري
   */
  @SubscribeMessage("accept_friend_request")
  async handleAcceptFriendRequest(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { requestId: string },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { requestId } = data || {};
    if (!requestId) {
      return { success: false, error: "INVALID_PAYLOAD", message: "requestId مطلوب" };
    }

    try {
      // جلب الطلب
      const request = await this.prisma.$queryRaw`
        SELECT fr.*, u."displayName" as from_user_name, u.avatar as from_user_avatar, u.username as from_username
        FROM friend_requests fr
        JOIN "User" u ON u.id = fr.from_user_id
        WHERE fr.id = ${requestId}::uuid AND fr.to_user_id = ${client.user.id} AND fr.status = 'pending'
        LIMIT 1
      ` as any[];

      if (request.length === 0) {
        return { success: false, error: "REQUEST_NOT_FOUND", message: "طلب الصداقة غير موجود" };
      }

      const req = request[0];

      // تحديث حالة الطلب
      await this.prisma.$executeRaw`
        UPDATE friend_requests SET status = 'accepted', updated_at = NOW() WHERE id = ${requestId}::uuid
      `;

      // إنشاء الصداقة
      await this.prisma.$executeRaw`
        INSERT INTO friendships (user1_id, user2_id) 
        VALUES (${req.from_user_id}, ${client.user.id}) 
        ON CONFLICT DO NOTHING
      `;

      // إرسال إشعار فوري للمرسل الأصلي
      const acceptData = {
        type: 'friend_request_accepted',
        requestId: requestId,
        friendId: client.user.id,
        friendName: client.user.displayName || client.user.username,
        friendAvatar: client.user.avatar,
        timestamp: new Date().toISOString(),
      };

      this.server.to(`user:${req.from_user_id}`).emit("friend_request_accepted", acceptData);

      // إرسال عبر Redis
      await this.redis.publish("friend:request:accepted", JSON.stringify({
        toUserId: req.from_user_id,
        ...acceptData,
      }));

      // إنشاء إشعار في قاعدة البيانات
      await this.prisma.notification.create({
        data: {
          userId: req.from_user_id,
          type: NotificationType.FRIEND_REQUEST_ACCEPTED,
          title: "✅ تم قبول طلب الصداقة",
          body: `${client.user.displayName || client.user.username} قبل طلب صداقتك`,
          data: { accepterId: client.user.id },
        },
      });

      this.logger.log(`👥 Friend request accepted: ${req.from_username} <- ${client.user.username}`);

      return { 
        success: true, 
        message: "تم قبول طلب الصداقة",
        friendId: req.from_user_id,
        friendName: req.from_user_name || req.from_username,
        friendAvatar: req.from_user_avatar,
      };
    } catch (error) {
      this.logger.error(`Failed to accept friend request: ${error.message}`);
      return { success: false, error: "SERVER_ERROR", message: "حدث خطأ في الخادم" };
    }
  }

  /**
   * رفض طلب صداقة
   */
  @SubscribeMessage("reject_friend_request")
  async handleRejectFriendRequest(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { requestId: string },
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    const { requestId } = data || {};
    if (!requestId) {
      return { success: false, error: "INVALID_PAYLOAD" };
    }

    try {
      const result = await this.prisma.$executeRaw`
        UPDATE friend_requests 
        SET status = 'rejected', updated_at = NOW() 
        WHERE id = ${requestId}::uuid AND to_user_id = ${client.user.id} AND status = 'pending'
      `;

      if (result === 0) {
        return { success: false, error: "REQUEST_NOT_FOUND", message: "طلب الصداقة غير موجود" };
      }

      this.logger.log(`👥 Friend request rejected by ${client.user.username}`);

      return { success: true, message: "تم رفض طلب الصداقة" };
    } catch (error) {
      this.logger.error(`Failed to reject friend request: ${error.message}`);
      return { success: false, error: "SERVER_ERROR" };
    }
  }

  /**
   * جلب عدد طلبات الصداقة المعلقة
   */
  @SubscribeMessage("get_pending_friend_requests_count")
  async handleGetPendingFriendRequestsCount(
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.user) {
      return { success: false, error: "NOT_AUTHENTICATED" };
    }

    try {
      const result = await this.prisma.$queryRaw`
        SELECT COUNT(*) as count FROM friend_requests 
        WHERE to_user_id = ${client.user.id} AND status = 'pending'
      ` as any[];

      return { 
        success: true, 
        count: parseInt(result[0]?.count || '0'),
      };
    } catch (error) {
      return { success: false, error: "SERVER_ERROR", count: 0 };
    }
  }
}
