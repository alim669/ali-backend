/**
 * Verification DTOs - نماذج بيانات التوثيق
 */

import { IsEnum, IsOptional, IsString } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { VerificationType } from "@prisma/client";

// Re-export Prisma's VerificationType to avoid type conflicts
export { VerificationType };

export class BuyVerificationDto {
  @ApiProperty({
    enum: VerificationType,
    description: "نوع التوثيق المراد شراؤه",
    example: VerificationType.BLUE,
  })
  @IsEnum(VerificationType)
  type: VerificationType;

  @ApiPropertyOptional({
    description: "مفتاح Idempotency لمنع الطلبات المكررة",
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class VerificationResponseDto {
  @ApiProperty({ description: "معرف التوثيق" })
  id: string;

  @ApiProperty({ description: "معرف المستخدم" })
  userId: string;

  @ApiProperty({ enum: VerificationType, description: "نوع التوثيق" })
  type: VerificationType;

  @ApiProperty({ description: "تاريخ انتهاء التوثيق" })
  expiresAt: Date;

  @ApiProperty({ description: "هل التوثيق فعال" })
  isActive: boolean;

  @ApiProperty({ description: "الأيام المتبقية" })
  daysRemaining: number;

  @ApiProperty({ description: "تاريخ الإنشاء" })
  createdAt: Date;
}

export class VerificationPackageDto {
  @ApiProperty({ description: "معرف الباقة" })
  id: string;

  @ApiProperty({ enum: VerificationType, description: "نوع التوثيق" })
  type: VerificationType;

  @ApiProperty({ description: "اسم الباقة" })
  name: string;

  @ApiProperty({ description: "الوصف" })
  description: string;

  @ApiProperty({ description: "السعر بالنقاط" })
  price: number;

  @ApiProperty({ description: "المدة بالأيام" })
  duration: number;

  @ApiProperty({ description: "لون الشارة (hex)" })
  color: string;

  @ApiProperty({ description: "المميزات" })
  features: string[];
}
