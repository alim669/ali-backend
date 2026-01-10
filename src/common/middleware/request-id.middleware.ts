/**
 * Request ID Middleware - إضافة معرف فريد لكل طلب
 * يسهل تتبع الأخطاء والـ debugging
 */

import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // استخدام X-Request-ID الموجود أو إنشاء واحد جديد
    const requestId = (req.headers["x-request-id"] as string) || randomUUID();

    // إضافة إلى headers الطلب والرد
    req.headers["x-request-id"] = requestId;
    res.setHeader("X-Request-ID", requestId);

    next();
  }
}
