/**
 * Ali Backend - Logging Interceptor
 * اعتراض لتسجيل جميع الطلبات
 */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap, catchError } from "rxjs/operators";
import { MonitoringService } from "../monitoring.service";

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  constructor(private readonly monitoring: MonitoringService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const { method, path, ip, user } = request;
    const startTime = Date.now();

    // Generate unique request ID
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    request.requestId = requestId;
    response.setHeader("X-Request-ID", requestId);

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        const statusCode = response.statusCode;

        // Log request
        this.logRequest(method, path, statusCode, duration, ip, user?.id);

        // Record metrics
        this.monitoring.recordRequest(
          method,
          path,
          statusCode,
          duration,
          user?.id,
        );
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;

        // Record error
        this.monitoring.recordError(method, path, error, user?.id);

        throw error;
      }),
    );
  }

  private logRequest(
    method: string,
    path: string,
    statusCode: number,
    duration: number,
    ip: string,
    userId?: string,
  ): void {
    const statusEmoji =
      statusCode < 400 ? "✅" : statusCode < 500 ? "⚠️" : "❌";
    const durationColor = duration < 100 ? "🟢" : duration < 500 ? "🟡" : "🔴";

    this.logger.log(
      `${statusEmoji} ${method} ${path} ${statusCode} ${durationColor}${duration}ms ${userId ? `[User: ${userId.slice(0, 8)}]` : ""} [${ip}]`,
    );
  }
}
