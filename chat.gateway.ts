import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayInit, SubscribeMessage, WebSocketGateway, WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService, AuthUser } from '../auth/auth.module';
import { RealtimeService, userRoom } from '../realtime/realtime.module';
import { ConversationsService } from './conversations.service';
import { MessagesService } from './messages.service';
import { ReceiptDto, SendMessageDto } from './dto';

type AuthedSocket = Socket & { data: { user: AuthUser } };

/**
 * Client → server: message:send (ack), message:delivered, message:read, typing
 * Server → client: message:new, message:updated, message:hidden, message:flagged, receipt, typing, notification
 */
@WebSocketGateway({ namespace: '/chat' })
@UsePipes(new ValidationPipe({ whitelist: true, transform: true, exceptionFactory: (e) => new WsException(e) }))
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
  private log = new Logger('ChatGateway');

  constructor(
    private auth: AuthService,
    private realtime: RealtimeService,
    private messages: MessagesService,
    private conversations: ConversationsService,
  ) {}

  afterInit(server: Server) {
    this.realtime.attach(server);
  }

  async handleConnection(socket: AuthedSocket) {
    try {
      const token = (socket.handshake.auth?.token as string | undefined) ?? undefined;
      const user = await this.auth.verify(token);
      socket.data.user = user;
      await socket.join(userRoom(user.id));
      // Coming online = everything queued for this user is now delivered (✓ → ✓✓ for senders)
      await this.messages.markAllDelivered(user);
    } catch (e) {
      socket.emit('error', { message: (e as Error).message });
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('message:send')
  async send(@ConnectedSocket() s: AuthedSocket, @MessageBody() dto: SendMessageDto) {
    try {
      return await this.messages.send(s.data.user, dto);
    } catch (e) {
      return { error: (e as Error).message, clientId: dto.clientId };
    }
  }

  @SubscribeMessage('message:delivered')
  async delivered(@ConnectedSocket() s: AuthedSocket, @MessageBody() dto: ReceiptDto) {
    await this.messages.markDelivered(s.data.user, dto.conversationId, new Date(dto.upTo));
  }

  @SubscribeMessage('message:read')
  async read(@ConnectedSocket() s: AuthedSocket, @MessageBody() dto: ReceiptDto) {
    await this.messages.markRead(s.data.user, dto.conversationId, new Date(dto.upTo));
  }

  @SubscribeMessage('typing')
  async typing(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: { conversationId: string; isTyping: boolean }) {
    const { others } = await this.conversations.access(body.conversationId, s.data.user);
    this.realtime.toUsers(others.map((o) => o.userId), 'typing', {
      conversationId: body.conversationId,
      userId: s.data.user.id,
      isTyping: !!body.isTyping,
    });
  }
}
