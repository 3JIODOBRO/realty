import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server, ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext, private origins: string[]) {
    super(app);
  }

  connectToRedis(url: string) {
    const pub = new Redis(url);
    const sub = pub.duplicate();
    this.adapterConstructor = createAdapter(pub, sub);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins, credentials: true },
    });
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
