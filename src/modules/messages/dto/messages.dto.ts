import {
  IsString,
  IsOptional,
  IsEnum,
  MaxLength,
  IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageType } from '@prisma/client';

export class SendMessageDto {
  @ApiProperty({ example: 'مرحباً بالجميع!' })
  @IsString()
  @MaxLength(5000)
  content: string;

  @ApiPropertyOptional({ enum: MessageType, default: MessageType.TEXT })
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType = MessageType.TEXT;

  @ApiPropertyOptional({ description: 'بيانات إضافية (للصور/الصوت/الفيديو)' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class MessageQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  limit?: number = 50;

  @ApiPropertyOptional({ description: 'قبل هذا التاريخ' })
  @IsOptional()
  before?: Date;

  @ApiPropertyOptional({ description: 'بعد هذا التاريخ' })
  @IsOptional()
  after?: Date;

  @ApiPropertyOptional({ enum: MessageType })
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;
}
