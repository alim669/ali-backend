/**
 * Ali Backend - IP Block Guard
 * حماية من IPs المحظورة
 */
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { SecurityService } from '../security.service';

@Injectable()
export class IpBlockGuard implements CanActivate {
  constructor(private readonly security: SecurityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const ip = this.getClientIp(request);

    if (await this.security.isIpBlocked(ip)) {
      throw new ForbiddenException('تم حظر عنوان IP الخاص بك مؤقتاً');
    }

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
