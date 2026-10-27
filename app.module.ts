import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ModerationModule } from './moderation/moderation.module';
import { ListingsModule } from './listings/listings.module';
import { ChatModule } from './chat/chat.module';
import { SupportModule } from './support/support.module';
import { PaymentsModule } from './payments/payments.module';
import { redisConnection } from './common/redis';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({ connection: redisConnection() }),
    PrismaModule,
    AuthModule,
    RealtimeModule,
    ModerationModule,
    ListingsModule,
    ChatModule,
    SupportModule,
    PaymentsModule,
  ],
})
export class AppModule {}
