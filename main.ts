import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap() {
  const origins = process.env.WEB_ORIGIN?.split(',') ?? ['http://localhost:3000'];
  // rawBody is needed for Stripe webhook signature verification
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    cors: { origin: origins, credentials: true },
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Socket.IO across several API instances: events fan out through Redis pub/sub.
  const io = new RedisIoAdapter(app, origins);
  io.connectToRedis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  app.useWebSocketAdapter(io);

  await app.listen(Number(process.env.PORT ?? 4000));
}
bootstrap();
