import { Module } from "@nestjs/common";
import { GiftsController } from "./gifts.controller";
import { GiftsService } from "./gifts.service";
import { MessagesModule } from "../messages/messages.module";

@Module({
  imports: [MessagesModule],
  controllers: [GiftsController],
  providers: [GiftsService],
  exports: [GiftsService],
})
export class GiftsModule {}
