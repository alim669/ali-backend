import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Headers,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from "@nestjs/swagger";
import { GiftsService } from "./gifts.service";
import {
  CreateGiftDto,
  UpdateGiftDto,
  SendGiftDto,
  GiftQueryDto,
} from "./dto/gifts.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { v4 as uuidv4 } from "uuid";

@ApiTags("gifts")
@Controller("gifts")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GiftsController {
  constructor(private readonly giftsService: GiftsService) {}

  @Get()
  @ApiOperation({ summary: "قائمة الهدايا" })
  async findAll(@Query() query: GiftQueryDto) {
    return this.giftsService.findAll(query);
  }

  @Get("sent")
  @ApiOperation({ summary: "الهدايا المرسلة" })
  async getSentGifts(
    @CurrentUser("id") userId: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    return this.giftsService.getSentGifts(userId, page, limit);
  }

  @Get("received")
  @ApiOperation({ summary: "الهدايا المستلمة" })
  async getReceivedGifts(
    @CurrentUser("id") userId: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    return this.giftsService.getReceivedGifts(userId, page, limit);
  }

  @Get("leaderboard/:type")
  @ApiOperation({ summary: "قائمة المتصدرين" })
  async getLeaderboard(
    @Param("type") type: "senders" | "receivers",
    @Query("limit") limit?: number,
  ) {
    return this.giftsService.getLeaderboard(type, limit);
  }

  @Get(":id")
  @ApiOperation({ summary: "تفاصيل هدية" })
  async findById(@Param("id") id: string) {
    return this.giftsService.findById(id);
  }

  @Post("send")
  @ApiOperation({ summary: "إرسال هدية" })
  @ApiHeader({
    name: "X-Idempotency-Key",
    description: "مفتاح فريد لمنع تكرار الإرسال",
    required: false,
  })
  async sendGift(
    @Body() dto: SendGiftDto,
    @CurrentUser("id") userId: string,
    @Headers("x-idempotency-key") idempotencyKey?: string,
  ) {
    // Generate idempotency key if not provided
    const key =
      idempotencyKey ||
      `${userId}-${dto.giftId}-${dto.receiverId}-${Date.now()}-${uuidv4()}`;
    return this.giftsService.sendGift(userId, dto, key);
  }

  // ================================
  // ADMIN ENDPOINTS
  // ================================

  @Post()
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "SUPER_ADMIN")
  @ApiOperation({ summary: "إنشاء هدية (مسؤول)" })
  async create(@Body() dto: CreateGiftDto) {
    return this.giftsService.create(dto);
  }

  @Put(":id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "SUPER_ADMIN")
  @ApiOperation({ summary: "تحديث هدية (مسؤول)" })
  async update(@Param("id") id: string, @Body() dto: UpdateGiftDto) {
    return this.giftsService.update(id, dto);
  }

  @Delete(":id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "SUPER_ADMIN")
  @ApiOperation({ summary: "حذف هدية (مسؤول)" })
  async delete(@Param("id") id: string) {
    return this.giftsService.delete(id);
  }
}
