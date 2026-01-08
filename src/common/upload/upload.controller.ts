import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from "@nestjs/swagger";
import { UploadService } from "./upload.service";
import { JwtAuthGuard } from "../../modules/auth/guards/jwt-auth.guard";
import { CurrentUser } from "../../modules/auth/decorators/current-user.decorator";

@ApiTags("upload")
@Controller("upload")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

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
        fileSize: 10 * 1024 * 1024, // 10MB max
      },
      fileFilter: (req, file, cb) => {
        const allowedMimes = [
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
          "audio/mpeg",
          "audio/wav",
          "audio/ogg",
        ];
        if (allowedMimes.includes(file.mimetype)) {
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
  ) {
    if (!file) {
      throw new BadRequestException("لم يتم رفع ملف");
    }

    const result = await this.uploadService.uploadImage(file, folder);
    
    return {
      success: true,
      url: result.url,
      filename: result.filename,
    };
  }
}
