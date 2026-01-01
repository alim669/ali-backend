import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Get,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  GoogleLoginDto,
  RefreshTokenDto,
  LogoutDto,
  ChangePasswordDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests per minute
  @ApiOperation({ summary: 'تسجيل مستخدم جديد بالبريد الإلكتروني' })
  @ApiResponse({ status: 201, description: 'تم التسجيل بنجاح' })
  @ApiResponse({ status: 409, description: 'البريد الإلكتروني أو اسم المستخدم موجود' })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const ipAddress = this.getClientIp(req);
    return this.authService.register(dto, ipAddress);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute
  @ApiOperation({ summary: 'تسجيل دخول بالبريد الإلكتروني' })
  @ApiResponse({ status: 200, description: 'تم تسجيل الدخول بنجاح' })
  @ApiResponse({ status: 401, description: 'بيانات الدخول غير صحيحة' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const ipAddress = this.getClientIp(req);
    return this.authService.login(dto, ipAddress);
  }

  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'تسجيل دخول بحساب Google' })
  @ApiResponse({ status: 200, description: 'تم تسجيل الدخول بنجاح' })
  @ApiResponse({ status: 401, description: 'Google token غير صالح' })
  async googleLogin(@Body() dto: GoogleLoginDto, @Req() req: Request) {
    const ipAddress = this.getClientIp(req);
    return this.authService.googleLogin(dto, ipAddress);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'تجديد Access Token' })
  @ApiResponse({ status: 200, description: 'تم التجديد بنجاح' })
  @ApiResponse({ status: 401, description: 'Refresh token غير صالح' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    const ipAddress = this.getClientIp(req);
    return this.authService.refreshTokens(dto, ipAddress);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'تسجيل خروج' })
  @ApiResponse({ status: 200, description: 'تم تسجيل الخروج' })
  async logout(@CurrentUser() user: any, @Body() dto: LogoutDto) {
    await this.authService.logout(user.id, dto.refreshToken, dto.logoutAll);
    return { message: 'تم تسجيل الخروج بنجاح' };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'تغيير كلمة المرور' })
  @ApiResponse({ status: 200, description: 'تم تغيير كلمة المرور' })
  async changePassword(@CurrentUser() user: any, @Body() dto: ChangePasswordDto) {
    await this.authService.changePassword(user.id, dto);
    return { message: 'تم تغيير كلمة المرور بنجاح' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'الحصول على بيانات المستخدم الحالي' })
  @ApiResponse({ status: 200, description: 'بيانات المستخدم' })
  async getMe(@CurrentUser() user: any) {
    return { user };
  }

  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || 'unknown';
  }
}
