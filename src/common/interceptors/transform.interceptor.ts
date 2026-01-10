/**
 * Transform Interceptor - تنسيق موحد للردود
 * يضمن أن جميع الردود بنفس الشكل
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { Response } from "express";

export interface StandardResponse<T> {
  success: boolean;
  statusCode: number;
  message?: string;
  data: T;
  meta?: ResponseMeta;
}

export interface ResponseMeta {
  timestamp: string;
  requestId?: string;
  pagination?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, StandardResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<StandardResponse<T>> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    return next.handle().pipe(
      map((data) => {
        // إذا كان الرد يحتوي على pagination
        if (this.hasPagination(data)) {
          return this.formatPaginatedResponse(data, response, request);
        }

        // إذا كان الرد منسق مسبقاً
        if (this.isAlreadyFormatted(data)) {
          return data;
        }

        // تنسيق الرد العادي
        return {
          success: true,
          statusCode: response.statusCode,
          data,
          meta: {
            timestamp: new Date().toISOString(),
            requestId: request.headers["x-request-id"],
          },
        };
      }),
    );
  }

  private hasPagination(data: unknown): boolean {
    if (!data || typeof data !== "object") return false;
    const obj = data as Record<string, unknown>;
    return (
      "items" in obj &&
      "total" in obj &&
      Array.isArray(obj.items)
    );
  }

  private isAlreadyFormatted(data: unknown): boolean {
    if (!data || typeof data !== "object") return false;
    const obj = data as Record<string, unknown>;
    return "success" in obj && "statusCode" in obj;
  }

  private formatPaginatedResponse(
    data: unknown,
    response: Response,
    request: Request & { query: Record<string, string>; headers: Record<string, string | undefined> },
  ): StandardResponse<unknown[]> {
    const obj = data as {
      items: unknown[];
      total: number;
      page?: number;
      limit?: number;
    };

    const page = obj.page || parseInt(request.query.page || "1", 10);
    const limit = obj.limit || parseInt(request.query.limit || "20", 10);
    const totalPages = Math.ceil(obj.total / limit);

    return {
      success: true,
      statusCode: response.statusCode,
      data: obj.items,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: request.headers["x-request-id"] as string,
        pagination: {
          page,
          limit,
          total: obj.total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      },
    };
  }
}
