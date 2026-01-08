import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsUUID,
  Min,
  Max,
  MaxLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { GiftType } from "@prisma/client";

export class CreateGiftDto {
  @ApiProperty({ example: "وردة حمراء" })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: "وردة جميلة تعبر عن الحب" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ enum: GiftType, default: GiftType.STANDARD })
  @IsEnum(GiftType)
  type: GiftType;

  @ApiProperty({ example: "https://cdn.example.com/gifts/rose.png" })
  @IsString()
  imageUrl: string;

  @ApiPropertyOptional({ example: "https://cdn.example.com/gifts/rose.json" })
  @IsOptional()
  @IsString()
  animationUrl?: string;

  @ApiPropertyOptional({ example: "https://cdn.example.com/gifts/rose.mp4" })
  @IsOptional()
  @IsString()
  videoUrl?: string;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(1)
  price: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number = 0;
}

export class UpdateGiftDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  animationUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  videoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  isActive?: boolean;
}

export class SendGiftDto {
  @ApiProperty({ description: "معرف الهدية" })
  @IsString()
  giftId: string;

  @ApiProperty({ description: "معرف المستلم" })
  @IsUUID()
  receiverId: string;

  @ApiPropertyOptional({ description: "معرف الغرفة (اختياري)" })
  @IsOptional()
  @IsUUID()
  roomId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  quantity?: number = 1;

  @ApiPropertyOptional({ example: "هدية من القلب!" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;
}

export class GiftQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  limit?: number = 50;

  @ApiPropertyOptional({ enum: GiftType })
  @IsOptional()
  @IsEnum(GiftType)
  type?: GiftType;

  @ApiPropertyOptional()
  @IsOptional()
  isActive?: boolean = true;
}
