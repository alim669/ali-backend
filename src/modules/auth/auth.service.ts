import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import {
  RegisterDto,
  LoginDto,
  GoogleLoginDto,
  RefreshTokenDto,
  ChangePasswordDto,
} from './dto/auth.dto';
import { AuthProvider, UserStatus, Prisma } from '@prisma/client';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  type: 'access' | 'refresh';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResponse {
  user: {
    id: string;
    numericId: string; // ID الرقمي المتسلسل
    email: string;
    username: string;
    displayName: string;
    avatar: string | null;
    role: string;
    emailVerified: boolean;
  };
  tokens: TokenPair;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private googleClient: OAuth2Client;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    // Initialize Google OAuth client
    this.googleClient = new OAuth2Client(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
    );
  }

  // ================================
  // EMAIL REGISTRATION
  // ================================

  async register(dto: RegisterDto, ipAddress?: string): Promise<AuthResponse> {
    try {
      // Ensure database connection is alive
      await this.prisma.ensureConnection();
      
      // Check if email already exists
      const existingEmail = await this.prisma.user.findUnique({
        where: { email: dto.email.toLowerCase() },
      });

      if (existingEmail) {
        throw new ConflictException('البريد الإلكتروني مسجل بالفعل');
      }

      // Check if username already exists
      const existingUsername = await this.prisma.user.findUnique({
        where: { username: dto.username.toLowerCase() },
      });

      if (existingUsername) {
        throw new ConflictException('اسم المستخدم موجود بالفعل');
      }

      // Hash password with argon2
      const passwordHash = await argon2.hash(dto.password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      });

      // Create user with transaction
      const user = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Create user (numericId يتم توليده تلقائياً بواسطة PostgreSQL)
        const newUser = await tx.user.create({
          data: {
            email: dto.email.toLowerCase(),
            passwordHash,
            username: dto.username.toLowerCase(),
            displayName: dto.displayName,
            authProvider: AuthProvider.EMAIL,
            lastLoginAt: new Date(),
            lastLoginIp: ipAddress,
          },
        });

        // Create wallet for user
        await tx.wallet.create({
          data: {
            userId: newUser.id,
            balance: 0,
            diamonds: 0,
          },
        });

        return newUser;
      });

      // Generate tokens
      const tokens = await this.generateTokens(user, ipAddress);

      this.logger.log(`New user registered: ${user.email}`);

      return {
        user: {
          id: user.id,
          numericId: user.numericId.toString(),
          email: user.email,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar,
          role: user.role,
          emailVerified: user.emailVerified,
        },
        tokens,
      };
    } catch (error) {
      // Re-throw conflict errors (duplicate email/username)
      if (error instanceof ConflictException) {
        throw error;
      }
      
      // Handle unique constraint violation (P2002)
      if (error.code === 'P2002') {
        const target = error.meta?.target?.[0];
        if (target === 'email') {
          throw new ConflictException('البريد الإلكتروني مسجل بالفعل');
        } else if (target === 'username') {
          throw new ConflictException('اسم المستخدم موجود بالفعل');
        }
        throw new ConflictException('البيانات موجودة بالفعل');
      }
      
      // Handle database connection errors
      if (error.code === 'P1001' || error.message?.includes('Can\'t reach database server')) {
        this.logger.error('Database connection lost during registration');
        throw new InternalServerErrorException('خطأ في الاتصال بقاعدة البيانات. يرجى المحاولة مرة أخرى');
      }
      
      this.logger.error(`Registration error: ${error.message}`);
      throw new InternalServerErrorException('حدث خطأ أثناء إنشاء الحساب');
    }
  }

  // ================================
  // EMAIL LOGIN
  // ================================

  async login(dto: LoginDto, ipAddress?: string): Promise<AuthResponse> {
    try {
      // Ensure database connection is alive
      await this.prisma.ensureConnection();
      
      // Find user by email
      const user = await this.prisma.user.findUnique({
        where: { email: dto.email.toLowerCase() },
      });

      if (!user) {
        throw new UnauthorizedException('بيانات الدخول غير صحيحة');
      }

      // Check user status
      if (user.status === UserStatus.BANNED) {
        throw new UnauthorizedException('تم حظر هذا الحساب');
      }

      if (user.status === UserStatus.SUSPENDED) {
        throw new UnauthorizedException('هذا الحساب معلق مؤقتاً');
      }

      // Check if user has password (might be Google-only user)
      if (!user.passwordHash) {
        throw new UnauthorizedException('هذا الحساب مسجل عبر Google. يرجى تسجيل الدخول باستخدام Google');
      }

      // Verify password
      const isPasswordValid = await argon2.verify(user.passwordHash, dto.password);
      if (!isPasswordValid) {
        throw new UnauthorizedException('بيانات الدخول غير صحيحة');
      }

      // Update last login
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          lastLoginIp: ipAddress,
        },
      });

      // Generate tokens
      const tokens = await this.generateTokens(user, ipAddress, dto.deviceInfo);

      this.logger.log(`User logged in: ${user.email}`);

      return {
        user: {
          id: user.id,
          numericId: user.numericId.toString(),
          email: user.email,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar,
          role: user.role,
          emailVerified: user.emailVerified,
        },
        tokens,
      };
    } catch (error) {
      // Re-throw auth-related errors
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      
      // Handle database connection errors
      if (error.code === 'P1001' || error.message?.includes('Can\'t reach database server')) {
        this.logger.error('Database connection lost during login');
        throw new InternalServerErrorException('خطأ في الاتصال بقاعدة البيانات. يرجى المحاولة مرة أخرى');
      }
      
      this.logger.error(`Login error: ${error.message}`);
      throw new InternalServerErrorException('حدث خطأ أثناء تسجيل الدخول');
    }
  }

  // ================================
  // GOOGLE LOGIN
  // ================================

  async googleLogin(dto: GoogleLoginDto, ipAddress?: string): Promise<AuthResponse> {
    // Verify Google ID token
    let googlePayload;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: dto.idToken,
        audience: this.configService.get<string>('GOOGLE_CLIENT_ID'),
      });
      googlePayload = ticket.getPayload();
    } catch (error) {
      this.logger.error('Google token verification failed', error);
      throw new UnauthorizedException('Google token غير صالح');
    }

    if (!googlePayload || !googlePayload.email) {
      throw new UnauthorizedException('لم يتم الحصول على البريد الإلكتروني من Google');
    }

    const { email, sub: googleId, name, picture } = googlePayload;

    // Check if user exists by Google ID
    let user = await this.prisma.user.findUnique({
      where: { googleId },
    });

    if (!user) {
      // Check if user exists by email
      user = await this.prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (user) {
        // Link Google account to existing user
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            googleId,
            avatar: user.avatar || picture,
            emailVerified: true, // Google emails are verified
          },
        });
        this.logger.log(`Linked Google account to existing user: ${email}`);
      } else {
        // Create new user
        const username = await this.generateUniqueUsername(name || email.split('@')[0]);
        
        user = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          // Create user (numericId يتم توليده تلقائياً)
          const newUser = await tx.user.create({
            data: {
              email: email.toLowerCase(),
              googleId,
              username,
              displayName: name || username,
              avatar: picture,
              authProvider: AuthProvider.GOOGLE,
              emailVerified: true,
              lastLoginAt: new Date(),
              lastLoginIp: ipAddress,
            },
          });

          // Create wallet
          await tx.wallet.create({
            data: {
              userId: newUser.id,
              balance: 0,
              diamonds: 0,
            },
          });

          return newUser;
        });
        
        this.logger.log(`New Google user registered: ${email}`);
      }
    } else {
      // Check user status
      if (user.status === UserStatus.BANNED) {
        throw new UnauthorizedException('تم حظر هذا الحساب');
      }

      if (user.status === UserStatus.SUSPENDED) {
        throw new UnauthorizedException('هذا الحساب معلق مؤقتاً');
      }

      // Update last login
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          lastLoginIp: ipAddress,
          avatar: user.avatar || picture,
        },
      });
    }

    // Generate tokens
    const tokens = await this.generateTokens(user, ipAddress, dto.deviceInfo);

    return {
      user: {
        id: user.id,
        numericId: user.numericId.toString(),
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        role: user.role,
        emailVerified: user.emailVerified,
      },
      tokens,
    };
  }

  // ================================
  // REFRESH TOKEN
  // ================================

  async refreshTokens(dto: RefreshTokenDto, ipAddress?: string): Promise<TokenPair> {
    // Find refresh token in database
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: dto.refreshToken },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Refresh token غير صالح');
    }

    if (storedToken.revokedAt) {
      // Token was revoked - possible security breach, revoke all tokens
      await this.revokeAllUserTokens(storedToken.userId);
      throw new UnauthorizedException('تم اكتشاف محاولة استخدام token ملغي. تم تسجيل الخروج من جميع الأجهزة');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token منتهي الصلاحية');
    }

    // Check user status
    if (storedToken.user.status === UserStatus.BANNED) {
      throw new UnauthorizedException('تم حظر هذا الحساب');
    }

    // Revoke old token
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    // Generate new tokens
    const tokens = await this.generateTokens(storedToken.user, ipAddress);

    return tokens;
  }

  // ================================
  // LOGOUT
  // ================================

  async logout(userId: string, refreshToken?: string, logoutAll?: boolean): Promise<void> {
    if (logoutAll) {
      await this.revokeAllUserTokens(userId);
      this.logger.log(`User ${userId} logged out from all devices`);
    } else if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: {
          token: refreshToken,
          userId,
        },
        data: { revokedAt: new Date() },
      });
      this.logger.log(`User ${userId} logged out from one device`);
    }

    // Clear presence from Redis
    await this.redis.setUserOffline(userId);
  }

  // ================================
  // CHANGE PASSWORD
  // ================================

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.passwordHash) {
      throw new BadRequestException('لا يمكن تغيير كلمة المرور لهذا الحساب');
    }

    // Verify current password
    const isValid = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!isValid) {
      throw new UnauthorizedException('كلمة المرور الحالية غير صحيحة');
    }

    // Hash new password
    const newPasswordHash = await argon2.hash(dto.newPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    // Update password and revoke all tokens
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newPasswordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId },
        data: { revokedAt: new Date() },
      }),
    ]);

    this.logger.log(`User ${userId} changed password`);
  }

  // ================================
  // HELPER METHODS
  // ================================

  private async generateTokens(
    user: any,
    ipAddress?: string,
    deviceInfo?: string,
  ): Promise<TokenPair> {
    const accessPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
    };

    const refreshPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'refresh',
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN', '15m'),
    });

    const refreshTokenValue = uuidv4();
    const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
    const refreshExpiresMs = this.parseExpiry(refreshExpiresIn);

    // Store refresh token in database
    await this.prisma.refreshToken.create({
      data: {
        token: refreshTokenValue,
        userId: user.id,
        deviceInfo,
        ipAddress,
        expiresAt: new Date(Date.now() + refreshExpiresMs),
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      expiresIn: 900, // 15 minutes in seconds
    };
  }

  private async revokeAllUserTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async generateUniqueUsername(baseName: string): Promise<string> {
    // Clean base name
    let username = baseName
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .substring(0, 20);

    if (username.length < 3) {
      username = 'user';
    }

    // Check if unique
    let finalUsername = username;
    let counter = 1;

    while (await this.prisma.user.findUnique({ where: { username: finalUsername } })) {
      finalUsername = `${username}${counter}`;
      counter++;
    }

    return finalUsername;
  }

  private parseExpiry(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000; // Default 7 days

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value * 1000;
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        return 7 * 24 * 60 * 60 * 1000;
    }
  }

  // ================================
  // VALIDATE USER (for JWT Strategy)
  // ================================

  async validateUser(userId: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatar: true,
        role: true,
        status: true,
        emailVerified: true,
      },
    });

    if (!user || user.status === UserStatus.BANNED) {
      return null;
    }

    return user;
  }
}
