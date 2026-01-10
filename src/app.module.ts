import { Module, MiddlewareConsumer, NestModule } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";

// Common Modules
import { PrismaModule } from "./common/prisma/prisma.module";
import { RedisModule } from "./common/redis/redis.module";
import { CacheModule } from "./common/cache/cache.module";
import { UploadModule } from "./common/upload/upload.module";
import { FirebaseModule } from "./common/firebase/firebase.module";
import { SecurityModule } from "./common/security/security.module";
import { MonitoringModule } from "./common/monitoring/monitoring.module";
import { CleanupModule } from "./common/cleanup/cleanup.module";
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
import { VIPModule } from "./modules/vip/vip.module";
import { ScheduledTasksModule } from "./common/scheduled/scheduled-tasks.module";

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

    // Rate Limiting - حماية متقدمة
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: "short",
          ttl: 1000, // 1 second
          limit: 10, // 10 requests per second
        },
        {
          name: "medium",
          ttl: 60000, // 1 minute
          limit: config.get<number>("THROTTLE_LIMIT", 100),
        },
        {
          name: "long",
          ttl: 3600000, // 1 hour
          limit: 1000,
        },
      ],
    }),

    // Core Infrastructure
    PrismaModule,
    RedisModule,
    CacheModule,
    UploadModule,
    FirebaseModule,

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
    VIPModule,
    CleanupModule,
    ScheduledTasksModule,
  ],
  providers: [
    // Global Auth Guard
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Global Rate Limiting
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Global Logging
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    // Global Performance Monitoring
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
