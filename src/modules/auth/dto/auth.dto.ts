import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsOptional,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class RegisterDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail({}, { message: "البريد الإلكتروني غير صالح" })
  email: string;

  @ApiProperty({ example: "SecurePass123!" })
  @IsString()
  @MinLength(8, { message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" })
  @MaxLength(50)
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message: "كلمة المرور يجب أن تحتوي على حرف كبير وصغير ورقم أو رمز",
  })
  password: string;

  @ApiProperty({ example: "ahmed_ali" })
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: "اسم المستخدم يجب أن يحتوي على أحرف وأرقام و _ فقط",
  })
  username: string;

  @ApiProperty({ example: "أحمد علي" })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  displayName: string;
}

export class LoginDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail({}, { message: "البريد الإلكتروني غير صالح" })
  email: string;

  @ApiProperty({ example: "SecurePass123!" })
  @IsString()
  @MinLength(1)
  password: string;

  @ApiPropertyOptional({ example: "iPhone 15 Pro" })
  @IsOptional()
  @IsString()
  deviceInfo?: string;
}

export class GoogleLoginDto {
  @ApiProperty({ description: "Google ID Token from Flutter app" })
  @IsString()
  idToken: string;

  @ApiPropertyOptional({ example: "Samsung Galaxy S24" })
  @IsOptional()
  @IsString()
  deviceInfo?: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: "Refresh token" })
  @IsString()
  refreshToken: string;
}

export class LogoutDto {
  @ApiPropertyOptional({ description: "Refresh token to revoke" })
  @IsOptional()
  @IsString()
  refreshToken?: string;

  @ApiPropertyOptional({ description: "Logout from all devices" })
  @IsOptional()
  logoutAll?: boolean;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/)
  newPassword: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  currentPassword: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/)
  newPassword: string;
}
