import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');

  // Security Headers - متقدم
  app.use(helmet({
    contentSecurityPolicy: nodeEnv === 'production' ? undefined : false,
    crossOriginEmbedderPolicy: false,
  }));

  // CORS - إعدادات متقدمة
  const corsOrigins = configService.get<string>('CORS_ORIGINS', '*');
  app.enableCors({
    origin: corsOrigins === '*' ? true : corsOrigins.split(','),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Idempotency-Key',
      'X-Request-ID',
      'Accept-Language',
    ],
    exposedHeaders: ['X-Request-ID', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    credentials: true,
    maxAge: 86400, // 24 hours
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
      disableErrorMessages: nodeEnv === 'production',
      validationError: {
        target: false,
        value: false,
      },
    }),
  );

  // API Prefix and Versioning
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Swagger Documentation
  if (nodeEnv !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Ali App API')
      .setDescription('Production-ready API for Ali App - Secure & Scalable')
      .setVersion('1.0')
      .addBearerAuth()
      .addServer(`http://localhost:${port}`, 'Local Development')
      .addServer('http://64.226.115.148', 'Production Server')
      .addTag('auth', 'Authentication & Authorization')
      .addTag('users', 'User Management')
      .addTag('rooms', 'Voice/Chat Rooms')
      .addTag('messages', 'Real-time Messaging')
      .addTag('gifts', 'Virtual Gifts System')
      .addTag('wallets', 'Digital Wallet')
      .addTag('admin', 'Admin Dashboard')
      .addTag('monitoring', 'System Monitoring')
      .build();
    
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
    
    logger.log(`📚 Swagger docs available at http://localhost:${port}/api/docs`);
  }

  // Graceful Shutdown
  app.enableShutdownHooks();

  // Start Server
  await app.listen(port, '0.0.0.0');
  
  logger.log(`🚀 Application is running on: http://localhost:${port}`);
  logger.log(`📊 Environment: ${nodeEnv}`);
  logger.log(`🔒 Security: ${nodeEnv === 'production' ? 'ENABLED' : 'DEVELOPMENT MODE'}`);
}

bootstrap().catch((err) => {
  console.error('❌ Failed to start application:', err);
  process.exit(1);
});
