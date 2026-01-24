import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger, VersioningType } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import helmet from "helmet";
import * as express from "express";
import { Request, Response, NextFunction } from "express";
import * as fs from "fs";
import * as path from "path";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import {
  LoggingInterceptor,
  TransformInterceptor,
  TimeoutInterceptor,
} from "./common/interceptors";

async function bootstrap() {
  const logger = new Logger("Bootstrap");

  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log", "debug", "verbose"],
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>("PORT", 3000);
  const nodeEnv = configService.get<string>("NODE_ENV", "development");
  const uploadDir =
    configService.get<string>("UPLOAD_DIR") ||
    configService.get<string>("UPLOAD_DEST") ||
    configService.get<string>("upload.destination") ||
    "./uploads";

  // Security Headers - متقدم
  app.use(
    helmet({
      contentSecurityPolicy: nodeEnv === "production" ? undefined : false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  // CORS - السماح لجميع المصادر
  app.enableCors({
    origin: true, // السماح لأي origin
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Idempotency-Key",
      "X-Request-ID",
      "Accept-Language",
      "Origin",
      "Accept",
    ],
    exposedHeaders: [
      "X-Request-ID",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
    ],
    credentials: true,
    maxAge: 86400, // 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // Global Validation Pipe - متقدم
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      disableErrorMessages: nodeEnv === "production",
      validationError: {
        target: false,
        value: false,
      },
    }),
  );

  // Global Exception Filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global Interceptors
  app.useGlobalInterceptors(
    new TimeoutInterceptor(),
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  // Static uploads serving (must be public and reachable)
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  
  // CORS middleware for static files (required for video playback on web)
  app.use("/uploads", (req: Request, res: Response, next: NextFunction) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Range, Content-Type");
    res.header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    res.header("Cross-Origin-Resource-Policy", "cross-origin");
    res.header("Cross-Origin-Embedder-Policy", "unsafe-none");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });
  
  app.use(
    "/uploads",
    express.static(path.resolve(uploadDir), {
      fallthrough: false,
    }),
  );

  // API Prefix and Versioning
  app.setGlobalPrefix("api");
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: "1",
  });

  // Swagger Documentation
  if (nodeEnv !== "production") {
    const config = new DocumentBuilder()
      .setTitle("Ali App API")
      .setDescription("Production-ready API for Ali App - Secure & Scalable")
      .setVersion("1.0")
      .addBearerAuth()
      .addServer(`http://localhost:${port}`, "Local Development")
      .addServer("http://167.235.64.220", "Production Server (Hetzner)")
      .addTag("auth", "Authentication & Authorization")
      .addTag("users", "User Management")
      .addTag("rooms", "Voice/Chat Rooms")
      .addTag("messages", "Real-time Messaging")
      .addTag("gifts", "Virtual Gifts System")
      .addTag("wallets", "Digital Wallet")
      .addTag("admin", "Admin Dashboard")
      .addTag("monitoring", "System Monitoring")
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api/docs", app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: "alpha",
        operationsSorter: "alpha",
      },
    });

    logger.log(
      `📚 Swagger docs available at http://localhost:${port}/api/docs`,
    );
  }

  // Graceful Shutdown
  app.enableShutdownHooks();

  // Start Server
  await app.listen(port, "0.0.0.0");

  logger.log(`🚀 Application is running on: http://localhost:${port}`);
  logger.log(`📊 Environment: ${nodeEnv}`);
  logger.log(
    `🔒 Security: ${nodeEnv === "production" ? "ENABLED" : "DEVELOPMENT MODE"}`,
  );
}

bootstrap().catch((err) => {
  console.error("❌ Failed to start application:", err);
  process.exit(1);
});
