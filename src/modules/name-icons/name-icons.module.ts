import { Module } from '@nestjs/common';
import { NameIconsService } from './name-icons.service';
import { NameIconsController } from './name-icons.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [PrismaModule, WalletsModule],
  controllers: [NameIconsController],
  providers: [NameIconsService],
  exports: [NameIconsService],
})
export class NameIconsModule {}
