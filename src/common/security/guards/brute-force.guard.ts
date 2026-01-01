/**
 * Ali Backend - Brute Force Guard
 * حماية من هجمات القوة الغاشمة
 */
import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { SecurityService } from '../security.service';

@Injectable()
export class BruteForceGuard implements CanActivate {
  constructor(private readonly security: SecurityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const ip = this.getClientIp(request);
    const endpoint = `${request.method}:${request.route?.path || request.path}`;

    // Check rate limit for this endpoint
    const result = await this.security.checkRateLimit(
      `${ip}:${endpoint}`,
      30, // Max 30 requests
      60, // Per minute
    );

    if (!result.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'طلبات كثيرة جداً، يرجى الانتظار',
          retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Add rate limit headers
    const response = context.switchToHttp().getResponse();
    response.setHeader('X-RateLimit-Remaining', result.remaining);
    response.setHeader('X-RateLimit-Reset', result.resetAt);

    return true;
  }

  private getClientIp(request: any): string {
    return (
      request.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      request.headers['x-real-ip'] ||
      request.connection?.remoteAddress ||
      request.ip ||
      'unknown'
    );
  }
}
