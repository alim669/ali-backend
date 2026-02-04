import { Injectable, Logger } from '@nestjs/common';
import * as sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 🎨 PREMIUM IMAGE PROCESSING SERVICE
 * 
 * This service handles:
 * 1. EXIF orientation fix
 * 2. Square cropping (center crop)
 * 3. Multiple size variants generation
 * 4. WebP conversion for modern browsers
 * 5. Quality optimization
 */

export interface ProcessedImage {
  small: string;   // 64x64 - for lists, thumbnails
  medium: string;  // 128x128 - for standard avatars
  large: string;   // 256x256 - for profile views
  original: string; // Original size, optimized
}

export interface ImageProcessingOptions {
  quality?: number;        // 1-100, default 85
  generateWebP?: boolean;  // Generate WebP variants
  sizes?: {
    small?: number;
    medium?: number;
    large?: number;
  };
}

const DEFAULT_OPTIONS: ImageProcessingOptions = {
  quality: 85,
  generateWebP: true,
  sizes: {
    small: 64,
    medium: 128,
    large: 256,
  },
};

@Injectable()
export class ImageProcessingService {
  private readonly logger = new Logger(ImageProcessingService.name);

  /**
   * Process an avatar image:
   * - Fix EXIF orientation
   * - Crop to square (center)
   * - Generate multiple sizes
   * - Optimize quality
   * - Generate WebP variants
   */
  async processAvatar(
    inputBuffer: Buffer,
    userId: string,
    uploadDir: string,
    baseUrl: string,
    options: ImageProcessingOptions = DEFAULT_OPTIONS,
  ): Promise<ProcessedImage> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const avatarsDir = path.join(uploadDir, 'avatars');
    
    // Ensure directory exists
    if (!fs.existsSync(avatarsDir)) {
      fs.mkdirSync(avatarsDir, { recursive: true });
    }

