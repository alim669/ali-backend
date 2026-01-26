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
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { RoomsService } from "./rooms.service";
import {
  CreateRoomDto,
  UpdateRoomDto,
  JoinRoomDto,
  UpdateMemberDto,
  RoomQueryDto,
  KickMemberDto,
} from "./dto/rooms.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

@ApiTags("rooms")
@Controller("rooms")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  @ApiOperation({ summary: "إنشاء غرفة جديدة" })
  async create(@Body() dto: CreateRoomDto, @CurrentUser("id") userId: string) {
    return this.roomsService.create(dto, userId);
  }

  @Get()
  @ApiOperation({ summary: "قائمة الغرف" })
  async findAll(@Query() query: RoomQueryDto) {
    return this.roomsService.findAll(query);
  }

  @Get("my")
  @ApiOperation({ summary: "غرفي" })
  async getMyRooms(@CurrentUser("id") userId: string) {
    return this.roomsService.getMyRooms(userId);
  }

  @Get("by-numeric-id/:numericId")
  @ApiOperation({ summary: "البحث عن غرفة بالرقم التعريفي" })
  async findByNumericId(
    @Param("numericId") numericId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.findByNumericId(parseInt(numericId, 10), userId);
  }

  @Get(":id")
  @ApiOperation({ summary: "تفاصيل غرفة" })
  async findById(@Param("id") id: string, @CurrentUser("id") userId: string) {
    return this.roomsService.findById(id, userId);
  }

  @Put(":id")
  @ApiOperation({ summary: "تحديث غرفة" })
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateRoomDto,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.update(id, dto, userId);
  }

  @Delete(":id")
  @ApiOperation({ summary: "حذف غرفة" })
  async delete(@Param("id") id: string, @CurrentUser("id") userId: string) {
    return this.roomsService.delete(id, userId);
  }

  @Post(":id/join")
  @ApiOperation({ summary: "الانضمام لغرفة" })
  async join(
    @Param("id") id: string,
    @Body() dto: JoinRoomDto,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.join(id, userId, dto);
  }

  @Post(":id/leave")
  @ApiOperation({ summary: "مغادرة غرفة" })
  async leave(@Param("id") id: string, @CurrentUser("id") userId: string) {
    return this.roomsService.leave(id, userId);
  }

  @Get(":id/members")
  @ApiOperation({ summary: "أعضاء الغرفة" })
  async getMembers(
    @Param("id") id: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    return this.roomsService.getMembers(id, page, limit);
  }

  @Patch(":id/members/:memberId")
  @ApiOperation({ summary: "تحديث عضو" })
  async updateMember(
    @Param("id") id: string,
    @Param("memberId") memberId: string,
    @Body() dto: UpdateMemberDto,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.updateMember(id, memberId, userId, dto);
  }

  @Post(":id/members/:memberId/kick")
  @ApiOperation({ summary: "طرد عضو" })
  async kickMember(
    @Param("id") id: string,
    @Param("memberId") memberId: string,
    @Body() dto: KickMemberDto,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.kickMember(id, memberId, userId, dto);
  }

  // ================================
  // SIMPLIFIED KICK/BAN/LOCK ENDPOINTS
  // ================================

  @Post(":id/kick")
  @ApiOperation({ summary: "طرد عضو (مبسط)" })
  async kickMemberSimple(
    @Param("id") id: string,
    @Body("userId") targetUserId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.kickMember(id, targetUserId, userId, { ban: false });
  }

  @Post(":id/ban")
  @ApiOperation({ summary: "حظر عضو" })
  async banMember(
    @Param("id") id: string,
    @Body("userId") targetUserId: string,
    @Body("duration") duration: number | undefined,
    @CurrentUser("id") userId: string,
  ) {
    const bannedUntil = duration 
      ? new Date(Date.now() + duration * 60 * 1000) // duration in minutes
      : undefined;
    return this.roomsService.kickMember(id, targetUserId, userId, { 
      ban: true, 
      bannedUntil 
    });
  }

  @Post(":id/unban")
  @ApiOperation({ summary: "إلغاء حظر عضو" })
  async unbanMember(
    @Param("id") id: string,
    @Body("userId") targetUserId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.unbanMember(id, targetUserId, userId);
  }

  @Post(":id/mute")
  @ApiOperation({ summary: "كتم عضو" })
  async muteMember(
    @Param("id") id: string,
    @Body("userId") targetUserId: string,
    @Body("duration") duration: number | undefined,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.muteMember(id, targetUserId, userId, duration);
  }

  @Post(":id/unmute")
  @ApiOperation({ summary: "إلغاء كتم عضو" })
  async unmuteMember(
    @Param("id") id: string,
    @Body("userId") targetUserId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.unmuteMember(id, targetUserId, userId);
  }

  @Post(":id/lock")
  @ApiOperation({ summary: "قفل الغرفة (المالك فقط)" })
  async lockRoom(
    @Param("id") id: string,
    @Body("password") password: string | undefined,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.lockRoom(id, userId, password);
  }

  @Post(":id/unlock")
  @ApiOperation({ summary: "فتح الغرفة (المالك فقط)" })
  async unlockRoom(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.unlockRoom(id, userId);
  }

  @Post(":id/promote")
  @ApiOperation({ summary: "تصعيد عضو لمشرف" })
  async promoteToAdmin(
    @Param("id") id: string,
    @Body("userId") targetUserId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.updateMember(id, targetUserId, userId, { role: 'ADMIN' as any });
  }

  @Post(":id/demote")
  @ApiOperation({ summary: "إنزال مشرف لعضو عادي" })
  async demoteToMember(
    @Param("id") id: string,
    @Body("userId") targetUserId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.updateMember(id, targetUserId, userId, { role: 'MEMBER' as any });
  }

  @Post(":id/transfer/:newOwnerId")
  @ApiOperation({ summary: "نقل ملكية الغرفة" })
  async transferOwnership(
    @Param("id") id: string,
    @Param("newOwnerId") newOwnerId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.transferOwnership(id, newOwnerId, userId);
  }

  // ================================
  // MIC SLOTS API
  // ================================

  @Get(":id/mic-slots")
  @ApiOperation({ summary: "الحصول على حالة المايكات" })
  async getMicSlots(@Param("id") id: string) {
    return this.roomsService.getMicSlots(id);
  }

  @Post(":id/mic-slots/:slotIndex/enter")
  @ApiOperation({ summary: "حجز مايك" })
  async enterMicSlot(
    @Param("id") id: string,
    @Param("slotIndex") slotIndex: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.enterMicSlot(id, parseInt(slotIndex, 10), userId);
  }

  @Post(":id/mic-slots/:slotIndex/leave")
  @ApiOperation({ summary: "مغادرة المايك" })
  async leaveMicSlot(
    @Param("id") id: string,
    @Param("slotIndex") slotIndex: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.leaveMicSlot(id, parseInt(slotIndex, 10), userId);
  }

  @Post(":id/mic-slots/:slotIndex/lock")
  @ApiOperation({ summary: "قفل المايك (للمالك فقط)" })
  async lockMicSlot(
    @Param("id") id: string,
    @Param("slotIndex") slotIndex: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.lockMicSlot(id, parseInt(slotIndex, 10), userId);
  }

  @Post(":id/mic-slots/:slotIndex/unlock")
  @ApiOperation({ summary: "فتح المايك (للمالك فقط)" })
  async unlockMicSlot(
    @Param("id") id: string,
    @Param("slotIndex") slotIndex: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.unlockMicSlot(id, parseInt(slotIndex, 10), userId);
  }

  @Post(":id/mic-slots/:slotIndex/mute")
  @ApiOperation({ summary: "كتم مستخدم على المايك (للمالك فقط)" })
  async muteMicSlot(
    @Param("id") id: string,
    @Param("slotIndex") slotIndex: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.muteMicSlot(id, parseInt(slotIndex, 10), userId);
  }

  @Post(":id/mic-slots/:slotIndex/kick")
  @ApiOperation({ summary: "طرد مستخدم من المايك (للمالك والمشرف)" })
  async kickFromMicSlot(
    @Param("id") id: string,
    @Param("slotIndex") slotIndex: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.kickFromMicSlot(id, parseInt(slotIndex, 10), userId);
  }

  @Post(":id/mic-slots/:slotIndex/invite")
  @ApiOperation({ summary: "دعوة مستخدم للمايك (المالك/المشرف)" })
  async inviteToMicSlot(
    @Param("id") id: string,
    @Param("slotIndex") slotIndex: string,
    @Body("userId") targetUserId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.inviteToMicSlot(id, parseInt(slotIndex, 10), targetUserId, userId);
  }

  @Post(":id/mic-slots/lock-all")
  @ApiOperation({ summary: "قفل كل المايكات (المالك/المشرف)" })
  async lockAllMicSlots(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.lockAllMicSlots(id, userId);
  }

  @Post(":id/mic-slots/unlock-all")
  @ApiOperation({ summary: "فتح كل المايكات (المالك/المشرف)" })
  async unlockAllMicSlots(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.roomsService.unlockAllMicSlots(id, userId);
  }
}
