/**
 * Admin DTOs - Data Transfer Objects for Admin Module
 */

import { IsString, IsOptional, IsNumber, IsEnum, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { UserStatus, UserRole } from '@prisma/client';

export class UserQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED'] })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ enum: ['USER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'] })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ default: 'createdAt' })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}

export class BanUserDto {
  @ApiProperty({ description: 'سبب الحظر' })
  @IsString()
  reason: string;
}

export class SuspendUserDto {
  @ApiProperty({ description: 'سبب التعليق' })
  @IsString()
  reason: string;

  @ApiProperty({ description: 'مدة التعليق بالساعات', default: 24 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(720) // Max 30 days
  duration: number = 24;
}

export class UpdateRoleDto {
  @ApiProperty({ enum: ['USER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'] })
  @IsEnum(UserRole)
  role: UserRole;
}

export class AdjustBalanceDto {
  @ApiProperty({ description: 'المبلغ (موجب للإضافة، سالب للخصم)' })
  @Type(() => Number)
  @IsNumber()
  amount: number;

  @ApiProperty({ description: 'سبب التعديل' })
  @IsString()
  reason: string;
}

export class CloseRoomDto {
  @ApiProperty({ description: 'سبب إغلاق الغرفة' })
  @IsString()
  reason: string;
}

export class ResolveReportDto {
  @ApiProperty({ description: 'نتيجة البلاغ' })
  @IsString()
  resolution: string;

  @ApiProperty({ enum: ['RESOLVED', 'DISMISSED'] })
  @IsString()
  status: 'RESOLVED' | 'DISMISSED';
}
