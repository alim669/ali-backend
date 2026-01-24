import { Module, MiddlewareConsumer, NestModule } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";

// Common Modules
import { PrismaModule } from "./common/prisma/prisma.module";
import { RedisModule } from "./common/redis/redis.module";
import { CacheModule } from "./common/cache/cache.module";
import { UploadModule } from "./common/upload/upload.module";
import { SecurityModule } from "./common/security/security.module";
import { MonitoringModule } from "./common/monitoring/monitoring.module";
import { SecurityMiddleware } from "./common/security/middleware/security.middleware";
import { LoggingInterceptor } from "./common/monitoring/interceptors/logging.interceptor";
import { PerformanceInterceptor } from "./common/monitoring/interceptors/performance.interceptor";

// Feature Modules
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { RoomsModule } from "./modules/rooms/rooms.module";
import { MessagesModule } from "./modules/messages/messages.module";
import { GiftsModule } from "./modules/gifts/gifts.module";
import { WalletsModule } from "./modules/wallets/wallets.module";
import { WebsocketModule } from "./modules/websocket/websocket.module";
import { AdminModule } from "./modules/admin/admin.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { FollowsModule } from "./modules/follows/follows.module";
import { FriendsModule } from "./modules/friends/friends.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { HealthModule } from "./modules/health/health.module";
import { AgentsModule } from "./modules/agents/agents.module";
import { PrivateChatsModule } from "./modules/private-chats/private-chats.module";
import { ExploreModule } from "./modules/explore/explore.module";

// Guards
import { JwtAuthGuard } from "./modules/auth/guards/jwt-auth.guard";

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
      cache: true,
    }),

    // Rate Limiting
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: "short",
          ttl: 1000,
          limit: 10,
        },
        {
          name: "medium",
          ttl: 60000,
          limit: config.get<number>("THROTTLE_LIMIT", 100),
        },
        {
          name: "long",
          ttl: 3600000,
          limit: 1000,
        }
        
      ],
    }),

    // Core Infrastructure
    PrismaModule,
    RedisModule,
    CacheModule,
    UploadModule,

    // Security & Monitoring
    SecurityModule,
    MonitoringModule,

    // Feature Modules
    AuthModule,
    UsersModule,
    RoomsModule,
    MessagesModule,
    GiftsModule,
    WalletsModule,
    WebsocketModule,
    AdminModule,
    NotificationsModule,
    FollowsModule,
    FriendsModule,
    ReportsModule,
    HealthModule,
    AgentsModule,
    PrivateChatsModule,
    ExploreModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: PerformanceInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SecurityMiddleware).forRoutes("*");
  }
}
