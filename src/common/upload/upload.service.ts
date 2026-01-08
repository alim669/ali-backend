import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

export interface UploadResult {
  url: string;
  filename: string;
  path: string;
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly uploadDir: string;
  private readonly baseUrl: string;

  constructor(private configService: ConfigService) {
    this.uploadDir = this.configService.get<string>(
      "UPLOAD_DIR",
      "/var/www/uploads",
    );
    this.baseUrl = this.configService.get<string>(
      "BASE_URL",
      "http://167.235.64.220",
    );

    // Create upload directories
    this.ensureDirectories();
    this.logger.log(`📁 Upload service initialized: ${this.uploadDir}`);
  }

  private ensureDirectories() {
    const dirs = ["avatars", "rooms", "messages", "gifts"];
    for (const dir of dirs) {
      const fullPath = path.join(this.uploadDir, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }
  }

  async uploadImage(
    file: Express.Multer.File,
    folder: string = "general",
  ): Promise<UploadResult> {
    const filename = `${uuidv4()}${path.extname(file.originalname)}`;
    const filePath = path.join(this.uploadDir, folder, filename);

    await fs.promises.writeFile(filePath, file.buffer);

    const url = `${this.baseUrl}/uploads/${folder}/${filename}`;
    this.logger.log(`📤 Image uploaded: ${url}`);

    return {
      url,
      filename,
      path: filePath,
    };
  }

  async uploadAvatar(
    file: Express.Multer.File,
    userId: string,
  ): Promise<UploadResult> {
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

    await fs.promises.writeFile(filePath, file.buffer);

    const url = `${this.baseUrl}/uploads/avatars/${filename}`;
    this.logger.log(`📤 Avatar uploaded: ${url}`);

    return {
      url,
      filename,
      path: filePath,
    };
  }

  async uploadRoomImage(
    file: Express.Multer.File,
    roomId: string,
  ): Promise<UploadResult> {
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
