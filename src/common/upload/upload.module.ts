import { Module, Global } from "@nestjs/common";
import { UploadService } from "./upload.service";
import { UploadController } from "./upload.controller";
import { ImageProcessingService } from "./image-processing.service";
import { CloudinaryService } from "./cloudinary.service";

@Global()
@Module({
  controllers: [UploadController],
  providers: [UploadService, ImageProcessingService, CloudinaryService],
  exports: [UploadService, ImageProcessingService, CloudinaryService],
})
export class UploadModule {}
