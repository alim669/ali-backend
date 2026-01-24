import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  UseGuards,
  BadRequestException,
  Req,
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
import { JwtAuthGuard } from "../../modules/auth/guards/jwt-auth.guard";
import { CurrentUser } from "../../modules/auth/decorators/current-user.decorator";

@ApiTags("upload")
@Controller("upload")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UploadController {
  constructor(
    private readonly uploadService: UploadService,
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
    const baseUrl = this.configService.get<string>("BASE_URL") || "";
    const host = req?.get?.("host");
    if (host && (baseUrl === "" || baseUrl.includes("167.235.64.220"))) {
      const protocol = req?.protocol || "http";
      const safeFolder = (folder || "general")
        .trim()
        .replace(/\\/g, "/")
        .replace(/\.+/g, "")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "")
        .replace(/\/+?/g, "/");
      publicUrl = `${protocol}://${host}/uploads/${safeFolder}/${result.filename}`;
    }

    return {
      success: true,
      url: publicUrl,
      filename: result.filename,
    };
  }
}
