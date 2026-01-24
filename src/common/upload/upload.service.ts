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
    this.uploadDir =
      this.configService.get<string>("UPLOAD_DIR") ||
      this.configService.get<string>("UPLOAD_DEST") ||
      this.configService.get<string>("upload.destination") ||
      "./uploads";
    this.baseUrl = this.configService.get<string>(
      "BASE_URL",
      "http://167.235.64.220",
    );

    // Create upload directories
    this.ensureDirectories();
    this.logger.log(`📁 Upload service initialized: ${this.uploadDir}`);
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
    const filename = `${uuidv4()}${path.extname(file.originalname) || ".mp4"}`;
    const filePath = path.join(this.uploadDir, safeFolder, filename);

    await fs.promises.writeFile(filePath, file.buffer);

    const url = this.buildPublicUrl(safeFolder, filename);
    this.logger.log(`🎬 Video uploaded: ${url}`);

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
