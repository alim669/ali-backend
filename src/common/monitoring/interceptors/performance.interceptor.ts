/**
 * Ali Backend - Performance Interceptor
 * مراقبة الأداء وتحسينه
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

@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  private readonly logger = new Logger("Performance");
  private readonly SLOW_REQUEST_THRESHOLD = 3000; // 3 seconds

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        const memoryDiff = process.memoryUsage().heapUsed - startMemory;

        if (duration > this.SLOW_REQUEST_THRESHOLD) {
          this.logger.warn(
            `🐌 Slow request detected: ${request.method} ${request.path}`,
            {
              duration: `${duration}ms`,
              memoryChange: `${(memoryDiff / 1024 / 1024).toFixed(2)}MB`,
              query: request.query,
              user: request.user?.id,
            },
          );
        }

        // Log memory leaks
        if (memoryDiff > 50 * 1024 * 1024) {
          // 50MB
          this.logger.error(
            `💾 Possible memory leak: ${request.method} ${request.path}`,
            {
              memoryChange: `${(memoryDiff / 1024 / 1024).toFixed(2)}MB`,
            },
          );
        }
      }),
    );
  }
}
