import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Message, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.module';
import { RealtimeService } from '../realtime/realtime.module';
import { AuthUser } from '../auth/auth.module';
import { ConversationsService, oppositeRole, statusFor } from './conversations.service';
import { RemindersService } from './reminders';
import { HistoryQuery, RespondDto, SendMessageDto } from './dto';

const MESSAGE_INCLUDE = {
  attachments: { select: { id: true, kind: true, fileName: true, mimeType: true, sizeBytes: true } },
  sender: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.MessageInclude;

type MessageWithRelations = Prisma.MessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private conversations: ConversationsService,
    private moderation: ModerationService,
    private realtime: RealtimeService,
    private reminders: RemindersService,
  ) {}

  async send(user: AuthUser, dto: SendMessageDto) {
    const { conv, me, others } = await this.conversations.access(dto.conversationId, user);
    if (!me) throw new ForbiddenException('Join the conversation first');
    if (conv.status !== 'OPEN') throw new BadRequestException('Conversation is closed');

    // Role-specific deal actions
    if (dto.kind === 'MEETING_REQUEST' && (me.role !== 'BUYER' || !dto.meeting)) throw new BadRequestException('Only the buyer/tenant can request a showing');
    if (dto.kind === 'OFFER' && (me.role !== 'SELLER' || !dto.offer)) throw new BadRequestException('Only the seller/landlord can send an offer');
    if (dto.kind === 'ATTACHMENT' && !dto.attachmentIds?.length) throw new BadRequestException('No attachments');

    // Idempotent retry: same clientId from same sender returns the stored message
    const dup = await this.prisma.message.findUnique({
      where: { senderId_clientId: { senderId: user.id, clientId: dto.clientId } },
      include: MESSAGE_INCLUDE,
    });
    if (dup) return { message: this.present(dup, user.id, others[0]), blocked: dup.verdict === 'BLOCK' };

    // Moderate every free-text field
    const text = [dto.body, dto.meeting?.note, dto.offer?.conditions].filter(Boolean).join('\n');
    const mod = this.moderation.check(text);

    if (dto.attachmentIds?.length) {
      const ok = await this.prisma.attachment.count({
        where: { id: { in: dto.attachmentIds }, conversationId: conv.id, uploaderId: user.id, status: 'READY', messageId: null },
      });
      if (ok !== dto.attachmentIds.length) throw new BadRequestException('Attachments are not uploaded yet');
    }

    const payload =
      dto.kind === 'MEETING_REQUEST' ? { ...dto.meeting, status: 'PENDING' }
      : dto.kind === 'OFFER' ? { ...dto.offer, status: 'PENDING' }
      : undefined;

    const now = new Date();
    const message = await this.prisma.$transaction(async (tx) => {
      const m = await tx.message.create({
        data: {
          conversationId: conv.id,
          senderId: user.id,
          clientId: dto.clientId,
          kind: dto.kind,
          // Blocked: keep the original for support review. Otherwise store with profanity masked.
          body: dto.body ? (mod.verdict === 'BLOCK' ? dto.body : this.sanitizeBody(dto.body)) : null,
          payload: payload as Prisma.InputJsonValue | undefined,
          verdict: mod.verdict,
          moderationFlags: mod.flags,
          createdAt: now,
          attachments: dto.attachmentIds?.length && mod.verdict !== 'BLOCK' ? { connect: dto.attachmentIds.map((id) => ({ id })) } : undefined,
        },
        include: MESSAGE_INCLUDE,
      });
      if (mod.verdict !== 'BLOCK') {
        await tx.conversation.update({
          where: { id: conv.id },
          data: {
            lastMessageAt: now,
            awaitingReplyFrom: oppositeRole(me.role === 'SUPPORT' ? 'SELLER' : me.role),
            // keep the original timestamp while the same side keeps writing
            awaitingSince: conv.awaitingReplyFrom === oppositeRole(me.role) ? conv.awaitingSince : now,
          },
        });
        // Sender has obviously read everything up to now
        await tx.conversationParticipant.update({ where: { id: me.id }, data: { lastReadAt: now, lastDeliveredAt: now } });
      }
      if (dto.templateId) {
        await tx.quickReplyTemplate.updateMany({ where: { id: dto.templateId, ownerId: user.id }, data: { usageCount: { increment: 1 } } });
      }
      return m;
    });

    if (mod.verdict === 'BLOCK') {
      await this.moderation.trackOffender(user.id, conv.id, message.id);
      return { message: this.present(message, user.id, others[0]), blocked: true, notice: mod.senderNotice };
    }

    // Reminders: buyer wrote → start the clock for the seller; seller wrote → clock stops (processor checks state)
    if (me.role === 'BUYER' && conv.awaitingReplyFrom !== 'SELLER') {
      await this.reminders.scheduleForSeller(conv.id, now);
    }

    const counterpart = others.find((o) => o.role !== 'SUPPORT');
    const outgoing = { ...this.present(message, user.id, counterpart), safetyTip: mod.safetyTip };
    this.realtime.toUsers(others.map((o) => o.userId), 'message:new', { ...outgoing, mine: false, status: undefined });
    this.realtime.toUsers([user.id], 'message:new', { ...outgoing, mine: true });
    await this.moderation.enqueueAiReview(message.id);

    return { message: outgoing, blocked: false };
  }

  private sanitizeBody(body: string) {
    return this.moderation.check(body).sanitized;
  }

  async history(user: AuthUser, conversationId: string, q: HistoryQuery) {
    const { me, others } = await this.conversations.access(conversationId, user);
    const counterpart = others.find((o) => o.role !== 'SUPPORT');
    const isStaff = user.role !== 'USER';
    // System messages can target one side only (e.g. "owner is slow, see similar listings" → buyer)
    const visible = (m: Message) => {
      const audience = (m.payload as { audience?: string } | null)?.audience;
      return isStaff || m.kind !== 'SYSTEM' || !audience || audience === me?.role;
    };
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        createdAt: q.before ? { lt: new Date(q.before) } : undefined,
        // Blocked messages are visible only to their sender (as "not delivered") and to support
        ...(isStaff ? {} : { OR: [{ verdict: { not: 'BLOCK' } }, { senderId: user.id }] }),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit ?? 50,
      include: MESSAGE_INCLUDE,
    });
    return rows.reverse().filter(visible).map((m) => this.present(m, user.id, counterpart, isStaff));
  }

  present(m: MessageWithRelations | Message & Partial<MessageWithRelations>, viewerId: string, counterpart?: { lastDeliveredAt: Date | null; lastReadAt: Date | null }, isStaff = false) {
    const mine = m.senderId === viewerId;
    const hidden = !!m.hiddenAt && !isStaff;
    return {
      id: m.id,
      clientId: mine ? m.clientId : undefined,
      conversationId: m.conversationId,
      senderId: m.senderId,
      sender: m.sender,
      kind: m.kind,
      body: hidden ? null : m.body,
      payload: hidden ? null : m.payload,
      attachments: hidden ? [] : m.attachments ?? [],
      createdAt: m.createdAt,
      verdict: m.verdict,
      flags: isStaff ? m.moderationFlags : undefined,
      hidden,
      mine,
      status: mine ? (m.verdict === 'BLOCK' ? 'blocked' : statusFor(m.createdAt, counterpart)) : undefined,
    };
  }

  /** ✓✓ — called by the recipient's client when messages arrive on the device. */
  async markDelivered(user: AuthUser, conversationId: string, upTo: Date) {
    return this.moveCursor(user, conversationId, 'lastDeliveredAt', upTo);
  }

  /** Blue ✓✓ — called when the conversation is open and visible. Read implies delivered. */
  async markRead(user: AuthUser, conversationId: string, upTo: Date) {
    await this.moveCursor(user, conversationId, 'lastDeliveredAt', upTo);
    return this.moveCursor(user, conversationId, 'lastReadAt', upTo);
  }

  private async moveCursor(user: AuthUser, conversationId: string, field: 'lastDeliveredAt' | 'lastReadAt', upTo: Date) {
    const { me, others } = await this.conversations.access(conversationId, user);
    if (!me) return null;
    const capped = upTo > new Date() ? new Date() : upTo;
    // Only move forward — out-of-order receipts from several devices are harmless
    const res = await this.prisma.conversationParticipant.updateMany({
      where: { id: me.id, OR: [{ [field]: null }, { [field]: { lt: capped } }] },
      data: { [field]: capped },
    });
    if (res.count) {
      this.realtime.toUsers(others.map((o) => o.userId), 'receipt', {
        conversationId,
        userId: user.id,
        kind: field === 'lastReadAt' ? 'read' : 'delivered',
        upTo: capped.toISOString(),
      });
    }
    return capped;
  }

  /** On socket connect: everything waiting for this user is now delivered. */
  async markAllDelivered(user: AuthUser) {
    const parts = await this.prisma.conversationParticipant.findMany({
      where: { userId: user.id, conversation: { status: 'OPEN' } },
      include: { conversation: { select: { lastMessageAt: true } } },
    });
    for (const p of parts) {
      if (!p.lastDeliveredAt || p.lastDeliveredAt < p.conversation.lastMessageAt) {
        await this.markDelivered(user, p.conversationId, p.conversation.lastMessageAt);
      }
    }
  }

  /** Seller answers a meeting request, buyer answers an offer. */
  async respond(user: AuthUser, messageId: string, dto: RespondDto) {
    const msg = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!msg || (msg.kind !== 'MEETING_REQUEST' && msg.kind !== 'OFFER')) throw new NotFoundException();
    const { me, others } = await this.conversations.access(msg.conversationId, user);
    if (!me || msg.senderId === user.id) throw new ForbiddenException();
    const payload = (msg.payload ?? {}) as Record<string, unknown>;
    if (payload.status !== 'PENDING') throw new BadRequestException('Already answered');
    if (msg.kind === 'MEETING_REQUEST' && dto.action === 'ACCEPT') {
      const slots = (payload.slots as string[]) ?? [];
      if (!dto.slot || !slots.includes(dto.slot)) throw new BadRequestException('Pick one of the proposed slots');
    }

    const status = dto.action === 'ACCEPT' ? 'ACCEPTED' : dto.action === 'DECLINE' ? 'DECLINED' : 'COUNTERED';
    const updated = await this.prisma.message.update({
      where: { id: msg.id },
      data: { payload: { ...payload, status, chosenSlot: dto.slot, responseNote: dto.note, respondedAt: new Date().toISOString() } },
      include: MESSAGE_INCLUDE,
    });

    const system = await this.postSystem(msg.conversationId, {
      event: msg.kind === 'OFFER' ? `offer_${status.toLowerCase()}` : `meeting_${status.toLowerCase()}`,
      refMessageId: msg.id,
      slot: dto.slot,
      by: user.name,
    });
    if (me.role === 'SELLER') {
      await this.prisma.conversation.update({ where: { id: msg.conversationId }, data: { awaitingReplyFrom: 'BUYER', awaitingSince: new Date() } });
    }

    const everyone = [user.id, ...others.map((o) => o.userId)];
    this.realtime.toUsers(everyone, 'message:updated', { conversationId: msg.conversationId, id: msg.id, payload: updated.payload });
    return { message: updated, system };
  }

  async postSystem(conversationId: string, payload: Record<string, unknown>, body?: string) {
    const m = await this.prisma.message.create({
      data: { conversationId, kind: 'SYSTEM', payload: payload as Prisma.InputJsonValue, body },
      include: MESSAGE_INCLUDE,
    });
    const parts = await this.prisma.conversationParticipant.findMany({ where: { conversationId } });
    for (const p of parts) this.realtime.toUsers([p.userId], 'message:new', this.present(m, p.userId));
    return m;
  }
}
