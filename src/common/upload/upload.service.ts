import { Injectable, Logger, BadRequestException, Inject, forwardRef, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { exec } from "child_process";

export interface UploadResult {
  url: string;
  filename: string;
  path: string;
  // 🎨 NEW: Multi-size avatar URLs
  variants?: {
    small?: string;
    medium?: string;
    large?: string;
  };
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly uploadDir: string;
  private readonly baseUrl: string;

  constructor(private configService: ConfigService) {
    this.uploadDir =
      this.configService.get<string>("UPLOAD_DIR") ||
      this.configService.get<string>("UPLOAD_DEST") ||
      this.configService.get<string>("upload.destination") ||
      "./uploads";
    // 🔧 استخدام الدومين الصحيح بدلاً من IP القديم
    const configuredBaseUrl = this.configService.get<string>("BASE_URL", "https://api.yoro1chatt.com");
    // تأكد من استخدام HTTPS والدومين الصحيح
    if (configuredBaseUrl.includes("167.235.64.220") || configuredBaseUrl.includes("64.226.115.148")) {
      this.baseUrl = "https://api.yoro1chatt.com";
    } else {
      this.baseUrl = configuredBaseUrl;
    }

    // Create upload directories
    this.ensureDirectories();
    this.logger.log(`📁 Upload service initialized: ${this.uploadDir}, baseUrl: ${this.baseUrl}`);
  }

  private ensureDirectories() {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
      this.ensureWritable(this.uploadDir);
    }
    const dirs = [
      "avatars",
      "rooms",
      "messages",
      "gifts",
      "room_music",
      "audio",
      "videos",
      "explore",
    ];
    for (const dir of dirs) {
      const fullPath = path.join(this.uploadDir, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        this.ensureWritable(fullPath);
      }
    }
  }

  private ensureWritable(targetPath: string) {
    try {
      fs.accessSync(targetPath, fs.constants.W_OK);
    } catch (error) {
      try {
        fs.chmodSync(targetPath, 0o775);
        fs.accessSync(targetPath, fs.constants.W_OK);
      } catch (innerError) {
        this.logger.error(
          `Upload path is not writable: ${targetPath}`,
        );
        throw new BadRequestException(
          `Upload path is not writable: ${targetPath}. Ensure the running user has write permissions.`,
        );
      }
    }
  }

  private sanitizeFolder(folder: string) {
    const trimmed = (folder || "general").trim();
    const safe = trimmed.replace(/\\/g, "/").replace(/\.+/g, "");
    return safe.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\/+?/g, "/") || "general";
  }

  private buildPublicUrl(safeFolder: string, filename: string) {
    const base = this.baseUrl.replace(/\/+$/, "");
    const safeSegments = safeFolder
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment));
    const encodedFolder = safeSegments.join("/");
    const encodedFile = encodeURIComponent(filename);
    return `${base}/uploads/${encodedFolder}/${encodedFile}`;
  }

  private async ensureFolderExists(folder: string) {
    const safeFolder = this.sanitizeFolder(folder || "general");
    if (!fs.existsSync(this.uploadDir)) {
      await fs.promises.mkdir(this.uploadDir, { recursive: true });
      this.ensureWritable(this.uploadDir);
    }
    const fullPath = path.join(this.uploadDir, safeFolder);
    if (!fs.existsSync(fullPath)) {
      await fs.promises.mkdir(fullPath, { recursive: true });
      this.ensureWritable(fullPath);
    }
    return { safeFolder, fullPath };
  }

  async uploadImage(
    file: Express.Multer.File,
    folder: string = "general",
  ): Promise<UploadResult> {
    const { safeFolder } = await this.ensureFolderExists(folder);
    const filename = `${uuidv4()}${path.extname(file.originalname)}`;
    const filePath = path.join(this.uploadDir, safeFolder, filename);

    await fs.promises.writeFile(filePath, file.buffer);

    const url = this.buildPublicUrl(safeFolder, filename);
    this.logger.log(`📤 Image uploaded: ${url}`);

    return {
      url,
      filename,
      path: filePath,
    };
  }

  async uploadAudio(
    file: Express.Multer.File,
    folder: string = "audio",
  ): Promise<UploadResult> {
    const { safeFolder } = await this.ensureFolderExists(folder);
    const filename = `${uuidv4()}${path.extname(file.originalname)}`;
    const filePath = path.join(this.uploadDir, safeFolder, filename);

    await fs.promises.writeFile(filePath, file.buffer);

    const url = this.buildPublicUrl(safeFolder, filename);
    this.logger.log(`🎵 Audio uploaded: ${url}`);

    return {
      url,
      filename,
      path: filePath,
    };
  }

  async uploadVideo(
    file: Express.Multer.File,
    folder: string = "videos",
  ): Promise<UploadResult> {
    const { safeFolder } = await this.ensureFolderExists(folder);
    const originalExt = path.extname(file.originalname).toLowerCase() || ".mp4";
    const uuid = uuidv4();
    
    // الصيغ التي تحتاج تحويل
    const needsConversion = ['.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.3gp'];
    const shouldConvert = needsConversion.includes(originalExt) || originalExt !== '.mp4';
    
    if (shouldConvert) {
      // حفظ الملف الأصلي مؤقتاً
      const tempFilename = `temp_${uuid}${originalExt}`;
      const tempPath = path.join(this.uploadDir, safeFolder, tempFilename);
      await fs.promises.writeFile(tempPath, file.buffer);
      
      // تحويل إلى MP4 H.264 باستخدام FFmpeg
      const outputFilename = `${uuid}.mp4`;
      const outputPath = path.join(this.uploadDir, safeFolder, outputFilename);
      
      try {
        await this.convertVideoToMp4(tempPath, outputPath);
        
        // حذف الملف المؤقت
        try {
          await fs.promises.unlink(tempPath);
        } catch (e) {
          this.logger.warn(`Failed to delete temp file: ${tempPath}`);
        }
        
        const url = this.buildPublicUrl(safeFolder, outputFilename);
        this.logger.log(`🎬 Video converted and uploaded: ${url}`);
        
        return {
          url,
          filename: outputFilename,
          path: outputPath,
        };
      } catch (error) {
        this.logger.error(`FFmpeg conversion failed: ${error.message}`);
        // إذا فشل التحويل، نحفظ الملف كما هو
        const filename = `${uuid}${originalExt}`;
        const filePath = path.join(this.uploadDir, safeFolder, filename);
        
        // نقل الملف المؤقت
        try {
          await fs.promises.rename(tempPath, filePath);
        } catch (e) {
          await fs.promises.writeFile(filePath, file.buffer);
          try { await fs.promises.unlink(tempPath); } catch (e2) {}
        }
        
        const url = this.buildPublicUrl(safeFolder, filename);
        this.logger.log(`🎬 Video uploaded (no conversion): ${url}`);
        
        return {
          url,
          filename,
          path: filePath,
        };
      }
    } else {
      // MP4 - حفظ مباشرة (لكن نتحقق من الـ codec)
      const filename = `${uuid}.mp4`;
      const filePath = path.join(this.uploadDir, safeFolder, filename);
      await fs.promises.writeFile(filePath, file.buffer);
      
      // محاولة إعادة تشفير الـ MP4 للتأكد من التوافقية
      const tempPath = filePath + '.temp';
      try {
        await fs.promises.rename(filePath, tempPath);
        await this.convertVideoToMp4(tempPath, filePath);
        await fs.promises.unlink(tempPath);
        this.logger.log(`🎬 Video re-encoded for web compatibility`);
      } catch (e) {
        // إذا فشل، نعيد الملف الأصلي
        try {
          if (fs.existsSync(tempPath) && !fs.existsSync(filePath)) {
            await fs.promises.rename(tempPath, filePath);
          } else if (fs.existsSync(tempPath)) {
            await fs.promises.unlink(tempPath);
          }
        } catch (e2) {}
      }
      
      const url = this.buildPublicUrl(safeFolder, filename);
      this.logger.log(`🎬 Video uploaded: ${url}`);
      
      return {
        url,
        filename,
        path: filePath,
      };
    }
  }
  
  /**
   * تحويل الفيديو إلى MP4 H.264 باستخدام FFmpeg
   */
  private convertVideoToMp4(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // FFmpeg command للتحويل إلى صيغة متوافقة مع الويب
      // -c:v libx264: استخدام H.264 codec
      // -c:a aac: استخدام AAC audio codec
      // -movflags +faststart: يجعل الفيديو يبدأ التشغيل بسرعة
      // -preset fast: سرعة معقولة للتحويل
      // -crf 23: جودة جيدة مع حجم معقول
      // -pix_fmt yuv420p: تنسيق متوافق مع معظم الأجهزة
      const ffmpegCmd = `ffmpeg -i "${inputPath}" -c:v libx264 -c:a aac -movflags +faststart -preset fast -crf 23 -pix_fmt yuv420p -y "${outputPath}"`;
      
      this.logger.log(`🔄 Converting video: ${path.basename(inputPath)} -> ${path.basename(outputPath)}`);
      
      exec(ffmpegCmd, { timeout: 120000 }, (error, stdout, stderr) => {
        if (error) {
          this.logger.error(`FFmpeg error: ${error.message}`);
          this.logger.error(`FFmpeg stderr: ${stderr}`);
          reject(new Error(`Video conversion failed: ${error.message}`));
        } else {
          this.logger.log(`✅ Video conversion completed`);
          resolve();
        }
      });
    });
  }

  async uploadAvatar(
    file: Express.Multer.File,
    userId: string,
  ): Promise<UploadResult> {
    await this.ensureFolderExists("avatars");
    const ext = path.extname(file.originalname) || ".jpg";
    const filename = `avatar_${userId}${ext}`;
    const filePath = path.join(this.uploadDir, "avatars", filename);

    // Delete old avatar if exists
    try {
      const files = await fs.promises.readdir(
        path.join(this.uploadDir, "avatars"),
      );
      for (const f of files) {
        if (f.startsWith(`avatar_${userId}`)) {
          await fs.promises.unlink(path.join(this.uploadDir, "avatars", f));
        }
      }
    } catch (e) {}

    // 🎨 NEW: Process avatar with sharp for quality & multi-size support
    let processedUrl = '';
    let variants: { small?: string; medium?: string; large?: string } = {};
    
    try {
      // Try to use sharp for premium image processing
      const sharp = require('sharp');
      const timestamp = Date.now();
      
      // Auto-rotate based on EXIF and get metadata
      const image = sharp(file.buffer).rotate();
      const metadata = await image.metadata();
      
      // Calculate center crop for square
      const size = Math.min(metadata.width || 512, metadata.height || 512);
      const left = Math.floor(((metadata.width || 0) - size) / 2);
      const top = Math.floor(((metadata.height || 0) - size) / 2);
      
      // Crop to square
      const croppedImage = sharp(file.buffer)
        .rotate()
        .extract({ left, top, width: size, height: size });
      
      // Generate small (64x64)
      const smallFilename = `avatar_${userId}_small_${timestamp}.jpg`;
      const smallPath = path.join(this.uploadDir, "avatars", smallFilename);
      await croppedImage
        .clone()
        .resize(64, 64, { fit: 'cover' })
        .jpeg({ quality: 85, mozjpeg: true })
        .toFile(smallPath);
      variants.small = `${this.baseUrl}/uploads/avatars/${smallFilename}`;
      
      // Generate medium (128x128)
      const mediumFilename = `avatar_${userId}_medium_${timestamp}.jpg`;
      const mediumPath = path.join(this.uploadDir, "avatars", mediumFilename);
      await croppedImage
        .clone()
        .resize(128, 128, { fit: 'cover' })
        .jpeg({ quality: 85, mozjpeg: true })
        .toFile(mediumPath);
      variants.medium = `${this.baseUrl}/uploads/avatars/${mediumFilename}`;
      
      // Generate large (256x256) - main avatar
      const largeFilename = `avatar_${userId}_${timestamp}.jpg`;
      const largePath = path.join(this.uploadDir, "avatars", largeFilename);
      await croppedImage
        .clone()
        .resize(256, 256, { fit: 'cover' })
        .jpeg({ quality: 85, mozjpeg: true })
        .toFile(largePath);
      variants.large = `${this.baseUrl}/uploads/avatars/${largeFilename}`;
      
      processedUrl = variants.large; // Main URL is the large variant
      this.logger.log(`📤 Avatar processed with sharp: ${processedUrl}`);
      
    } catch (sharpError) {
      // Fallback: save as-is if sharp fails
      this.logger.warn(`⚠️ Sharp processing failed, using fallback: ${sharpError.message}`);
      const filename = `avatar_${userId}${ext}`;
      const filePath = path.join(this.uploadDir, "avatars", filename);
      await fs.promises.writeFile(filePath, file.buffer);
      processedUrl = `${this.baseUrl}/uploads/avatars/${filename}`;
      this.logger.log(`📤 Avatar uploaded (fallback): ${processedUrl}`);
    }

    return {
      url: processedUrl,
      filename: path.basename(processedUrl),
      path: path.join(this.uploadDir, "avatars", path.basename(processedUrl)),
      variants,
    };
  }

  async uploadRoomImage(
    file: Express.Multer.File,
    roomId: string,
  ): Promise<UploadResult> {
    await this.ensureFolderExists("rooms");
    const ext = path.extname(file.originalname) || ".jpg";
    const filename = `room_${roomId}${ext}`;
    const filePath = path.join(this.uploadDir, "rooms", filename);

    await fs.promises.writeFile(filePath, file.buffer);

    const url = `${this.baseUrl}/uploads/rooms/${filename}`;
    this.logger.log(`📤 Room image uploaded: ${url}`);

    return {
      url,
      filename,
      path: filePath,
    };
  }

  async deleteImage(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        this.logger.log(`🗑️ Image deleted: ${filePath}`);
      }
    } catch (error) {
      this.logger.error(`Failed to delete: ${error.message}`);
    }
  }
}
