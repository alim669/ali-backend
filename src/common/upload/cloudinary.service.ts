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

  /**
   * رفع صورة إلى Cloudinary
   */
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

  /**
   * رفع فيديو إلى Cloudinary
   */
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
        chunk_size: 6000000, // 6MB chunks للفيديو الكبير
      });

      this.logger.log(`✅ Video uploaded: ${result.secure_url}`);

      return {
        success: true,
        url: result.secure_url,
        secure_url: result.secure_url,
        public_id: result.public_id,
      };
    } catch (error) {
      this.logger.error(`❌ Cloudinary video upload error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * رفع صوت إلى Cloudinary
   */
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
        resource_type: "auto",
      });

      this.logger.log(`✅ Audio uploaded: ${result.secure_url}`);

      return {
        success: true,
        url: result.secure_url,
        secure_url: result.secure_url,
        public_id: result.public_id,
      };
    } catch (error) {
      this.logger.error(`❌ Cloudinary audio upload error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * حذف ملف من Cloudinary
   */
  async deleteFile(publicId: string): Promise<boolean> {
    if (!this.isConfigured) {
      return false;
    }

    try {
      await cloudinary.v2.uploader.destroy(publicId);
      this.logger.log(`🗑️ File deleted from Cloudinary: ${publicId}`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Failed to delete from Cloudinary: ${error.message}`);
      return false;
    }
  }

  /**
   * Internal: رفع buffer إلى Cloudinary
   */
  private uploadToCloudinary(
    buffer: Buffer,
    options: cloudinary.UploadApiOptions,
  ): Promise<cloudinary.UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.v2.uploader.upload_stream(
        options,
        (error, result) => {
          if (error) reject(error);
          else resolve(result!);
        },
      );

      const readable = new Readable();
      readable._read = () => {};
      readable.push(buffer);
      readable.push(null);
      readable.pipe(uploadStream);
    });
  }

  /**
   * الحصول على URL محسّن
   */
  getOptimizedUrl(
    publicId: string,
    options: {
      width?: number;
      height?: number;
      quality?: string;
      format?: string;
    } = {},
  ): string {
    return cloudinary.v2.url(publicId, {
      transformation: [
        { width: options.width, height: options.height, crop: "fill" },
        { quality: options.quality || "auto" },
        { fetch_format: options.format || "auto" },
      ],
      secure: true,
    });
  }
}
