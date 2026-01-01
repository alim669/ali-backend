import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { WalletsService } from './wallets.service';
import {
  DepositDto,
  WithdrawDto,
  DeductDto,
  AdminAdjustBalanceDto,
  TransactionQueryDto,
} from './dto/wallets.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('wallets')
@Controller('wallet')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get()
  @ApiOperation({ summary: 'الحصول على المحفظة' })
  async getWallet(@CurrentUser('id') userId: string) {
    return this.walletsService.getWallet(userId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'إحصائيات المحفظة' })
  async getStats(@CurrentUser('id') userId: string) {
    return this.walletsService.getStats(userId);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'سجل المعاملات' })
  async getTransactions(
    @CurrentUser('id') userId: string,
    @Query() query: TransactionQueryDto,
  ) {
    return this.walletsService.getTransactions(userId, query);
  }

  @Post('deposit')
  @ApiOperation({ summary: 'إيداع رصيد' })
  async deposit(
    @CurrentUser('id') userId: string,
    @Body() dto: DepositDto,
  ) {
    return this.walletsService.deposit(userId, dto);
  }

  @Post('withdraw')
  @ApiOperation({ summary: 'طلب سحب' })
  async withdraw(
    @CurrentUser('id') userId: string,
    @Body() dto: WithdrawDto,
  ) {
    return this.walletsService.withdraw(userId, dto);
  }

  @Post('deduct')
  @ApiOperation({ summary: 'خصم رصيد (للشراء من المتجر)' })
  async deduct(
    @CurrentUser('id') userId: string,
    @Body() dto: DeductDto,
  ) {
    return this.walletsService.deduct(userId, dto);
  }

  // ================================
  // ADMIN ENDPOINTS
  // ================================

  @Get(':userId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'محفظة مستخدم (مسؤول)' })
  async getUserWallet(@Param('userId') userId: string) {
    return this.walletsService.getWallet(userId);
  }

  @Post(':userId/adjust')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'تعديل رصيد مستخدم (مسؤول)' })
  async adjustBalance(
    @Param('userId') userId: string,
    @Body() dto: AdminAdjustBalanceDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.walletsService.adminAdjustBalance(userId, dto, adminId);
  }
}
