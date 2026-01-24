import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { ExploreService } from "./explore.service";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";

@ApiTags("explore")
@Controller("explore")
export class ExploreController {
  constructor(
    private readonly exploreService: ExploreService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // استخراج userId من التوكن اختيارياً
  private extractUserId(req: any): string | undefined {
    try {
      const authHeader = req.headers?.authorization;
      if (!authHeader?.startsWith("Bearer ")) return undefined;
      const token = authHeader.slice(7);
      const secret = this.configService.get<string>("JWT_SECRET");
      const payload = this.jwtService.verify(token, { secret });
      return payload?.sub || payload?.id;
    } catch {
      return undefined;
    }
  }

  @Get("posts")
  @Public()
  @ApiOperation({ summary: "قائمة المنشورات والريلز" })
  @ApiQuery({ name: "type", required: false, enum: ["all", "reels"] })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "offset", required: false, type: Number })
  @ApiQuery({ name: "country", required: false, type: String })
  @ApiQuery({ name: "locale", required: false, type: String })
  async getPosts(
    @Req() req: any,
    @Query("type") type?: "all" | "reels",
    @Query("limit") limit?: number,
    @Query("offset") offset?: number,
    @Query("country") country?: string,
    @Query("locale") locale?: string,
  ) {
    const viewerId = this.extractUserId(req);
    return this.exploreService.getPosts({
      type: type || "all",
      limit: Number(limit) || 20,
      offset: Number(offset) || 0,
      country: country || undefined,
      locale: locale || undefined,
      viewerId,
    });
  }

  @Get("trending")
  @Public()
  @ApiOperation({ summary: "الترندات" })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "country", required: false, type: String })
  @ApiQuery({ name: "locale", required: false, type: String })
  async getTrending(
    @Query("limit") limit?: number,
    @Query("country") country?: string,
    @Query("locale") locale?: string,
  ) {
    return this.exploreService.getTrending(
      Number(limit) || 20,
      country || undefined,
      locale || undefined,
    );
  }

  @Get("following")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "منشورات المتابَعين" })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "offset", required: false, type: Number })
  @ApiQuery({ name: "country", required: false, type: String })
  @ApiQuery({ name: "locale", required: false, type: String })
  async getFollowingPosts(
    @CurrentUser("id") userId: string,
    @Query("limit") limit?: number,
    @Query("offset") offset?: number,
    @Query("country") country?: string,
    @Query("locale") locale?: string,
  ) {
    return this.exploreService.getFollowingPosts({
      userId,
      limit: Number(limit) || 20,
      offset: Number(offset) || 0,
      country: country || undefined,
      locale: locale || undefined,
    });
  }

  @Post("posts")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "نشر محتوى" })
  async createPost(
    @CurrentUser("id") userId: string,
    @CurrentUser("username") username: string,
    @CurrentUser("displayName") displayName: string,
    @Body()
    body: {
      caption: string;
      tags?: string[];
      country?: string;
      locale?: string;
      durationSec?: number;
      aspectRatio?: number;
      isReel?: boolean;
      mediaUrl?: string;
      isVideo?: boolean;
      visibility?: "public" | "followers" | "private";
    },
  ) {
    return this.exploreService.createPost({
      userId,
      userName: displayName || username,
      userHandle: `@${username}`,
      caption: body.caption,
      tags: body.tags || [],
      country: body.country,
      locale: body.locale,
      durationSec: body.durationSec,
      aspectRatio: body.aspectRatio,
      isReel: body.isReel === true,
      mediaUrl: body.mediaUrl,
      isVideo: body.isVideo === true,
      visibility: body.visibility || "public",
    });
  }

  @Post("posts/:id/view")
  @Public()
  @ApiOperation({ summary: "تسجيل مشاهدة" })
  async trackView(@Param("id") postId: string) {
    return this.exploreService.trackView(postId);
  }

  @Put("posts/:id/admin")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN", "SUPER_ADMIN", "MODERATOR")
  @ApiBearerAuth()
  @ApiOperation({ summary: "تحديث منشور (Admin)" })
  async updatePost(
    @Param("id") postId: string,
    @Body() body: { isFeatured?: boolean; isHidden?: boolean },
  ) {
    return this.exploreService.updatePost(postId, {
      isFeatured: body.isFeatured,
      isHidden: body.isHidden,
    });
  }

  @Delete("posts/:id/admin")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN", "SUPER_ADMIN", "MODERATOR")
  @ApiBearerAuth()
  @ApiOperation({ summary: "حذف منشور (Admin)" })
  async deletePost(@Param("id") postId: string) {
    return this.exploreService.deletePost(postId);
  }

  @Post("posts/:id/react")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "إضافة تفاعل" })
  async react(
    @Param("id") postId: string,
    @Body() body: { reaction: "love" | "fire" | "wow" },
  ) {
    return this.exploreService.react(postId, body.reaction);
  }

  @Get("posts/:id/comments")
  @Public()
  @ApiOperation({ summary: "جلب التعليقات" })
  async getComments(@Param("id") postId: string) {
    return this.exploreService.getComments(postId);
  }

  @Post("posts/:id/comments")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "إضافة تعليق" })
  async addComment(
    @Param("id") postId: string,
    @CurrentUser("username") username: string,
    @CurrentUser("displayName") displayName: string,
    @Body() body: { text: string },
  ) {
    return this.exploreService.addComment(postId, {
      user: displayName || username,
      text: body.text,
    });
  }

  // ========== Bookmarks (الحفظ) ==========

  @Post("posts/:id/bookmark")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "حفظ/إلغاء حفظ منشور" })
  async toggleBookmark(
    @Param("id") postId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.exploreService.toggleBookmark(userId, postId);
  }

  @Get("bookmarks")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "قائمة المحفوظات" })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "offset", required: false, type: Number })
  async getBookmarks(
    @CurrentUser("id") userId: string,
    @Query("limit") limit?: number,
    @Query("offset") offset?: number,
  ) {
    return this.exploreService.getBookmarks(userId, Number(limit) || 20, Number(offset) || 0);
  }

  // ========== Statistics (الإحصائيات) ==========

  @Get("posts/:id/stats")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "إحصائيات منشور" })
  async getPostStats(@Param("id") postId: string) {
    return this.exploreService.getPostStats(postId);
  }

  @Get("my/stats")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "إحصائيات الناشر" })
  async getMyStats(@CurrentUser("id") userId: string) {
    return this.exploreService.getUserStats(userId);
  }

  // ========== My Posts (منشوراتي) ==========

  @Get("my/posts")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "منشوراتي" })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "offset", required: false, type: Number })
  async getMyPosts(
    @CurrentUser("id") userId: string,
    @Query("limit") limit?: number,
    @Query("offset") offset?: number,
  ) {
    return this.exploreService.getUserPosts(userId, Number(limit) || 20, Number(offset) || 0);
  }

  // ========== Share (المشاركة) ==========

  @Post("posts/:id/share")
  @Public()
  @ApiOperation({ summary: "تسجيل مشاركة" })
  async trackShare(@Param("id") postId: string) {
    return this.exploreService.trackShare(postId);
  }
}
