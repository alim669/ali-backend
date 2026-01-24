/**
 * Winston Logger Service - خدمة التسجيل المتقدمة
 * تدعم تسجيل الأحداث في ملفات وconsole
 */

import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';
import * as path from 'path';

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

@Injectable()
export class LoggerService implements NestLoggerService {
  private logger: winston.Logger;
  private context?: string;

  constructor(private config: ConfigService) {
    this.initializeLogger();
  }

  private initializeLogger(): void {
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    const logLevel = this.config.get<string>('LOG_LEVEL', 'info');
    const fileEnabled = this.config.get<string>('LOG_FILE_ENABLED', 'true') === 'true';

    // Custom format for console
    const consoleFormat = printf(({ level, message, timestamp, context, ...meta }) => {
      const ctx = context ? `[${context}]` : '';
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `${timestamp} ${level} ${ctx} ${message}${metaStr}`;
    });

    // Transports array
    const transports: winston.transport[] = [
      new winston.transports.Console({
        format: combine(
          colorize({ all: !isProduction }),
          timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          consoleFormat,
        ),
      }),
    ];

    // Add file transports in production or if enabled
    if (fileEnabled) {
      const logsDir = path.join(process.cwd(), 'logs');

      // All logs
      transports.push(
        new winston.transports.File({
          filename: path.join(logsDir, 'combined.log'),
          format: combine(timestamp(), json()),
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5,
        }),
      );

      // Error logs
      transports.push(
        new winston.transports.File({
          filename: path.join(logsDir, 'error.log'),
          level: 'error',
          format: combine(timestamp(), errors({ stack: true }), json()),
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5,
        }),
      );

      // Security logs
      transports.push(
        new winston.transports.File({
          filename: path.join(logsDir, 'security.log'),
          level: 'warn',
          format: combine(
            winston.format((info) => {
              if (info.type === 'security') return info;
              return false;
            })(),
            timestamp(),
            json(),
          ),
          maxsize: 10 * 1024 * 1024,
          maxFiles: 10,
        }),
      );
    }

    this.logger = winston.createLogger({
      level: logLevel,
      transports,
      exceptionHandlers: fileEnabled
        ? [
            new winston.transports.File({
              filename: path.join(process.cwd(), 'logs', 'exceptions.log'),
            }),
          ]
        : undefined,
      rejectionHandlers: fileEnabled
        ? [
            new winston.transports.File({
              filename: path.join(process.cwd(), 'logs', 'rejections.log'),
            }),
          ]
        : undefined,
    });
  }

  setContext(context: string): this {
    this.context = context;
    return this;
  }

  log(message: any, ...optionalParams: any[]): void {
    const context = typeof optionalParams[0] === 'string' ? optionalParams[0] : this.context;
    const meta = typeof optionalParams[0] === 'object' ? optionalParams[0] : {};
    this.logger.info(message, { context, ...meta });
  }

  error(message: any, ...optionalParams: any[]): void {
    const trace = optionalParams[0];
    const context = optionalParams[1] || this.context;
    this.logger.error(message, { context, trace });
  }

  warn(message: any, ...optionalParams: any[]): void {
    const context = typeof optionalParams[0] === 'string' ? optionalParams[0] : this.context;
    const meta = typeof optionalParams[0] === 'object' ? optionalParams[0] : {};
    this.logger.warn(message, { context, ...meta });
  }

  debug(message: any, ...optionalParams: any[]): void {
    const context = typeof optionalParams[0] === 'string' ? optionalParams[0] : this.context;
    const meta = typeof optionalParams[0] === 'object' ? optionalParams[0] : {};
    this.logger.debug(message, { context, ...meta });
  }

  verbose(message: any, ...optionalParams: any[]): void {
    const context = typeof optionalParams[0] === 'string' ? optionalParams[0] : this.context;
    const meta = typeof optionalParams[0] === 'object' ? optionalParams[0] : {};
    this.logger.verbose(message, { context, ...meta });
  }

  // ================================
  // CUSTOM METHODS
  // ================================

  /**
   * تسجيل حدث أمني
   */
  security(message: string, meta?: Record<string, any>): void {
    this.logger.warn(message, { type: 'security', ...meta });
  }

  /**
   * تسجيل طلب HTTP
   */
  http(method: string, url: string, statusCode: number, duration: number, meta?: Record<string, any>): void {
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    this.logger.log(level, `${method} ${url} ${statusCode} ${duration}ms`, {
      type: 'http',
      method,
      url,
      statusCode,
      duration,
      ...meta,
    });
  }

  /**
   * تسجيل استعلام قاعدة بيانات بطيء
   */
  slowQuery(query: string, duration: number): void {
    this.logger.warn(`Slow query (${duration}ms): ${query.substring(0, 200)}...`, {
      type: 'database',
      duration,
    });
  }

  /**
   * تسجيل حدث WebSocket
   */
  websocket(event: string, userId?: string, meta?: Record<string, any>): void {
    this.logger.debug(`WS: ${event}`, {
      type: 'websocket',
      event,
      userId,
      ...meta,
    });
  }

  /**
   * تسجيل حدث أعمال
   */
  business(event: string, meta?: Record<string, any>): void {
    this.logger.info(`Business: ${event}`, {
      type: 'business',
      event,
      ...meta,
    });
  }
}
