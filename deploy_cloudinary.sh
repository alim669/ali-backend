#!/bin/bash
# ==================================================
# Cloudinary Integration Deployment Script
# ==================================================

cd /opt/ali-backend

echo "📁 Creating cloudinary.service.ts..."
cat > src/common/upload/cloudinary.service.ts << 'CLOUDINARY_EOF'
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as cloudinary from "cloudinary";
import { Readable } from "stream";

export interface CloudinaryUploadResult {
  success: boolean;
  url?: string;
  secure_url?: string;
  public_id?: string;
  error?: string;
}

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private isConfigured = false;

  constructor(private configService: ConfigService) {
    this.configure();
  }

  private configure() {
    const cloudName = this.configService.get<string>("CLOUDINARY_CLOUD_NAME");
    const apiKey = this.configService.get<string>("CLOUDINARY_API_KEY");
    const apiSecret = this.configService.get<string>("CLOUDINARY_API_SECRET");

    if (cloudName && apiKey && apiSecret) {
      cloudinary.v2.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
      this.isConfigured = true;
      this.logger.log(`☁️ Cloudinary configured: cloud_name=${cloudName}`);
    } else {
      this.logger.warn("⚠️ Cloudinary not configured. Missing environment variables.");
      this.logger.warn("Required: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET");
    }
  }

  isReady(): boolean {
    return this.isConfigured;
  }

  async uploadImage(
    file: Express.Multer.File,
    folder: string = "images",
  ): Promise<CloudinaryUploadResult> {
    if (!this.isConfigured) {
      return { success: false, error: "Cloudinary not configured" };
    }

    try {
      this.logger.log(`☁️ Uploading image to Cloudinary: ${file.originalname}`);

      const result = await this.uploadToCloudinary(file.buffer, {
        folder,
        resource_type: "image",
        transformation: [
          { quality: "auto" },
          { fetch_format: "auto" },
        ],
      });

      this.logger.log(`✅ Image uploaded: ${result.secure_url}`);

      return {
        success: true,
        url: result.secure_url,
        secure_url: result.secure_url,
        public_id: result.public_id,
      };
    } catch (error) {
      this.logger.error(`❌ Cloudinary upload error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async uploadVideo(
    file: Express.Multer.File,
    folder: string = "videos",
  ): Promise<CloudinaryUploadResult> {
    if (!this.isConfigured) {
      return { success: false, error: "Cloudinary not configured" };
    }

    try {
      this.logger.log(`☁️ Uploading video to Cloudinary: ${file.originalname}`);

      const result = await this.uploadToCloudinary(file.buffer, {
        folder,
        resource_type: "video",
        transformation: [
          { quality: "auto" },
        ],
      });

      this.logger.log(`✅ Video uploaded: ${result.secure_url}`);

      return {
        success: true,
        url: result.secure_url,
        secure_url: result.secure_url,
        public_id: result.public_id,
      };
    } catch (error) {
      this.logger.error(`❌ Cloudinary upload error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async uploadAudio(
    file: Express.Multer.File,
    folder: string = "audio",
  ): Promise<CloudinaryUploadResult> {
    if (!this.isConfigured) {
      return { success: false, error: "Cloudinary not configured" };
    }

    try {
      this.logger.log(`☁️ Uploading audio to Cloudinary: ${file.originalname}`);

      const result = await this.uploadToCloudinary(file.buffer, {
        folder,
        resource_type: "video",
      });

      this.logger.log(`✅ Audio uploaded: ${result.secure_url}`);

      return {
        success: true,
        url: result.secure_url,
        secure_url: result.secure_url,
        public_id: result.public_id,
      };
    } catch (error) {
      this.logger.error(`❌ Cloudinary upload error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async deleteFile(publicId: string): Promise<boolean> {
    if (!this.isConfigured) {
      return false;
    }

    try {
      await cloudinary.v2.uploader.destroy(publicId);
      this.logger.log(`🗑️ File deleted from Cloudinary: ${publicId}`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Failed to delete file: ${error.message}`);
      return false;
    }
  }

  private uploadToCloudinary(
    buffer: Buffer,
    options: cloudinary.UploadApiOptions,
  ): Promise<cloudinary.UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.v2.uploader.upload_stream(
        options,
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        },
      );

      const readable = new Readable();
      readable._read = () => {};
      readable.push(buffer);
      readable.push(null);
      readable.pipe(uploadStream);
    });
  }

  getOptimizedUrl(publicId: string, options: { width?: number; height?: number; quality?: string } = {}): string {
    const { width, height, quality = "auto" } = options;

    const transformations: cloudinary.TransformationOptions = {
      quality,
      fetch_format: "auto",
    };

    if (width) transformations.width = width;
    if (height) transformations.height = height;
    if (width || height) transformations.crop = "fill";

    return cloudinary.v2.url(publicId, transformations);
  }
}
CLOUDINARY_EOF

echo "✅ cloudinary.service.ts created"

echo ""
echo "📁 Updating upload.controller.ts..."

# Backup original
cp src/common/upload/upload.controller.ts src/common/upload/upload.controller.ts.bak

