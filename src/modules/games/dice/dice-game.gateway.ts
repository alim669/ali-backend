import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

// ================================
// DICE GAME TYPES
// ================================

interface AuthenticatedSocket extends Socket {
  user?: {
    id: string;
    email: string;
    username: string;
    displayName: string;
    role: string;
    avatar?: string;
    numericId?: string;
  };
}

interface DicePlayer {
  userId: string;
  socketId: string;
  displayName: string;
  avatar?: string;
  diceValues?: number[];
  totalScore?: number;
  hasRolled: boolean;
  isWinner?: boolean;
}

interface DiceGameState {
  gameId: string;
  roomId: string;
  status: 'waiting' | 'countdown' | 'rolling' | 'finished';
  players: DicePlayer[];
  spectators: string[];
  maxPlayers: number;
  minPlayers: number;
  diceCount: number;
  betAmount: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  winnerId?: string;
  winnerName?: string;
  theme: DiceGameTheme;
  countdownSeconds: number;
  currentCountdown?: number;
}

interface DiceGameTheme {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  diceColor: string;
  textColor: string;
  glowColor: string;
}

interface DiceGameSettings {
  maxPlayers: number;
  minPlayers: number;
  diceCount: number;
  betAmount: number;
  countdownSeconds: number;
  theme: DiceGameTheme;
}

// Default themes
const DEFAULT_THEMES: Record<string, DiceGameTheme> = {
  classic: {
    primaryColor: '#FF6B35',
    secondaryColor: '#E64A19',
    backgroundColor: '#1A1A2E',
    diceColor: '#FFFFFF',
    textColor: '#FFFFFF',
    glowColor: '#FF6B35',
  },
  royal: {
    primaryColor: '#FFD700',
    secondaryColor: '#B8860B',
    backgroundColor: '#1A0A2E',
    diceColor: '#FFFFFF',
    textColor: '#FFD700',
    glowColor: '#FFD700',
  },
  neon: {
    primaryColor: '#00FF87',
    secondaryColor: '#00CC6A',
    backgroundColor: '#0D0D1A',
    diceColor: '#00FF87',
    textColor: '#FFFFFF',
    glowColor: '#00FF87',
  },
  fire: {
    primaryColor: '#FF4500',
    secondaryColor: '#FF6347',
    backgroundColor: '#1A0A0A',
    diceColor: '#FFFFFF',
    textColor: '#FF4500',
    glowColor: '#FF4500',
  },
  ice: {
    primaryColor: '#00BFFF',
    secondaryColor: '#1E90FF',
    backgroundColor: '#0A1A2E',
    diceColor: '#FFFFFF',
    textColor: '#00BFFF',
    glowColor: '#00BFFF',
  },
  purple: {
    primaryColor: '#9B59B6',
    secondaryColor: '#8E44AD',
    backgroundColor: '#1A0A2E',
    diceColor: '#FFFFFF',
    textColor: '#9B59B6',
    glowColor: '#9B59B6',
  },
};

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/',
})
export class DiceGameGateway {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(DiceGameGateway.name);
  
  // Active games: roomId -> DiceGameState
  private activeGames = new Map<string, DiceGameState>();
  // Room settings: roomId -> DiceGameSettings
  private roomSettings = new Map<string, DiceGameSettings>();
  // Countdown timers
  private countdownTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ================================
  // GAME SETTINGS (Owner Control)
  // ================================

  @SubscribeMessage('dice:get_settings')
  async handleGetSettings(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    const { roomId } = data || {};
    if (!roomId) return { success: false, error: 'ROOM_ID_REQUIRED' };

    const settings = this.getOrCreateSettings(roomId);
    return { success: true, settings };
  }

