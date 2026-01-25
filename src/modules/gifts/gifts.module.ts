import { Module, forwardRef } from "@nestjs/common";
import { GiftsController } from "./gifts.controller";
import { GiftsService } from "./gifts.service";
import { MessagesModule } from "../messages/messages.module";
import { WebsocketModule } from "../websocket/websocket.module";

@Module({
  imports: [MessagesModule, forwardRef(() => WebsocketModule)],
  controllers: [GiftsController],
  providers: [GiftsService],
  exports: [GiftsService],
})
export class GiftsModule {}