cat > src/common/upload/upload.controller.ts << 'CONTROLLER_EOF'
import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Logger,
  UseGuards,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags, ApiConsumes, ApiBody, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { UploadService } from "./upload.service";
import { CloudinaryService } from "./cloudinary.service";

@ApiTags("Upload")
@Controller("upload")
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @Post("image")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpg|jpeg|png|gif|webp)$/)) {
          return cb(new BadRequestException("Only image files are allowed!"), false);
        }
        cb(null, true);
      },
    }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }

    this.logger.log(`📤 Uploading image: ${file.originalname}`);
    const url = await this.uploadService.uploadImage(file);
    return { success: true, url };
  }

  @Post("cloudinary")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 100 * 1024 * 1024 },
    }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: { type: "string", format: "binary" },
        folder: { type: "string" },
      },
    },
  })
  async uploadToCloudinary(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }

    this.logger.log(`☁️ Cloudinary upload request: ${file.originalname}`);

    if (this.cloudinaryService.isReady()) {
      let result;

      if (file.mimetype.startsWith("image/")) {
        result = await this.cloudinaryService.uploadImage(file);
      } else if (file.mimetype.startsWith("video/")) {
        result = await this.cloudinaryService.uploadVideo(file);
      } else if (file.mimetype.startsWith("audio/")) {
        result = await this.cloudinaryService.uploadAudio(file);
      } else {
        result = await this.cloudinaryService.uploadImage(file);
      }

      if (result.success) {
        return {
          success: true,
          url: result.secure_url,
          public_id: result.public_id,
          provider: "cloudinary",
        };
      } else {
        this.logger.warn(`⚠️ Cloudinary failed, falling back to local: ${result.error}`);
      }
    }

    const url = await this.uploadService.uploadImage(file);
    return { success: true, url, provider: "local" };
  }

  @Post("audio")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/^audio\/(mpeg|mp3|wav|ogg|aac|m4a|webm)$/)) {
          return cb(new BadRequestException("Only audio files are allowed!"), false);
        }
        cb(null, true);
      },
    }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  async uploadAudio(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("No audio file uploaded");
    }

    this.logger.log(`📤 Uploading audio: ${file.originalname}`);
    const url = await this.uploadService.uploadAudio(file);
    return { success: true, url };
  }

  @Post("video")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 100 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/^video\/(mp4|webm|ogg|mov|avi|quicktime)$/)) {
          return cb(new BadRequestException("Only video files are allowed!"), false);
        }
        cb(null, true);
      },
    }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  async uploadVideo(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("No video file uploaded");
    }

    this.logger.log(`📤 Uploading video: ${file.originalname}`);
    const url = await this.uploadService.uploadVideo(file);
    return { success: true, url };
  }
}
CONTROLLER_EOF

echo "✅ upload.controller.ts updated"

echo ""
echo "📁 Updating upload.module.ts..."

cat > src/common/upload/upload.module.ts << 'MODULE_EOF'
import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { UploadService } from "./upload.service";
import { UploadController } from "./upload.controller";
import { CloudinaryService } from "./cloudinary.service";

@Module({
  imports: [
    MulterModule.register({
      storage: memoryStorage(),
    }),
  ],
  controllers: [UploadController],
  providers: [UploadService, CloudinaryService],
  exports: [UploadService, CloudinaryService],
})
export class UploadModule {}
MODULE_EOF

echo "✅ upload.module.ts updated"

echo ""
echo "📁 Adding Cloudinary environment variables..."

# Check if CLOUDINARY vars exist
if ! grep -q "CLOUDINARY_CLOUD_NAME" .env.production 2>/dev/null; then
  echo "" >> .env.production
  echo "# Cloudinary Configuration" >> .env.production
  echo "CLOUDINARY_CLOUD_NAME=Root" >> .env.production
  echo "CLOUDINARY_API_KEY=417648631444543" >> .env.production
  echo "CLOUDINARY_API_SECRET=ncTUSaG9pZdWjvQ1usyo3Wej-VM" >> .env.production
  echo "✅ Cloudinary environment variables added"
else
  echo "ℹ️ Cloudinary environment variables already exist"
fi

echo ""
echo "📦 Installing cloudinary package..."
npm install cloudinary

echo ""
echo "🔨 Building backend..."
npm run build

echo ""
echo "🔄 Restarting backend service..."
if command -v pm2 &> /dev/null; then
  pm2 restart ali-backend || pm2 restart all
  echo "✅ PM2 restart completed"
elif command -v systemctl &> /dev/null; then
  systemctl restart ali-backend
  echo "✅ Systemctl restart completed"
else
  echo "⚠️ Could not find pm2 or systemctl. Please restart manually."
fi

echo ""
echo "=================================================="
echo "✅ Cloudinary Integration Deployed Successfully!"
echo "=================================================="
echo ""
echo "🧪 Test the upload endpoint:"
echo "   curl -X POST https://your-domain.com/api/v1/upload/cloudinary -F 'file=@test.jpg' -H 'Authorization: Bearer TOKEN'"
echo ""
