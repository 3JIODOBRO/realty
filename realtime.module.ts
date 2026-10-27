import { Global, Injectable, Module } from '@nestjs/common';
import { Server } from 'socket.io';

export const userRoom = (userId: string) => `user:${userId}`;

/**
 * Thin wrapper around the Socket.IO server so services (reminders, moderation, support)
 * can push events without depending on the gateway (avoids circular DI).
 * Every socket joins `user:<id>`, so emitting to a user reaches all their devices on all nodes.
 */
@Injectable()
export class RealtimeService {
  private server?: Server;

  attach(server: Server) {
    this.server = server;
  }

  toUsers(userIds: string[], event: string, data: unknown) {
    if (!this.server || userIds.length === 0) return;
    this.server.to(userIds.map(userRoom)).emit(event, data);
  }

  disconnectUser(userId: string) {
    this.server?.in(userRoom(userId)).disconnectSockets(true);
  }
}

@Global()
@Module({ providers: [RealtimeService], exports: [RealtimeService] })
export class RealtimeModule {}
