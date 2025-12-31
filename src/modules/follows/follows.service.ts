/**
 * Follows Service - خدمة المتابعة
 */

import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class FollowsService {
  private readonly logger = new Logger(FollowsService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => NotificationsService))
    private notificationsService: NotificationsService,
  ) {}

  // ================================
  // FOLLOW USER
  // ================================

  async follow(followerId: string, followingId: string) {
    // Can't follow yourself
    if (followerId === followingId) {
      throw new BadRequestException('لا يمكنك متابعة نفسك');
    }

    // Check if user exists
    const targetUser = await this.prisma.user.findUnique({
      where: { id: followingId },
      select: { id: true, username: true, displayName: true },
    });

    if (!targetUser) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    // Check if already following
    const existing = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId },
      },
    });

    if (existing) {
      throw new ConflictException('أنت تتابع هذا المستخدم بالفعل');
    }

    // Create follow
    const follow = await this.prisma.follow.create({
      data: { followerId, followingId },
      include: {
        following: {
          select: { id: true, username: true, displayName: true, avatar: true },
        },
      },
    });

    // Get follower info for notification
    const follower = await this.prisma.user.findUnique({
      where: { id: followerId },
      select: { displayName: true },
    });

    // Send notification
    await this.notificationsService.notifyNewFollower(
      followingId,
      follower?.displayName || 'مستخدم',
      followerId,
    );

    this.logger.log(`User ${followerId} followed ${followingId}`);

    return {
      message: 'تمت المتابعة بنجاح',
      following: follow.following,
    };
  }

  // ================================
  // UNFOLLOW USER
  // ================================

  async unfollow(followerId: string, followingId: string) {
    const existing = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId },
      },
    });

    if (!existing) {
      throw new NotFoundException('أنت لا تتابع هذا المستخدم');
    }

    await this.prisma.follow.delete({
      where: {
        followerId_followingId: { followerId, followingId },
      },
    });

    this.logger.log(`User ${followerId} unfollowed ${followingId}`);

    return { message: 'تم إلغاء المتابعة' };
  }

  // ================================
  // CHECK IF FOLLOWING
  // ================================

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const follow = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId },
      },
    });
    return !!follow;
  }

  // ================================
  // GET FOLLOWERS
  // ================================

  async getFollowers(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [followers, total] = await Promise.all([
      this.prisma.follow.findMany({
        where: { followingId: userId },
        include: {
          follower: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.follow.count({ where: { followingId: userId } }),
    ]);

    return {
      data: followers.map(f => f.follower),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ================================
  // GET FOLLOWING
  // ================================

  async getFollowing(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [following, total] = await Promise.all([
      this.prisma.follow.findMany({
        where: { followerId: userId },
        include: {
          following: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.follow.count({ where: { followerId: userId } }),
    ]);

    return {
      data: following.map(f => f.following),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ================================
  // GET FOLLOW COUNTS
  // ================================

  async getFollowCounts(userId: string) {
    const [followersCount, followingCount] = await Promise.all([
      this.prisma.follow.count({ where: { followingId: userId } }),
      this.prisma.follow.count({ where: { followerId: userId } }),
    ]);

    return {
      followers: followersCount,
      following: followingCount,
    };
  }
}
