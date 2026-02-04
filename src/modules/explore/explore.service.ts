import {
  Injectable,
  Logger,
  BadRequestException,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "../../common/redis/redis.service";
import { PrismaService } from "../../common/prisma/prisma.service";
import * as fs from "fs";
import * as path from "path";
import { spawn, spawnSync } from "child_process";

// Types for visibility enum
type ExploreVisibilityType = "PUBLIC" | "FOLLOWERS" | "PRIVATE";

export interface ExplorePostData {
  id: string;
  userId: string;
  userName: string;
  userHandle: string;
  verificationType?: string;
  caption: string;
  tags: string[];
  country?: string;
  locale?: string;
  durationSec?: number;
  aspectRatio?: number;
  thumbnailUrl?: string;
  mediaVariants?: Record<string, string>;
  isReel: boolean;
  mediaUrl?: string;
  isVideo: boolean;
  createdAt: string;
  views: number;
  shares: number;
  reactions: Record<string, number>;
  commentsCount: number;
  isFeatured: boolean;
  isHidden: boolean;
  visibility: "public" | "followers" | "private";
}

export interface ExploreComment {
  id: string;
  user: string;
  text: string;
  createdAt: string;
}

@Injectable()
export class ExploreService implements OnModuleInit {
  private readonly logger = new Logger(ExploreService.name);
  private readonly trendingKey = "explore:trending";
  private readonly uploadDir: string;
  private readonly baseUrl: string;
  private readonly transcodeEnabled: boolean;
  private readonly ffmpegPath: string;
  private ffmpegAvailable?: boolean;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.uploadDir =
      this.configService.get<string>("UPLOAD_DIR") ||
      this.configService.get<string>("UPLOAD_DEST") ||
      this.configService.get<string>("upload.destination") ||
      "./uploads";
    this.baseUrl = this.configService.get<string>("BASE_URL", "");
    this.transcodeEnabled =
      this.configService.get<string>("EXPLORE_TRANSCODE_ENABLED", "true") !==
      "false";
    this.ffmpegPath = this.configService.get<string>("FFMPEG_PATH", "ffmpeg");
  }

  async onModuleInit() {
    try {
      const count = await (this.prisma as any).explorePost.count();
      this.logger.log(`✅ ExploreService initialized with PostgreSQL (${count} posts in database)`);
    } catch (error) {
      this.logger.warn(`⚠️ Database connection check failed: ${error}`);
    }
  }

  // ========== تحويل من نموذج Prisma إلى واجهة API ==========
  private toApiFormat(post: any): ExplorePostData {
    return {
      id: post.id,
      userId: post.userId,
      userName: post.userName,
      userHandle: post.userHandle,
      verificationType: post.user?.verification?.type || post.verificationType,
      caption: post.caption,
      tags: post.tags || [],
      country: post.country || "IQ",
      locale: post.locale || "ar",
      durationSec: post.durationSec || undefined,
      aspectRatio: post.aspectRatio || undefined,
      thumbnailUrl: post.thumbnailUrl || undefined,
      mediaVariants: undefined,
      isReel: post.isReel,
      mediaUrl: post.mediaUrl || undefined,
      isVideo: post.isVideo,
      createdAt: post.createdAt instanceof Date ? post.createdAt.toISOString() : post.createdAt,
      views: post.views,
      shares: post.shares,
      reactions: {
        love: post.lovesCount || 0,
        fire: post.firesCount || 0,
        wow: post.wowsCount || 0,
      },
      commentsCount: post.commentsCount,
      isFeatured: post.isFeatured,
      isHidden: post.isHidden,
      visibility: post.visibility.toLowerCase() as "public" | "followers" | "private",
    };
  }

  // ========== تحويل visibility ==========
  private toDbVisibility(visibility: string): ExploreVisibilityType {
    switch (visibility?.toLowerCase()) {
      case "followers":
        return "FOLLOWERS";
      case "private":
        return "PRIVATE";
      default:
        return "PUBLIC";
    }
  }

  // ========== إنشاء منشور جديد ==========
  async createPost(input: {
    userId: string;
    userName: string;
    userHandle: string;
    caption: string;
    tags: string[];
    country?: string;
    locale?: string;
    durationSec?: number;
    aspectRatio?: number;
    isReel: boolean;
    mediaUrl?: string;
    isVideo: boolean;
    visibility?: "public" | "followers" | "private";
  }) {
    if (input.isVideo && input.durationSec && input.durationSec > 30) {
      throw new BadRequestException("مدة الفيديو يجب ألا تتجاوز 30 ثانية");
    }

    // 🔧 تحقق: منشورات الفيديو تتطلب mediaUrl
    if (input.isVideo && (!input.mediaUrl || input.mediaUrl.trim() === '')) {
      throw new BadRequestException("يجب رفع الفيديو أولاً");
    }

    try {
      const post = await (this.prisma as any).explorePost.create({
        data: {
          userId: input.userId,
          userName: input.userName,
          userHandle: input.userHandle,
          caption: input.caption,
          tags: input.tags || [],
          country: input.country || "IQ",
          locale: input.locale || "ar",
          durationSec: input.durationSec,
          aspectRatio: input.aspectRatio,
          isReel: input.isReel,
          mediaUrl: input.mediaUrl,
          isVideo: input.isVideo,
          visibility: this.toDbVisibility(input.visibility || "public"),
        },
      });

      // مسح cache الترندات
      await this.redis.del(this.trendingKey);

      // جدولة معالجة الفيديو
      const apiPost = this.toApiFormat(post);
      this.scheduleVideoProcessing(apiPost);

      this.logger.log(`✅ تم إنشاء منشور جديد في قاعدة البيانات: ${post.id}`);
      return { success: true, data: apiPost };
    } catch (error) {
      this.logger.error(`❌ فشل إنشاء المنشور: ${error}`);
      throw new BadRequestException("فشل إنشاء المنشور");
    }
  }

  // ========== جلب المنشورات ==========
  async getPosts(params: {
    type: "all" | "reels";
    limit: number;
    offset: number;
    country?: string;
    locale?: string;
    viewerId?: string;
  }) {
    const { type, limit, offset, country, locale, viewerId } = params;

    // جلب قائمة المتابَعين للمشاهد
    let followingIds: string[] = [];
    if (viewerId) {
      try {
        const following = await (this.prisma as any).follow.findMany({
          where: { followerId: viewerId },
          select: { followingId: true },
        });
        followingIds = following.map((f: any) => f.followingId);
      } catch (e) {
        // تجاهل خطأ قاعدة البيانات
      }
    }

    // بناء شروط البحث
    const where: any = {
      isHidden: false,
      OR: [
        { visibility: "PUBLIC" },
        ...(viewerId
          ? [
              { userId: viewerId },
              {
                AND: [
                  { visibility: "FOLLOWERS" },
                  { userId: { in: followingIds.length > 0 ? followingIds : ["__none__"] } },
                ],
              },
            ]
          : []),
      ],
    };

    // إضافة فلترة الدولة واللغة
    if (country) {
      where.country = country;
    }
    if (locale) {
      where.locale = locale;
    }

    // إضافة فلترة Reels
    if (type === "reels") {
      where.isReel = true;
    }

    const posts = await (this.prisma as any).explorePost.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
      include: {
        user: {
          include: {
            verification: {
              select: { type: true }
            }
          }
        }
      }
    });

    const data = posts.map((post: any) => this.toApiFormat(post));
    return { success: true, data };
  }

  // ========== منشورات المتابَعين ==========
  async getFollowingPosts(params: {
    userId: string;
    limit: number;
    offset: number;
    country?: string;
    locale?: string;
  }) {
    const { userId, limit, offset, country, locale } = params;

    let followingIds: string[] = [];
    try {
      const following = await (this.prisma as any).follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      });
      followingIds = following.map((f: any) => f.followingId);
    } catch (e) {
      // تجاهل خطأ قاعدة البيانات
    }

    const allowedUserIds = [userId, ...followingIds];

    const where: any = {
      isHidden: false,
      userId: { in: allowedUserIds },
    };

    if (country) {
      where.country = country;
    }
    if (locale) {
      where.locale = locale;
    }

    const posts = await (this.prisma as any).explorePost.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
      include: {
        user: {
          include: {
            verification: {
              select: { type: true }
            }
          }
        }
      }
    });

    const data = posts.map((post: any) => this.toApiFormat(post));
    return { success: true, data };
  }

  // ========== الترندات ==========
  async getTrending(limit: number, country?: string, locale?: string) {
    // التحقق من الكاش أولاً
    const cacheKey = `${this.trendingKey}:${country || "all"}:${locale || "all"}`;
    const cached = await this.redis.getJson<ExplorePostData[]>(cacheKey);
    if (cached && cached.length > 0) {
      return { success: true, data: cached.slice(0, limit) };
    }

    const where: any = {
      isHidden: false,
      visibility: "PUBLIC",
    };

    if (country) {
      where.country = country;
    }
    if (locale) {
      where.locale = locale;
    }

    const posts = await (this.prisma as any).explorePost.findMany({
      where,
      orderBy: [
        { views: "desc" },
        { lovesCount: "desc" },
        { createdAt: "desc" },
      ],
      take: 100,
    });

    const data = posts.map((post: any) => this.toApiFormat(post));

    // حساب النقاط وترتيب
    const scored = data
      .map((post: ExplorePostData) => ({
        post,
        score: this.calculateScore(post),
      }))
      .sort((a: any, b: any) => b.score - a.score)
      .map((item: any) => item.post);

    // حفظ في الكاش لمدة دقيقة
    await this.redis.setJson(cacheKey, scored, 60);

    return { success: true, data: scored.slice(0, limit) };
  }

  // ========== تسجيل مشاهدة ==========
  async trackView(postId: string) {
    try {
      const post = await (this.prisma as any).explorePost.update({
        where: { id: postId },
        data: { views: { increment: 1 } },
      });
      await this.redis.del(this.trendingKey);
      return { success: true, data: post.views };
    } catch (error) {
      return { success: false, error: "NOT_FOUND" };
    }
  }

  // ========== تحديث منشور (Admin) ==========
  async updatePost(
    postId: string,
    input: { isFeatured?: boolean; isHidden?: boolean },
  ) {
    try {
      const post = await (this.prisma as any).explorePost.update({
        where: { id: postId },
        data: {
          ...(typeof input.isFeatured === "boolean" && {
            isFeatured: input.isFeatured,
          }),
          ...(typeof input.isHidden === "boolean" && {
            isHidden: input.isHidden,
          }),
        },
      });
      await this.redis.del(this.trendingKey);
      return { success: true, data: this.toApiFormat(post) };
    } catch (error) {
      return { success: false, error: "NOT_FOUND" };
    }
  }

  // ========== حذف منشور ==========
  async deletePost(postId: string) {
    try {
      await (this.prisma as any).explorePost.delete({
        where: { id: postId },
      });
      await this.redis.del(this.trendingKey);
      return { success: true };
    } catch (error) {
      return { success: false, error: "NOT_FOUND" };
    }
  }

  // ========== التفاعلات ==========
  async react(postId: string, reaction: "love" | "fire" | "wow") {
    try {
      const updateData: any = {};
      if (reaction === "love") {
        updateData.lovesCount = { increment: 1 };
      } else if (reaction === "fire") {
        updateData.firesCount = { increment: 1 };
      } else if (reaction === "wow") {
        updateData.wowsCount = { increment: 1 };
      }

      const post = await (this.prisma as any).explorePost.update({
        where: { id: postId },
        data: updateData,
      });

      await this.redis.del(this.trendingKey);

      return {
        success: true,
        data: {
          love: post.lovesCount,
          fire: post.firesCount,
          wow: post.wowsCount,
        },
      };
    } catch (error) {
      return { success: false, error: "NOT_FOUND" };
    }
  }

  // ========== التعليقات ==========
  async getComments(postId: string) {
    const comments = await (this.prisma as any).exploreComment.findMany({
      where: { postId },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            handle: true,
            photoUrl: true,
            verification: {
              select: { type: true }
            }
          }
        }
      }
    });

    const data = comments.map((c: any) => ({
      id: c.id,
      user: c.user?.displayName || c.userName || 'مستخدم',
      userName: c.user?.displayName || c.userName || 'مستخدم',
      text: c.text,
      createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
      userId: c.userId,
      userPhoto: c.user?.photoUrl || null,
      userHandle: c.user?.handle || null,
      isVerified: c.user?.verification?.type ? true : false,
      verificationType: c.user?.verification?.type || null,
    }));

    return { success: true, data };
  }

  async addComment(postId: string, input: { user: string; text: string; userId?: string }) {
    try {
      // التحقق من وجود المنشور
      const post = await (this.prisma as any).explorePost.findUnique({
        where: { id: postId },
      });
      if (!post) {
        return { success: false, error: "NOT_FOUND" };
      }

      const comment = await (this.prisma as any).exploreComment.create({
        data: {
          postId,
          userId: input.userId || post.userId,
          userName: input.user,
          text: input.text,
        },
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              handle: true,
              photoUrl: true,
              verification: {
                select: { type: true }
              }
            }
          }
        }
      });

      // تحديث عدد التعليقات
      await (this.prisma as any).explorePost.update({
        where: { id: postId },
        data: { commentsCount: { increment: 1 } },
      });

      return {
        success: true,
        data: {
          id: comment.id,
          user: comment.user?.displayName || comment.userName || 'مستخدم',
          userName: comment.user?.displayName || comment.userName || 'مستخدم',
          text: comment.text,
          createdAt: comment.createdAt instanceof Date ? comment.createdAt.toISOString() : comment.createdAt,
          userId: comment.userId,
          userPhoto: comment.user?.photoUrl || null,
          userHandle: comment.user?.handle || null,
          isVerified: comment.user?.verification?.type ? true : false,
          verificationType: comment.user?.verification?.type || null,
        },
      };
    } catch (error) {
      this.logger.error(`❌ فشل إضافة التعليق: ${error}`);
      return { success: false, error: "FAILED" };
    }
  }

  // ========== المحفوظات (Bookmarks) ==========
  async toggleBookmark(userId: string, postId: string) {
    try {
      // التحقق من وجود المنشور
      const post = await (this.prisma as any).explorePost.findUnique({
        where: { id: postId },
      });
      if (!post) {
        return { success: false, error: "NOT_FOUND" };
      }

      // التحقق من وجود bookmark
      const existing = await (this.prisma as any).exploreBookmark.findUnique({
        where: {
          userId_postId: { userId, postId },
        },
      });

      if (existing) {
        // حذف bookmark
        await (this.prisma as any).exploreBookmark.delete({
          where: { id: existing.id },
        });
        return { success: true, data: { bookmarked: false } };
      } else {
        // إضافة bookmark
        await (this.prisma as any).exploreBookmark.create({
          data: { userId, postId },
        });
        return { success: true, data: { bookmarked: true } };
      }
    } catch (error) {
      return { success: false, error: "FAILED" };
    }
  }

  async getBookmarks(userId: string, limit: number, offset: number) {
    const bookmarks = await (this.prisma as any).exploreBookmark.findMany({
      where: { userId },
      include: { post: true },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
    });

    const data = bookmarks
      .filter((b: any) => b.post && !b.post.isHidden)
      .map((b: any) => this.toApiFormat(b.post));

    return { success: true, data };
  }

  // ========== إحصائيات المنشور ==========
  async getPostStats(postId: string) {
    const post = await (this.prisma as any).explorePost.findUnique({
      where: { id: postId },
    });

    if (!post) {
      return { success: false, error: "NOT_FOUND" };
    }

    const totalReactions = post.lovesCount + post.firesCount + post.wowsCount;
    const engagement = totalReactions + post.commentsCount + post.shares;
    const engagementRate =
      post.views > 0 ? ((engagement / post.views) * 100).toFixed(2) : "0";

    return {
      success: true,
      data: {
        views: post.views,
        shares: post.shares,
        reactions: {
          love: post.lovesCount,
          fire: post.firesCount,
          wow: post.wowsCount,
          total: totalReactions,
        },
        comments: post.commentsCount,
        engagementRate: `${engagementRate}%`,
      },
    };
  }

  // ========== إحصائيات المستخدم ==========
  async getUserStats(userId: string) {
    const posts = await (this.prisma as any).explorePost.findMany({
      where: { userId, isHidden: false },
    });

    const postsCount = posts.length;
    const reelsCount = posts.filter((p: any) => p.isReel).length;
    const totalViews = posts.reduce((sum: number, p: any) => sum + p.views, 0);
    const totalShares = posts.reduce((sum: number, p: any) => sum + p.shares, 0);
    const totalReactions = posts.reduce(
      (sum: number, p: any) => sum + p.lovesCount + p.firesCount + p.wowsCount,
      0,
    );
    const totalComments = posts.reduce((sum: number, p: any) => sum + p.commentsCount, 0);

    const totalEngagement = totalReactions + totalComments + totalShares;
    const avgEngagement =
      totalViews > 0 ? ((totalEngagement / totalViews) * 100).toFixed(2) : "0";

    return {
      success: true,
      data: {
        postsCount,
        reelsCount,
        totalViews,
        totalShares,
        totalReactions,
        totalComments,
        avgEngagementRate: `${avgEngagement}%`,
      },
    };
  }

  // ========== منشورات المستخدم ==========
  async getUserPosts(userId: string, limit: number, offset: number) {
    const [posts, total] = await Promise.all([
      (this.prisma as any).explorePost.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      (this.prisma as any).explorePost.count({
        where: { userId },
      }),
    ]);

    const data = posts.map((post: any) => this.toApiFormat(post));
    return { success: true, data, total };
  }

  // ========== تتبع المشاركة ==========
  async trackShare(postId: string) {
    try {
      const post = await (this.prisma as any).explorePost.update({
        where: { id: postId },
        data: { shares: { increment: 1 } },
      });
      await this.redis.del(this.trendingKey);
      return { success: true, data: post.shares };
    } catch (error) {
      return { success: false, error: "NOT_FOUND" };
    }
  }

  // ========== مساعدات ==========
  private calculateScore(post: ExplorePostData) {
    const ageHours = Math.max(
      1,
      (Date.now() - new Date(post.createdAt).getTime()) / 3600000,
    );
    const reactionScore =
      (post.reactions.love || 0) * 2 +
      (post.reactions.fire || 0) * 2 +
      (post.reactions.wow || 0) * 1;
    const engagement =
      reactionScore + post.commentsCount * 2 + post.views * 0.1;
    return engagement / Math.pow(ageHours, 0.7);
  }

  // ========== معالجة الفيديو ==========
  private scheduleVideoProcessing(post: ExplorePostData) {
    if (!post.isVideo || !post.mediaUrl) return;
    if (!this.transcodeEnabled) return;

    setImmediate(async () => {
      try {
        const available = await this.isFfmpegAvailable();
        if (!available) return;
        await this.processVideo(post);
      } catch (error) {
        this.logger.warn(`Explore video processing skipped: ${error}`);
      }
    });
  }

  private async isFfmpegAvailable(): Promise<boolean> {
    if (typeof this.ffmpegAvailable === "boolean") return this.ffmpegAvailable;
    try {
      const result = spawnSync(this.ffmpegPath, ["-version"], {
        stdio: "ignore",
      });
      this.ffmpegAvailable = result.status === 0;
      if (!this.ffmpegAvailable) {
        this.logger.warn("FFmpeg not available, skipping transcode");
      }
    } catch {
      this.ffmpegAvailable = false;
      this.logger.warn("FFmpeg not available, skipping transcode");
    }
    return this.ffmpegAvailable;
  }

  private resolveUploadPath(mediaUrl: string) {
    const marker = "/uploads/";
    const index = mediaUrl.indexOf(marker);
    if (index === -1) return null;
    const relative = decodeURIComponent(mediaUrl.slice(index + marker.length))
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");
    const absolute = path.join(this.uploadDir, relative);
    const parsed = path.parse(relative);
    return { relative, absolute, parsed };
  }

  private buildPublicUrl(relativePath: string) {
    const base = this.baseUrl.replace(/\/+$/, "");
    const encoded = relativePath
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `${base}/uploads/${encoded}`;
  }

  private async ensureDir(target: string) {
    if (!fs.existsSync(target)) {
      await fs.promises.mkdir(target, { recursive: true });
    }
  }

  private runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.ffmpegPath, args, { stdio: "ignore" });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}`));
      });
    });
  }

  private async processVideo(post: ExplorePostData) {
    const resolved = this.resolveUploadPath(post.mediaUrl!);
    if (!resolved) return;
    if (!fs.existsSync(resolved.absolute)) return;

    const variantsDir = path.join(this.uploadDir, "explore", "variants");
    const thumbsDir = path.join(this.uploadDir, "explore", "thumbs");
    await this.ensureDir(variantsDir);
    await this.ensureDir(thumbsDir);

    const baseName = resolved.parsed.name;
    const out720 = path.join(variantsDir, `${baseName}_720p.mp4`);
    const out480 = path.join(variantsDir, `${baseName}_480p.mp4`);
    const outThumb = path.join(thumbsDir, `${baseName}_thumb.jpg`);

    if (!fs.existsSync(outThumb)) {
      await this.runFfmpeg([
        "-y",
        "-ss",
        "00:00:01",
        "-i",
        resolved.absolute,
        "-vframes",
        "1",
        "-vf",
        "scale=480:-1",
        outThumb,
      ]);
    }

    if (!fs.existsSync(out720)) {
      await this.runFfmpeg([
        "-y",
        "-i",
        resolved.absolute,
        "-vf",
        "scale=-2:720",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        out720,
      ]);
    }

    if (!fs.existsSync(out480)) {
      await this.runFfmpeg([
        "-y",
        "-i",
        resolved.absolute,
        "-vf",
        "scale=-2:480",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "24",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        out480,
      ]);
    }

    const thumbRel = path
      .relative(this.uploadDir, outThumb)
      .replace(/\\/g, "/");

    // تحديث المنشور في قاعدة البيانات
    await (this.prisma as any).explorePost.update({
      where: { id: post.id },
      data: {
        thumbnailUrl: this.buildPublicUrl(thumbRel),
      },
    });

    await this.redis.del(this.trendingKey);
  }
}
