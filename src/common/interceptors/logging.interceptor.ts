/**
 * Logging Interceptor - تسجيل جميع الطلبات والردود
 * يوفر رؤية كاملة لأداء الـ API
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { Request, Response } from "express";

interface RequestLog {
  method: string;
  url: string;
  userId?: string;
  ip?: string;
  userAgent?: string;
  contentLength?: number;
}

interface ResponseLog extends RequestLog {
  statusCode: number;
  duration: number;
  responseSize?: number;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request & { user?: { id: string } }>();
    const response = ctx.getResponse<Response>();

    const startTime = Date.now();
    const requestLog = this.createRequestLog(request);

    // تسجيل بداية الطلب في بيئة التطوير
    if (process.env.NODE_ENV !== "production") {
      this.logger.debug(`→ ${request.method} ${request.url}`);
    }

    return next.handle().pipe(
      tap({
        next: (data) => {
          this.logSuccess(requestLog, response, startTime, data);
        },
        error: () => {
          this.logError(requestLog, response, startTime);
        },
      }),
    );
  }

  private createRequestLog(
    request: Request & { user?: { id: string } },
  ): RequestLog {
    return {
      method: request.method,
      url: request.url,
      userId: request.user?.id,
      ip: this.getClientIp(request),
      userAgent: request.headers["user-agent"],
      contentLength: request.headers["content-length"]
        ? parseInt(request.headers["content-length"], 10)
        : undefined,
    };
  }

  private getClientIp(request: Request): string {
    const forwardedFor = request.headers["x-forwarded-for"];
    if (forwardedFor) {
      return Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor.split(",")[0].trim();
    }
    return request.ip || request.socket?.remoteAddress || "unknown";
  }

  private logSuccess(
    requestLog: RequestLog,
    response: Response,
    startTime: number,
    data: unknown,
  ): void {
    const duration = Date.now() - startTime;
    const statusCode = response.statusCode;

    const log: ResponseLog = {
      ...requestLog,
      statusCode,
      duration,
      responseSize: this.getResponseSize(data),
    };

    // تسجيل حسب مدة الاستجابة
    if (duration > 3000) {
      this.logger.warn(
        `⚠️ SLOW: ${log.method} ${log.url} - ${duration}ms`,
        JSON.stringify(log),
      );
    } else if (process.env.NODE_ENV !== "production" || duration > 1000) {
      this.logger.log(
        `← ${log.method} ${log.url} ${statusCode} ${duration}ms`,
      );
    }
  }

  private logError(
    requestLog: RequestLog,
    response: Response,
    startTime: number,
  ): void {
    const duration = Date.now() - startTime;
    const statusCode = response.statusCode;

    const log: ResponseLog = {
      ...requestLog,
      statusCode,
      duration,
    };

    this.logger.error(
      `✗ ${log.method} ${log.url} ${statusCode} ${duration}ms`,
      JSON.stringify(log),
    );
  }

  private getResponseSize(data: unknown): number | undefined {
    try {
      if (data === undefined || data === null) {
        return 0;
      }
      return JSON.stringify(data).length;
    } catch {
      return undefined;
    }
  }
}
