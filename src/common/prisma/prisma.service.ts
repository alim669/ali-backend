import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private isConnected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private keepAliveInterval: NodeJS.Timeout | null = null;

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });
  }

  async onModuleInit() {
    await this.connectWithRetry();

    // Log slow queries in development
    if (process.env.NODE_ENV !== 'production') {
      // @ts-ignore
      this.$on('query', (e: any) => {
        if (e.duration > 100) {
          this.logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
        }
      });
    }

    // Keep connection alive for Neon.tech (pings every 60 seconds)
    this.startKeepAlive();
  }

  private async connectWithRetry(): Promise<void> {
    while (this.reconnectAttempts < this.maxReconnectAttempts) {
      try {
        this.logger.log(`Connecting to PostgreSQL... (attempt ${this.reconnectAttempts + 1})`);
        await this.$connect();
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.logger.log('✅ Connected to PostgreSQL');
        return;
      } catch (error) {
        this.reconnectAttempts++;
        this.isConnected = false;
        this.logger.error(`Failed to connect (attempt ${this.reconnectAttempts}): ${error.message}`);
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          throw new Error('Max reconnection attempts reached');
        }
        
        // Wait before retry (exponential backoff: 1s, 2s, 4s, 8s, 16s)
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 16000);
        this.logger.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  private startKeepAlive(): void {
    // Stop existing interval if any
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }

    // Ping database every 60 seconds to keep Neon.tech connection alive
    this.keepAliveInterval = setInterval(async () => {
      try {
        await this.$queryRaw`SELECT 1`;
        this.isConnected = true;
      } catch (error) {
        this.logger.warn('Keep-alive ping failed, attempting reconnect...');
        this.isConnected = false;
        try {
          await this.$connect();
          this.isConnected = true;
          this.logger.log('✅ Reconnected to PostgreSQL');
        } catch (reconnectError) {
          this.logger.error(`Reconnect failed: ${reconnectError.message}`);
        }
      }
    }, 60000); // 60 seconds
  }

  async ensureConnection(): Promise<void> {
    if (!this.isConnected) {
      this.logger.log('Connection lost, reconnecting...');
      await this.connectWithRetry();
    }
  }

  async onModuleDestroy() {
    // Stop keep-alive interval
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    this.logger.log('Disconnecting from PostgreSQL...');
    await this.$disconnect();
    this.isConnected = false;
    this.logger.log('Disconnected from PostgreSQL');
  }

  // Clean database for testing
  async cleanDatabase() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot clean database in production!');
    }

    const models = Reflect.ownKeys(this).filter(
      (key) => typeof key === 'string' && !key.startsWith('_') && !key.startsWith('$'),
    );

    return Promise.all(
      models.map((modelKey) => {
        // @ts-ignore
        if (this[modelKey]?.deleteMany) {
          // @ts-ignore
          return this[modelKey].deleteMany();
        }
      }),
    );
  }
}
