import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsInt,
  IsObject,
  MinLength,
  MaxLength,
  Min,
  Max,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { RoomType, MemberRole } from "@prisma/client";

export class CreateRoomDto {
  @ApiProperty({ example: "غرفة الأصدقاء" })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ example: "غرفة للدردشة والمرح" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiPropertyOptional({ enum: RoomType, default: RoomType.PUBLIC })
  @IsOptional()
  @IsEnum(RoomType)
  type?: RoomType = RoomType.PUBLIC;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(1000)
  maxMembers?: number = 100;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(4)
  password?: string;

  @ApiPropertyOptional({ description: 'إعدادات إضافية للغرفة (مثل category)' })
  @IsOptional()
  @IsObject()
  settings?: Record<string, any>;
}

export class UpdateRoomDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(1000)
  maxMembers?: number;

  @ApiPropertyOptional({ description: 'إعدادات إضافية للغرفة' })
  @IsOptional()
  @IsObject()
  settings?: Record<string, any>;
}

export class JoinRoomDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  password?: string;
}

export class UpdateMemberDto {
  @ApiPropertyOptional({ enum: MemberRole })
  @IsOptional()
  @IsEnum(MemberRole)
  role?: MemberRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMuted?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  mutedUntil?: Date;
}

export class RoomQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: RoomType })
  @IsOptional()
  @IsEnum(RoomType)
  type?: RoomType;

  @ApiPropertyOptional({ description: 'Filter by category: chat, music, games, quran, entertainment' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string = "currentMembers";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortOrder?: "asc" | "desc" = "desc";
}

export class KickMemberDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ban?: boolean = false;

  @ApiPropertyOptional()
  @IsOptional()
  bannedUntil?: Date;
}
