import { IsInt, IsOptional, IsString, Min, Max, IsEnum } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { TransactionType } from "@prisma/client";

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

export class DeductDto {
  @ApiProperty({ example: 100, description: "المبلغ المراد خصمه" })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({
    example: "coins",
    description: "نوع العملة: coins أو diamonds",
  })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ example: "شراء شارة", description: "سبب الخصم" })
  @IsOptional()
  @IsString()
  reason?: string;
}

// 🔄 DTO للتحويل باستخدام الـ Custom ID (numericId)
export class TransferByCustomIdDto {
  @ApiProperty({ example: "100000001", description: "الـ ID الرقمي للمستلم" })
  @IsString()
  recipientCustomId: string;

  @ApiProperty({ example: 100, description: "المبلغ المراد تحويله" })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ example: "هدية", description: "ملاحظة للتحويل" })
  @IsOptional()
  @IsString()
  note?: string;
}

export class AdminAdjustBalanceDto {
  @ApiProperty({ example: 100, description: "مبلغ موجب للإضافة، سالب للخصم" })
  @IsInt()
  amount: number;

  @ApiProperty({ example: "مكافأة خاصة" })
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