    try {
      // 1. Load image and auto-rotate based on EXIF
      let image = sharp(inputBuffer).rotate(); // Auto-rotate based on EXIF

      // 2. Get metadata
      const metadata = await image.metadata();
      this.logger.log(`📸 Processing image: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);

      // 3. Calculate center crop for square
      const size = Math.min(metadata.width || 0, metadata.height || 0);
      const left = Math.floor(((metadata.width || 0) - size) / 2);
      const top = Math.floor(((metadata.height || 0) - size) / 2);

      // 4. Crop to square from center
      image = sharp(inputBuffer)
        .rotate()
        .extract({
          left,
          top,
          width: size,
          height: size,
        });

      // 5. Delete old avatars for this user
      await this.deleteOldAvatars(avatarsDir, userId);

      // 6. Generate variants
      const timestamp = Date.now();
      const results: ProcessedImage = {
        small: '',
        medium: '',
        large: '',
        original: '',
      };

      // Small (64x64)
      const smallFilename = `avatar_${userId}_small_${timestamp}.jpg`;
      const smallPath = path.join(avatarsDir, smallFilename);
      await image
        .clone()
        .resize(opts.sizes?.small || 64, opts.sizes?.small || 64, {
          fit: 'cover',
          position: 'center',
        })
        .jpeg({ quality: opts.quality, mozjpeg: true })
        .toFile(smallPath);
      results.small = `${baseUrl}/uploads/avatars/${smallFilename}`;

      // Medium (128x128)
      const mediumFilename = `avatar_${userId}_medium_${timestamp}.jpg`;
      const mediumPath = path.join(avatarsDir, mediumFilename);
      await image
        .clone()
        .resize(opts.sizes?.medium || 128, opts.sizes?.medium || 128, {
          fit: 'cover',
          position: 'center',
        })
        .jpeg({ quality: opts.quality, mozjpeg: true })
        .toFile(mediumPath);
      results.medium = `${baseUrl}/uploads/avatars/${mediumFilename}`;

      // Large (256x256)
      const largeFilename = `avatar_${userId}_large_${timestamp}.jpg`;
      const largePath = path.join(avatarsDir, largeFilename);
      await image
        .clone()
        .resize(opts.sizes?.large || 256, opts.sizes?.large || 256, {
          fit: 'cover',
          position: 'center',
        })
        .jpeg({ quality: opts.quality, mozjpeg: true })
        .toFile(largePath);
      results.large = `${baseUrl}/uploads/avatars/${largeFilename}`;

      // Original (max 512px, optimized)
      const originalFilename = `avatar_${userId}_${timestamp}.jpg`;
      const originalPath = path.join(avatarsDir, originalFilename);
      await image
        .clone()
        .resize(512, 512, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: opts.quality, mozjpeg: true })
        .toFile(originalPath);
      results.original = `${baseUrl}/uploads/avatars/${originalFilename}`;

      // 7. Generate WebP variants (optional, for modern browsers)
      if (opts.generateWebP) {
        await this.generateWebPVariants(image, avatarsDir, userId, timestamp, opts);
      }

      this.logger.log(`✅ Avatar processed successfully for user ${userId}`);
      this.logger.log(`   Small: ${results.small}`);
      this.logger.log(`   Medium: ${results.medium}`);
      this.logger.log(`   Large: ${results.large}`);
      this.logger.log(`   Original: ${results.original}`);

      return results;
    } catch (error) {
      this.logger.error(`❌ Failed to process avatar: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate WebP variants for modern browsers
   */
  private async generateWebPVariants(
    image: sharp.Sharp,
    avatarsDir: string,
    userId: string,
    timestamp: number,
    opts: ImageProcessingOptions,
  ): Promise<void> {
    try {
      // Small WebP
      await image
        .clone()
        .resize(opts.sizes?.small || 64, opts.sizes?.small || 64, {
          fit: 'cover',
          position: 'center',
        })
        .webp({ quality: opts.quality })
        .toFile(path.join(avatarsDir, `avatar_${userId}_small_${timestamp}.webp`));

      // Medium WebP
      await image
        .clone()
        .resize(opts.sizes?.medium || 128, opts.sizes?.medium || 128, {
          fit: 'cover',
          position: 'center',
        })
        .webp({ quality: opts.quality })
        .toFile(path.join(avatarsDir, `avatar_${userId}_medium_${timestamp}.webp`));

      // Large WebP
      await image
        .clone()
        .resize(opts.sizes?.large || 256, opts.sizes?.large || 256, {
          fit: 'cover',
          position: 'center',
        })
        .webp({ quality: opts.quality })
        .toFile(path.join(avatarsDir, `avatar_${userId}_large_${timestamp}.webp`));

      this.logger.log(`   WebP variants generated`);
    } catch (error) {
      this.logger.warn(`⚠️ WebP generation failed: ${error.message}`);
      // Continue without WebP - not critical
    }
  }

  /**
   * Delete old avatar files for a user
   */
  private async deleteOldAvatars(avatarsDir: string, userId: string): Promise<void> {
    try {
      const files = await fs.promises.readdir(avatarsDir);
      const oldAvatars = files.filter((f) => f.startsWith(`avatar_${userId}`));
      
      for (const file of oldAvatars) {
        try {
          await fs.promises.unlink(path.join(avatarsDir, file));
          this.logger.log(`🗑️ Deleted old avatar: ${file}`);
        } catch (e) {
          // Ignore deletion errors
        }
      }
    } catch (e) {
      // Directory might not exist yet
    }
  }

  /**
   * Process a room image with optimization
   */
  async processRoomImage(
    inputBuffer: Buffer,
    roomId: string,
    uploadDir: string,
    baseUrl: string,
  ): Promise<string> {
    const roomsDir = path.join(uploadDir, 'rooms');
    
    if (!fs.existsSync(roomsDir)) {
      fs.mkdirSync(roomsDir, { recursive: true });
    }

    try {
      const timestamp = Date.now();
      const filename = `room_${roomId}_${timestamp}.jpg`;
      const filePath = path.join(roomsDir, filename);

      // Delete old room images
      try {
        const files = await fs.promises.readdir(roomsDir);
        for (const f of files) {
          if (f.startsWith(`room_${roomId}`)) {
            await fs.promises.unlink(path.join(roomsDir, f));
          }
        }
      } catch (e) {}

      // Process and optimize
      await sharp(inputBuffer)
        .rotate() // Auto-rotate based on EXIF
        .resize(800, 600, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85, mozjpeg: true })
        .toFile(filePath);

      const url = `${baseUrl}/uploads/rooms/${filename}`;
      this.logger.log(`✅ Room image processed: ${url}`);
      
      return url;
    } catch (error) {
      this.logger.error(`❌ Failed to process room image: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get the best avatar URL for a given size context
   * Returns WebP for supported browsers, JPEG fallback
   */
  getOptimalAvatarUrl(
    baseAvatarUrl: string,
    size: 'small' | 'medium' | 'large' = 'medium',
    acceptHeader?: string,
  ): string {
    if (!baseAvatarUrl) return '';
    
    // Check if browser supports WebP
    const supportsWebP = acceptHeader?.includes('image/webp');
    
    // Extract base info from URL
    const urlParts = baseAvatarUrl.split('/');
    const filename = urlParts[urlParts.length - 1];
    
    // Check if this is already a sized avatar
    if (filename.includes('_small') || filename.includes('_medium') || filename.includes('_large')) {
      // Replace size variant
      let newFilename = filename.replace(/_(?:small|medium|large)_/, `_${size}_`);
      if (supportsWebP) {
        newFilename = newFilename.replace(/\.jpg$/, '.webp');
      }
      urlParts[urlParts.length - 1] = newFilename;
      return urlParts.join('/');
    }
    
    // For legacy URLs without size suffix, return as-is
    return baseAvatarUrl;
  }
}
