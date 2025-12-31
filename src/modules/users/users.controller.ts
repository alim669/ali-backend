import {
  Controller,
  Get,
  Put,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import {
  UpdateProfileDto,
  UpdateUsernameDto,
  AdminUpdateUserDto,
  UserQueryDto,
} from './dto/users.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('users')
@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'الحصول على بيانات المستخدم الحالي' })
  async getMe(@CurrentUser('id') userId: string) {
    return this.usersService.findById(userId);
  }

  @Get('profile')
  @ApiOperation({ summary: 'الحصول على بيانات الملف الشخصي' })
  async getProfile(@CurrentUser('id') userId: string) {
    return this.usersService.findById(userId);
  }

  @Put('profile')
  @ApiOperation({ summary: 'تحديث الملف الشخصي' })
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  @Patch('username')
  @ApiOperation({ summary: 'تغيير اسم المستخدم' })
  async updateUsername(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateUsernameDto,
  ) {
    return this.usersService.updateUsername(userId, dto);
  }

  @Get('stats')
  @ApiOperation({ summary: 'الحصول على إحصائيات المستخدم' })
  async getStats(@CurrentUser('id') userId: string) {
    return this.usersService.getUserStats(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'الحصول على بيانات مستخدم بالمعرف' })
  async findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Get('username/:username')
  @ApiOperation({ summary: 'الحصول على مستخدم باسم المستخدم' })
  async findByUsername(@Param('username') username: string) {
    return this.usersService.findByUsername(username);
  }

  // ================================
  // ADMIN ENDPOINTS
  // ================================

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'قائمة المستخدمين (مسؤول)' })
  async findAll(@Query() query: UserQueryDto) {
    return this.usersService.findAll(query);
  }

  @Patch(':id/admin')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'تحديث مستخدم (مسؤول)' })
  async adminUpdate(
    @Param('id') id: string,
    @Body() dto: AdminUpdateUserDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.usersService.adminUpdate(id, dto, adminId);
  }

  @Patch(':id/ban')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'حظر مستخدم' })
  async banUser(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Body('reason') reason?: string,
  ) {
    return this.usersService.banUser(id, adminId, reason);
  }

  @Patch(':id/unban')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'رفع الحظر عن مستخدم' })
  async unbanUser(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.usersService.unbanUser(id, adminId);
  }
}
