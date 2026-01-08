/**
 * Ali Backend - Security Middleware
 * وسيط الأمان الشامل
 */
import { Injectable, NestMiddleware, Logger } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { SecurityService } from "../security.service";

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SecurityMiddleware.name);

  constructor(private readonly security: SecurityService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const ip = this.getClientIp(req);
    const startTime = Date.now();

    // Check if IP is blocked
    if (await this.security.isIpBlocked(ip)) {
      return res.status(403).json({
        statusCode: 403,
        message: "تم حظر عنوان IP الخاص بك مؤقتاً",
      });
    }

    // Add security headers
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.removeHeader("X-Powered-By");

    // Log suspicious patterns
    this.detectSuspiciousPatterns(req, ip);

    // Continue processing
    res.on("finish", () => {
      const duration = Date.now() - startTime;

      // Log slow requests
      if (duration > 5000) {
        this.logger.warn(
          `⚠️ Slow request: ${req.method} ${req.path} - ${duration}ms`,
        );
      }

      // Log failed auth attempts
      if (res.statusCode === 401 && req.path.includes("/auth/")) {
        this.security.recordFailedLogin(ip, req.body?.email);
      }
    });

    next();
  }

  private getClientIp(req: Request): string {
    return (
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      (req.headers["x-real-ip"] as string) ||
      req.socket?.remoteAddress ||
      "unknown"
    );
  }

  private detectSuspiciousPatterns(req: Request, ip: string): void {
    const suspiciousPatterns = [
      /\.\.\//, // Path traversal
      /<script/i, // XSS
      /union.*select/i, // SQL injection
      /eval\(/i, // Code injection
      /exec\(/i, // Command injection
      /\$\{/, // Template injection
    ];

    const checkValue = `${req.path}${JSON.stringify(req.query)}${JSON.stringify(req.body)}`;

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(checkValue)) {
        this.security.logSecurityEvent({
          type: "SUSPICIOUS_REQUEST",
          ip,
          severity: "high",
          details: {
            path: req.path,
            method: req.method,
            pattern: pattern.source,
          },
        });
        break;
      }
    }
  }
}