  @SubscribeMessage('dice:update_settings')
  async handleUpdateSettings(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; settings: Partial<DiceGameSettings> },
  ) {
    if (!client.user) return { success: false, error: 'NOT_AUTHENTICATED' };
    
    const { roomId, settings } = data || {};
    if (!roomId) return { success: false, error: 'ROOM_ID_REQUIRED' };

    // Check if user is owner or moderator
    const isAuthorized = await this.isRoomOwnerOrMod(roomId, client.user.id);
    if (!isAuthorized) return { success: false, error: 'NOT_AUTHORIZED' };

    // Update settings
    const currentSettings = this.getOrCreateSettings(roomId);
    const updatedSettings: DiceGameSettings = {
      ...currentSettings,
      ...settings,
      theme: settings.theme ? { ...currentSettings.theme, ...settings.theme } : currentSettings.theme,
    };
    this.roomSettings.set(roomId, updatedSettings);

    // Save to Redis for persistence
    await this.redis.setJson(`dice:settings:${roomId}`, updatedSettings, 86400 * 30);

    // Broadcast to room
    this.server.to(`room:${roomId}`).emit('dice:settings_updated', {
      roomId,
      settings: updatedSettings,
      updatedBy: client.user.displayName,
    });

    return { success: true, settings: updatedSettings };
  }

  @SubscribeMessage('dice:set_theme')
  async handleSetTheme(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; themeName?: string; customTheme?: DiceGameTheme },
  ) {
    if (!client.user) return { success: false, error: 'NOT_AUTHENTICATED' };
    
    const { roomId, themeName, customTheme } = data || {};
    if (!roomId) return { success: false, error: 'ROOM_ID_REQUIRED' };

    const isAuthorized = await this.isRoomOwnerOrMod(roomId, client.user.id);
    if (!isAuthorized) return { success: false, error: 'NOT_AUTHORIZED' };

    const settings = this.getOrCreateSettings(roomId);
    
    if (themeName && DEFAULT_THEMES[themeName]) {
      settings.theme = DEFAULT_THEMES[themeName];
    } else if (customTheme) {
      settings.theme = { ...settings.theme, ...customTheme };
    }

    this.roomSettings.set(roomId, settings);
    await this.redis.setJson(`dice:settings:${roomId}`, settings, 86400 * 30);

    this.server.to(`room:${roomId}`).emit('dice:theme_changed', {
      roomId,
      theme: settings.theme,
      themeName,
    });

    return { success: true, theme: settings.theme };
  }

  // ================================
  // GAME FLOW
  // ================================

  @SubscribeMessage('dice:create_game')
  async handleCreateGame(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) return { success: false, error: 'NOT_AUTHENTICATED' };
    
    const { roomId } = data || {};
    if (!roomId) return { success: false, error: 'ROOM_ID_REQUIRED' };

    // Check if game already exists
    if (this.activeGames.has(roomId)) {
      return { success: false, error: 'GAME_ALREADY_EXISTS' };
    }

    const isAuthorized = await this.isRoomOwnerOrMod(roomId, client.user.id);
    if (!isAuthorized) return { success: false, error: 'NOT_AUTHORIZED' };

    const settings = this.getOrCreateSettings(roomId);
    const gameId = `dice_${roomId}_${Date.now()}`;

    const gameState: DiceGameState = {
      gameId,
      roomId,
      status: 'waiting',
      players: [],
      spectators: [],
      maxPlayers: settings.maxPlayers,
      minPlayers: settings.minPlayers,
      diceCount: settings.diceCount,
      betAmount: settings.betAmount,
      createdAt: Date.now(),
      theme: settings.theme,
      countdownSeconds: settings.countdownSeconds,
    };

    this.activeGames.set(roomId, gameState);

    // Broadcast to all room members
    this.server.to(`room:${roomId}`).emit('dice:game_created', {
      roomId,
      gameId,
      gameState,
      createdBy: {
        id: client.user.id,
        displayName: client.user.displayName,
        avatar: client.user.avatar,
      },
    });

    this.logger.log(`Dice game created in room ${roomId} by ${client.user.displayName}`);

    return { success: true, gameId, gameState };
  }

  @SubscribeMessage('dice:join_game')
  async handleJoinGame(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) return { success: false, error: 'NOT_AUTHENTICATED' };
    
    const { roomId } = data || {};
    if (!roomId) return { success: false, error: 'ROOM_ID_REQUIRED' };

    const gameState = this.activeGames.get(roomId);
    if (!gameState) return { success: false, error: 'NO_ACTIVE_GAME' };
    if (gameState.status !== 'waiting') return { success: false, error: 'GAME_ALREADY_STARTED' };
    if (gameState.players.length >= gameState.maxPlayers) return { success: false, error: 'GAME_FULL' };

    // Check if already joined
    if (gameState.players.some(p => p.userId === client.user!.id)) {
      return { success: false, error: 'ALREADY_JOINED' };
    }

    // Check if user has enough balance for bet
    if (gameState.betAmount > 0) {
      const wallet = await this.prisma.wallet.findUnique({
        where: { userId: client.user.id },
        select: { balance: true },
      });
      if (!wallet || Number(wallet.balance) < gameState.betAmount) {
        return { success: false, error: 'INSUFFICIENT_COINS' };
      }
    }

    const player: DicePlayer = {
      userId: client.user.id,
      socketId: client.id,
      displayName: client.user.displayName,
      avatar: client.user.avatar,
      hasRolled: false,
    };

    gameState.players.push(player);

    // Remove from spectators if was spectating
    const spectatorIndex = gameState.spectators.indexOf(client.user.id);
    if (spectatorIndex > -1) {
      gameState.spectators.splice(spectatorIndex, 1);
    }

    // Broadcast player joined
    this.server.to(`room:${roomId}`).emit('dice:player_joined', {
      roomId,
      player,
      playersCount: gameState.players.length,
      maxPlayers: gameState.maxPlayers,
    });

    this.logger.log(`${client.user.displayName} joined dice game in room ${roomId}`);

    return { success: true, gameState };
  }

  @SubscribeMessage('dice:leave_game')
  async handleLeaveGame(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) return { success: false, error: 'NOT_AUTHENTICATED' };
    
    const { roomId } = data || {};
    if (!roomId) return { success: false, error: 'ROOM_ID_REQUIRED' };

    const gameState = this.activeGames.get(roomId);
    if (!gameState) return { success: false, error: 'NO_ACTIVE_GAME' };

    const playerIndex = gameState.players.findIndex(p => p.userId === client.user!.id);
    if (playerIndex === -1) return { success: false, error: 'NOT_IN_GAME' };

    // Can only leave during waiting phase
    if (gameState.status !== 'waiting') {
      return { success: false, error: 'CANNOT_LEAVE_DURING_GAME' };
    }

    gameState.players.splice(playerIndex, 1);

    this.server.to(`room:${roomId}`).emit('dice:player_left', {
      roomId,
      userId: client.user.id,
      displayName: client.user.displayName,
      playersCount: gameState.players.length,
    });

    return { success: true };
  }

  @SubscribeMessage('dice:spectate')
  async handleSpectate(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) return { success: false, error: 'NOT_AUTHENTICATED' };
    
    const { roomId } = data || {};
    if (!roomId) return { success: false, error: 'ROOM_ID_REQUIRED' };

    const gameState = this.activeGames.get(roomId);
    if (!gameState) return { success: false, error: 'NO_ACTIVE_GAME' };

    // Add to spectators if not already
    if (!gameState.spectators.includes(client.user.id)) {
      gameState.spectators.push(client.user.id);
    }

    return { success: true, gameState };
  }

  @SubscribeMessage('dice:start_game')
  async handleStartGame(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) return { success: false, error: 'NOT_AUTHENTICATED' };
    
    const { roomId } = data || {};
    if (!roomId) return { success: false, error: 'ROOM_ID_REQUIRED' };

    const isAuthorized = await this.isRoomOwnerOrMod(roomId, client.user.id);
    if (!isAuthorized) return { success: false, error: 'NOT_AUTHORIZED' };

    const gameState = this.activeGames.get(roomId);
    if (!gameState) return { success: false, error: 'NO_ACTIVE_GAME' };
    if (gameState.status !== 'waiting') return { success: false, error: 'GAME_ALREADY_STARTED' };
    if (gameState.players.length < gameState.minPlayers) {
      return { success: false, error: 'NOT_ENOUGH_PLAYERS', minPlayers: gameState.minPlayers };
    }

    // Deduct balance from all players
    if (gameState.betAmount > 0) {
      for (const player of gameState.players) {
        await this.prisma.wallet.updateMany({
          where: { userId: player.userId },
          data: { balance: { decrement: gameState.betAmount } },
        });
      }
    }

    // Start countdown
    gameState.status = 'countdown';
    gameState.startedAt = Date.now();
    gameState.currentCountdown = gameState.countdownSeconds;

    this.server.to(`room:${roomId}`).emit('dice:game_starting', {
      roomId,
      countdown: gameState.countdownSeconds,
      gameState,
    });

    // Countdown timer
    const countdownInterval = setInterval(() => {
      if (!gameState.currentCountdown || gameState.currentCountdown <= 0) {
        clearInterval(countdownInterval);
        this.startRolling(roomId);
        return;
      }

      gameState.currentCountdown--;
      this.server.to(`room:${roomId}`).emit('dice:countdown', {
        roomId,
        countdown: gameState.currentCountdown,
      });
    }, 1000);

    this.countdownTimers.set(roomId, countdownInterval);

    return { success: true };
  }

  private async startRolling(roomId: string) {
    const gameState = this.activeGames.get(roomId);
    if (!gameState) return;

    gameState.status = 'rolling';

    // Roll dice for all players
    for (const player of gameState.players) {
      const diceValues: number[] = [];
      for (let i = 0; i < gameState.diceCount; i++) {
        diceValues.push(Math.floor(Math.random() * 6) + 1);
      }
      player.diceValues = diceValues;
      player.totalScore = diceValues.reduce((sum, val) => sum + val, 0);
      player.hasRolled = true;
    }

    // Broadcast rolling animation
    this.server.to(`room:${roomId}`).emit('dice:rolling', {
      roomId,
      players: gameState.players.map(p => ({
        userId: p.userId,
        displayName: p.displayName,
        avatar: p.avatar,
      })),
    });

    // After 3 seconds, reveal results
    setTimeout(() => this.revealResults(roomId), 3000);
  }

  private async revealResults(roomId: string) {
    const gameState = this.activeGames.get(roomId);
    if (!gameState) return;

    // Find winner (highest score)
    let winner: DicePlayer | null = null;
    let highestScore = 0;

    for (const player of gameState.players) {
      if ((player.totalScore || 0) > highestScore) {
        highestScore = player.totalScore || 0;
        winner = player;
      }
    }

    if (winner) {
      winner.isWinner = true;
      gameState.winnerId = winner.userId;
      gameState.winnerName = winner.displayName;

      // Award balance to winner
      const totalPot = gameState.betAmount * gameState.players.length;
      if (totalPot > 0) {
        await this.prisma.wallet.updateMany({
          where: { userId: winner.userId },
          data: { balance: { increment: totalPot } },
        });
      }
    }

    gameState.status = 'finished';
    gameState.finishedAt = Date.now();

    // Broadcast results
    this.server.to(`room:${roomId}`).emit('dice:game_finished', {
      roomId,
      gameId: gameState.gameId,
      players: gameState.players.map(p => ({
        userId: p.userId,
        displayName: p.displayName,
        avatar: p.avatar,
        diceValues: p.diceValues,
        totalScore: p.totalScore,
        isWinner: p.isWinner,
      })),
      winner: winner ? {
        userId: winner.userId,
        displayName: winner.displayName,
        avatar: winner.avatar,
        score: winner.totalScore,
      } : null,
      totalPot: gameState.betAmount * gameState.players.length,
    });

    this.logger.log(`Dice game finished in room ${roomId}. Winner: ${winner?.displayName || 'None'}`);

    // Clean up after 10 seconds
    setTimeout(() => {
      this.activeGames.delete(roomId);
      this.countdownTimers.delete(roomId);
    }, 10000);
  }

  @SubscribeMessage('dice:cancel_game')
  async handleCancelGame(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user) return { success: false, error: 'NOT_AUTHENTICATED' };
    
    const { roomId } = data || {};
    if (!roomId) return { success: false, error: 'ROOM_ID_REQUIRED' };

    const isAuthorized = await this.isRoomOwnerOrMod(roomId, client.user.id);
    if (!isAuthorized) return { success: false, error: 'NOT_AUTHORIZED' };

    const gameState = this.activeGames.get(roomId);
    if (!gameState) return { success: false, error: 'NO_ACTIVE_GAME' };

    // Clear countdown timer
    const timer = this.countdownTimers.get(roomId);
    if (timer) {
      clearInterval(timer);
      this.countdownTimers.delete(roomId);
    }

    // Refund balance if game was in countdown or rolling
    if (gameState.status === 'countdown' && gameState.betAmount > 0) {
      for (const player of gameState.players) {
        await this.prisma.wallet.updateMany({
          where: { userId: player.userId },
          data: { balance: { increment: gameState.betAmount } },
        });
      }
    }

    this.activeGames.delete(roomId);

    this.server.to(`room:${roomId}`).emit('dice:game_cancelled', {
      roomId,
      cancelledBy: client.user.displayName,
    });

    return { success: true };
  }

  @SubscribeMessage('dice:get_game_state')
  async handleGetGameState(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    const { roomId } = data || {};
    if (!roomId) return { success: false, error: 'ROOM_ID_REQUIRED' };

    const gameState = this.activeGames.get(roomId);
    const settings = this.getOrCreateSettings(roomId);

    return {
      success: true,
      gameState: gameState || null,
      settings,
      availableThemes: Object.keys(DEFAULT_THEMES),
    };
  }

  // ================================
  // HELPER METHODS
  // ================================

  private getOrCreateSettings(roomId: string): DiceGameSettings {
    let settings = this.roomSettings.get(roomId);
    if (!settings) {
      settings = {
        maxPlayers: 4,
        minPlayers: 2,
        diceCount: 2,
        betAmount: 0,
        countdownSeconds: 5,
        theme: DEFAULT_THEMES.classic,
      };
      this.roomSettings.set(roomId, settings);
    }
    return settings;
  }

  private async isRoomOwnerOrMod(roomId: string, userId: string): Promise<boolean> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { ownerId: true },
    });

    if (!room) return false;
    if (room.ownerId === userId) return true;

    // Check if moderator
    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { role: true },
    });

    return membership?.role === 'MODERATOR' || membership?.role === 'ADMIN';
  }
}
