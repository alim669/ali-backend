import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  UseGuards,
  BadRequestException,
  Req,
  Version,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { UploadService } from "./upload.service";
import { CloudinaryService } from "./cloudinary.service";
import { JwtAuthGuard } from "../../modules/auth/guards/jwt-auth.guard";
import { CurrentUser } from "../../modules/auth/decorators/current-user.decorator";

@ApiTags("upload")
@Controller({ path: "upload", version: "1" })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UploadController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  @ApiOperation({ summary: "رفع ملف" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
        },
        folder: {
          type: "string",
          description: "المجلد (avatars, rooms, messages, gifts)",
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB max
      },
      fileFilter: (req, file, cb) => {
        const allowedMimes = [
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
          "video/mp4",
          "video/webm",
          "video/quicktime",
          "audio/mpeg",
          "audio/mp3",
          "audio/wav",
          "audio/ogg",
          "audio/mp4",
          "audio/m4a",
          "audio/aac",
          "audio/flac",
          "audio/x-flac",
          "audio/webm",
        ];
        const allowedExt = [
          ".mp4",
          ".webm",
          ".mov",
          ".mp3",
          ".wav",
          ".m4a",
          ".aac",
          ".ogg",
          ".flac",
        ];
        const fileName = file.originalname?.toLowerCase() ?? "";
        const hasAllowedExt = allowedExt.some((ext) => fileName.endsWith(ext));

        if (
          file.mimetype?.startsWith("image/") ||
          file.mimetype?.startsWith("video/") ||
          file.mimetype?.startsWith("audio/")
        ) {
          cb(null, true);
        } else if (allowedMimes.includes(file.mimetype)) {
          cb(null, true);
        } else if (
          file.mimetype === "application/octet-stream" &&
          hasAllowedExt
        ) {
          cb(null, true);
        } else if (hasAllowedExt) {
          cb(null, true);
        } else {
          cb(new BadRequestException("نوع الملف غير مدعوم"), false);
        }
      },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body("folder") folder: string = "general",
    @CurrentUser("id") userId: string,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException("لم يتم رفع ملف");
    }

    const isAudio = file.mimetype?.startsWith("audio/");
    const isVideo = file.mimetype?.startsWith("video/");
    const targetFolder = folder || (isAudio ? "audio" : "general");
    const result = isAudio
      ? await this.uploadService.uploadAudio(file, targetFolder)
      : isVideo
        ? await this.uploadService.uploadVideo(file, targetFolder)
        : await this.uploadService.uploadImage(file, targetFolder);

    let publicUrl = result.url;
    const baseUrl = this.configService.get<string>("BASE_URL") || "https://api.yoro1chatt.com";
    const host = req?.get?.("host");
    // 🔧 استخدام الدومين الصحيح دائماً
    if (baseUrl.includes("167.235.64.220") || baseUrl.includes("64.226.115.148") || baseUrl === "") {
      const safeFolder = (folder || "general")
        .trim()
        .replace(/\\/g, "/")
        .replace(/\.+/g, "")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "")
        .replace(/\/+?/g, "/");
      publicUrl = `https://api.yoro1chatt.com/uploads/${safeFolder}/${result.filename}`;
    }

    return {
      success: true,
      url: publicUrl,
      filename: result.filename,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ☁️ Cloudinary Upload - CDN عالمي آمن
  // ═══════════════════════════════════════════════════════════════

  @Post("cloudinary")
  @ApiOperation({ summary: "رفع ملف إلى Cloudinary CDN" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
        },
        folder: {
          type: "string",
          description: "المجلد (room_images, avatars, posts, etc.)",
        },
        resource_type: {
          type: "string",
          description: "نوع الملف (image, video, auto)",
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB للفيديو
      },
      fileFilter: (req, file, cb) => {
        if (
          file.mimetype?.startsWith("image/") ||
          file.mimetype?.startsWith("video/") ||
          file.mimetype?.startsWith("audio/")
        ) {
          cb(null, true);
        } else {
          cb(new BadRequestException("نوع الملف غير مدعوم"), false);
        }
      },
    }),
  )
  async uploadToCloudinary(
    @UploadedFile() file: Express.Multer.File,
    @Body("folder") folder: string = "images",
    @Body("resource_type") resourceType: string = "image",
    @CurrentUser("id") userId: string,
  ) {
    if (!file) {
      throw new BadRequestException("لم يتم رفع ملف");
    }

    // التحقق من إعداد Cloudinary
    if (!this.cloudinaryService.isReady()) {
      // Fallback للـ Backend المحلي
      console.log("⚠️ Cloudinary not configured, falling back to local storage");
      const isAudio = file.mimetype?.startsWith("audio/");
      const isVideo = file.mimetype?.startsWith("video/");
      const result = isAudio
        ? await this.uploadService.uploadAudio(file, folder)
        : isVideo
          ? await this.uploadService.uploadVideo(file, folder)
          : await this.uploadService.uploadImage(file, folder);
      
      return {
        success: true,
        url: result.url,
        public_id: result.filename,
      };
    }

    // ☁️ رفع إلى Cloudinary
    const isAudio = file.mimetype?.startsWith("audio/");
    const isVideo = file.mimetype?.startsWith("video/");
    
    let result;
    if (isVideo || resourceType === "video") {
      result = await this.cloudinaryService.uploadVideo(file, folder);
    } else if (isAudio || resourceType === "auto") {
      result = await this.cloudinaryService.uploadAudio(file, folder);
    } else {
      result = await this.cloudinaryService.uploadImage(file, folder);
    }

    if (!result.success) {
      throw new BadRequestException(result.error || "فشل رفع الملف");
    }

    return {
      success: true,
      url: result.secure_url,
      secure_url: result.secure_url,
      public_id: result.public_id,
    };
  }
}
