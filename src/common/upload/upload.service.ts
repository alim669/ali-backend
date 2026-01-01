import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

export interface UploadResult {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly isConfigured: boolean;

  constructor(private configService: ConfigService) {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');

    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      });
      this.isConfigured = true;
      this.logger.log('☁️ Cloudinary configured successfully');
    } else {
      this.isConfigured = false;
      this.logger.warn('⚠️ Cloudinary not configured - uploads disabled');
    }
  }

  async uploadImage(
    file: Express.Multer.File,
    folder: string = 'ali-app',
  ): Promise<UploadResult> {
    if (!this.isConfigured) {
      throw new BadRequestException('خدمة رفع الصور غير متاحة');
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          transformation: [
            { width: 500, height: 500, crop: 'limit' },
            { quality: 'auto', fetch_format: 'auto' },
          ],
        },
        (error, result) => {
          if (error) {
            this.logger.error(`Upload failed: ${error.message}`);
            reject(new BadRequestException('فشل رفع الصورة'));
          } else if (result) {
            resolve({
              url: result.secure_url,
              publicId: result.public_id,
              width: result.width,
              height: result.height,
            });
          }
        },
      );

      uploadStream.end(file.buffer);
    });
  }

  async uploadAvatar(file: Express.Multer.File, userId: string): Promise<UploadResult> {
    if (!this.isConfigured) {
      throw new BadRequestException('خدمة رفع الصور غير متاحة');
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'ali-app/avatars',
          public_id: `avatar_${userId}`,
          resource_type: 'image',
          overwrite: true,
          transformation: [
            { width: 200, height: 200, crop: 'fill', gravity: 'face' },
            { quality: 'auto', fetch_format: 'auto' },
          ],
        },
        (error, result) => {
          if (error) {
            this.logger.error(`Avatar upload failed: ${error.message}`);
            reject(new BadRequestException('فشل رفع صورة الملف الشخصي'));
          } else if (result) {
            resolve({
              url: result.secure_url,
              publicId: result.public_id,
              width: result.width,
              height: result.height,
            });
          }
        },
      );

      uploadStream.end(file.buffer);
    });
  }

  async uploadRoomImage(file: Express.Multer.File, roomId: string): Promise<UploadResult> {
    if (!this.isConfigured) {
      throw new BadRequestException('خدمة رفع الصور غير متاحة');
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'ali-app/rooms',
          public_id: `room_${roomId}`,
          resource_type: 'image',
          overwrite: true,
          transformation: [
            { width: 400, height: 300, crop: 'fill' },
            { quality: 'auto', fetch_format: 'auto' },
          ],
        },
        (error, result) => {
          if (error) {
            this.logger.error(`Room image upload failed: ${error.message}`);
            reject(new BadRequestException('فشل رفع صورة الغرفة'));
          } else if (result) {
            resolve({
              url: result.secure_url,
              publicId: result.public_id,
              width: result.width,
              height: result.height,
            });
          }
        },
      );

      uploadStream.end(file.buffer);
    });
  }

  async deleteImage(publicId: string): Promise<void> {
    if (!this.isConfigured) {
      return;
    }

    try {
      await cloudinary.uploader.destroy(publicId);
      this.logger.log(`Image deleted: ${publicId}`);
    } catch (error) {
      this.logger.error(`Failed to delete image: ${error.message}`);
    }
  }
}
