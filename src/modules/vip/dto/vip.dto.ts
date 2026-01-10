/**
 * VIP DTOs - أنواع البيانات لـ VIP
 */

import { IsNotEmpty, IsString, IsNumber, IsOptional, Min, Max } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class PurchaseVIPDto {
  @ApiProperty({
    description: "معرف باقة VIP",
    example: "weekly",
    enum: ["weekly", "monthly", "quarterly", "yearly"],
  })
  @IsString()
  @IsNotEmpty()
  packageId: string;
}

export class GrantVIPDto {
  @ApiProperty({
    description: "عدد أيام VIP",
    example: 30,
    minimum: 1,
    maximum: 365,
  })
  @IsNumber()
  @Min(1)
  @Max(365)
  days: number;

  @ApiPropertyOptional({
    description: "سبب المنح",
    example: "هدية للمستخدم النشط",
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class RevokeVIPDto {
  @ApiPropertyOptional({
    description: "سبب الإلغاء",
    example: "مخالفة للشروط",
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class VIPPackageResponseDto {
  @ApiProperty({ example: "weekly" })
  id: string;

  @ApiProperty({ example: "أسبوعي" })
  name: string;

  @ApiProperty({ example: "اشتراك VIP لمدة أسبوع" })
  description: string;

  @ApiProperty({ example: 7 })
  duration: number;

  @ApiProperty({ example: 100 })
  price: number;

  @ApiProperty({ example: ["إطارات حصرية", "أولوية في الدخول"] })
  features: string[];
}

export class VIPStatusResponseDto {
  @ApiProperty({ example: true })
  isVIP: boolean;

  @ApiProperty({ example: "2024-12-31T23:59:59.000Z", nullable: true })
  expiresAt: string | null;

  @ApiProperty({ example: 15, nullable: true })
  daysRemaining: number | null;
}
