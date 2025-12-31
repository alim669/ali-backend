import { IsInt, IsOptional, IsString, Min, Max, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionType } from '@prisma/client';

export class DepositDto {
  @ApiProperty({ example: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000000)
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  transactionId?: string;
}

export class WithdrawDto {
  @ApiProperty({ example: 500 })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  withdrawMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountInfo?: string;
}

export class AdminAdjustBalanceDto {
  @ApiProperty({ example: 100, description: 'مبلغ موجب للإضافة، سالب للخصم' })
  @IsInt()
  amount: number;

  @ApiProperty({ example: 'مكافأة خاصة' })
  @IsString()
  reason: string;
}

export class TransactionQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({ enum: TransactionType })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiPropertyOptional()
  @IsOptional()
  startDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  endDate?: Date;
}
