import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
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
import { RoomsService } from './rooms.service';
import {
  CreateRoomDto,
  UpdateRoomDto,
  JoinRoomDto,
  UpdateMemberDto,
  RoomQueryDto,
  KickMemberDto,
} from './dto/rooms.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('rooms')
@Controller('rooms')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  @ApiOperation({ summary: 'إنشاء غرفة جديدة' })
  async create(@Body() dto: CreateRoomDto, @CurrentUser('id') userId: string) {
    return this.roomsService.create(dto, userId);
  }

  @Get()
  @ApiOperation({ summary: 'قائمة الغرف' })
  async findAll(@Query() query: RoomQueryDto) {
    return this.roomsService.findAll(query);
  }

  @Get('my')
  @ApiOperation({ summary: 'غرفي' })
  async getMyRooms(@CurrentUser('id') userId: string) {
    return this.roomsService.getMyRooms(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل غرفة' })
  async findById(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.roomsService.findById(id, userId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'تحديث غرفة' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRoomDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.roomsService.update(id, dto, userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'حذف غرفة' })
  async delete(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.roomsService.delete(id, userId);
  }

  @Post(':id/join')
  @ApiOperation({ summary: 'الانضمام لغرفة' })
  async join(
    @Param('id') id: string,
    @Body() dto: JoinRoomDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.roomsService.join(id, userId, dto);
  }

  @Post(':id/leave')
  @ApiOperation({ summary: 'مغادرة غرفة' })
  async leave(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.roomsService.leave(id, userId);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'أعضاء الغرفة' })
  async getMembers(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.roomsService.getMembers(id, page, limit);
  }

  @Patch(':id/members/:memberId')
  @ApiOperation({ summary: 'تحديث عضو' })
  async updateMember(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.roomsService.updateMember(id, memberId, userId, dto);
  }

  @Post(':id/members/:memberId/kick')
  @ApiOperation({ summary: 'طرد عضو' })
  async kickMember(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() dto: KickMemberDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.roomsService.kickMember(id, memberId, userId, dto);
  }

  @Post(':id/transfer/:newOwnerId')
  @ApiOperation({ summary: 'نقل ملكية الغرفة' })
  async transferOwnership(
    @Param('id') id: string,
    @Param('newOwnerId') newOwnerId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.roomsService.transferOwnership(id, newOwnerId, userId);
  }
}
