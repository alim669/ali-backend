/**
 * Global Exception Filter - معالجة جميع الأخطاء
 * يوفر استجابات موحدة ومُنسقة لجميع الأخطاء
 */

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";
import { Prisma } from "@prisma/client";

export interface ErrorResponse {
  success: false;
  statusCode: number;
  message: string;
  error: string;
  timestamp: string;
  path: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, message, error, details } =
      this.extractErrorInfo(exception);

    const errorResponse: ErrorResponse = {
      success: false,
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId: request.headers["x-request-id"] as string,
    };

    // إضافة تفاصيل في بيئة التطوير فقط
    if (process.env.NODE_ENV !== "production" && details) {
      errorResponse.details = details;
    }

    // تسجيل الخطأ
    this.logError(exception, request, statusCode);

    response.status(statusCode).json(errorResponse);
  }

  private extractErrorInfo(exception: unknown): {
    statusCode: number;
    message: string;
    error: string;
    details?: Record<string, unknown>;
  } {
    // HttpException (NestJS errors)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === "object" && response !== null) {
        const res = response as Record<string, unknown>;
        return {
          statusCode: status,
          message: (res.message as string) || exception.message,
          error: (res.error as string) || HttpStatus[status],
          details: res.details as Record<string, unknown>,
        };
      }

      return {
        statusCode: status,
        message: exception.message,
        error: HttpStatus[status],
      };
    }

    // Prisma Errors
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.handlePrismaError(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: "خطأ في بيانات الإدخال",
        error: "Validation Error",
      };
    }

    // Database connection errors
    if (
      exception instanceof Prisma.PrismaClientInitializationError ||
      exception instanceof Prisma.PrismaClientRustPanicError
    ) {
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: "خطأ في الاتصال بقاعدة البيانات",
        error: "Database Error",
      };
    }

    // Generic Error
    if (exception instanceof Error) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message:
          process.env.NODE_ENV === "production"
            ? "حدث خطأ داخلي"
            : exception.message,
        error: "Internal Server Error",
        details:
          process.env.NODE_ENV !== "production"
            ? { stack: exception.stack }
            : undefined,
      };
    }

    // Unknown error
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "حدث خطأ غير متوقع",
      error: "Unknown Error",
    };
  }

  private handlePrismaError(
    exception: Prisma.PrismaClientKnownRequestError,
  ): {
    statusCode: number;
    message: string;
    error: string;
  } {
    switch (exception.code) {
      case "P2002":
        // Unique constraint violation
        const target = (exception.meta?.target as string[]) || [];
        return {
          statusCode: HttpStatus.CONFLICT,
          message: `القيمة موجودة مسبقاً: ${target.join(", ")}`,
          error: "Duplicate Entry",
        };

      case "P2003":
        // Foreign key constraint failed
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: "مرجع غير صالح",
          error: "Invalid Reference",
        };

      case "P2025":
        // Record not found
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: "العنصر غير موجود",
          error: "Not Found",
        };

      case "P2014":
        // Required relation violation
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: "علاقة مطلوبة مفقودة",
          error: "Missing Relation",
        };

      case "P2016":
        // Query interpretation error
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: "استعلام غير صالح",
          error: "Query Error",
        };

      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: `خطأ في قاعدة البيانات: ${exception.code}`,
          error: "Database Error",
        };
    }
  }

  private logError(
    exception: unknown,
    request: Request,
    statusCode: number,
  ): void {
    const errorLog = {
      method: request.method,
      url: request.url,
      statusCode,
      userId: (request as Request & { user?: { id: string } }).user?.id,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    };

    if (statusCode >= 500) {
      this.logger.error(
        `Internal Error: ${JSON.stringify(errorLog)}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (statusCode >= 400) {
      this.logger.warn(`Client Error: ${JSON.stringify(errorLog)}`);
    }
  }
}
