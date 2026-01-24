import { Module } from '@nestjs/common';
import { DiceGameGateway } from './dice-game.gateway';
import { PrismaModule } from '../../../common/prisma/prisma.module';
import { RedisModule } from '../../../common/redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  providers: [DiceGameGateway],
  exports: [DiceGameGateway],
})
export class DiceGameModule {}
