/**
 * Appeals Module - موديول الطعون
 */
import { Module } from "@nestjs/common";
import { AppealsController } from "./appeals.controller";
import { PrismaModule } from "../../common/prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [AppealsController],
})
export class AppealsModule {}
