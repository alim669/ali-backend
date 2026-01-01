import {
  Controller,
  Get,
  Put,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
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
import { UploadService } from '../../common/upload/upload.service';

@ApiTags('users')
@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly uploadService: UploadService,
  ) {}

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

  @Post('avatar')
  @ApiOperation({ summary: 'رفع صورة الملف الشخصي' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @CurrentUser('id') userId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
          new FileTypeValidator({ fileType: /(jpg|jpeg|png|gif)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    const result = await this.uploadService.uploadAvatar(file, userId);
    await this.usersService.updateProfile(userId, { avatar: result.url });
    return { avatar: result.url };
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

  @Get('by-numeric-id/:numericId')
  @ApiOperation({ summary: 'الحصول على مستخدم بالمعرف الرقمي' })
  async findByNumericId(@Param('numericId') numericId: string) {
    return this.usersService.findByNumericId(numericId);
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
