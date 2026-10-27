import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConversationParticipant, ParticipantRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.module';

export const LISTING_CARD_SELECT = {
  id: true, title: true, type: true, status: true, price: true, currency: true, rentPeriod: true,
  areaM2: true, rooms: true, address: true, city: true, photos: true, lat: true, lng: true, ownerId: true,
} as const;

export type MessageStatus = 'sent' | 'delivered' | 'read';

/** Derive ✓ / ✓✓ / blue ✓✓ from the counterpart's cursors. */
export function statusFor(createdAt: Date, counterpart?: Pick<ConversationParticipant, 'lastDeliveredAt' | 'lastReadAt'>): MessageStatus {
  if (counterpart?.lastReadAt && counterpart.lastReadAt >= createdAt) return 'read';
  if (counterpart?.lastDeliveredAt && counterpart.lastDeliveredAt >= createdAt) return 'delivered';
  return 'sent';
}

export const oppositeRole = (r: ParticipantRole): ParticipantRole => (r === 'BUYER' ? 'SELLER' : 'BUYER');

@Injectable()
export class ConversationsService {
  constructor(private prisma: PrismaService) {}

  /** One conversation per (listing, buyer). Re-opening returns the existing one. */
  async startOrGet(buyerId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.ownerId === buyerId) throw new BadRequestException('You cannot message your own listing');

    const existing = await this.prisma.conversation.findUnique({ where: { listingId_buyerId: { listingId, buyerId } } });
    if (existing) return existing;
    if (listing.status !== 'ACTIVE' && listing.status !== 'RESERVED') throw new BadRequestException('Listing is not available');

    return this.prisma.conversation.create({
      data: {
        listingId,
        buyerId,
        participants: {
          create: [
            { userId: buyerId, role: 'BUYER' },
            { userId: listing.ownerId, role: 'SELLER' },
          ],
        },
      },
    });
  }

  /** Throws unless the user takes part (support/admin may read any conversation). */
  async access(conversationId: string, user: AuthUser) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: true },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    const me = conv.participants.find((p) => p.userId === user.id);
    if (!me && user.role === 'USER') throw new ForbiddenException();
    return { conv, me, others: conv.participants.filter((p) => p.userId !== user.id) };
  }

  async inbox(user: AuthUser, filter: { role?: ParticipantRole; unanswered?: boolean } = {}) {
    const parts = await this.prisma.conversationParticipant.findMany({
      where: { userId: user.id, ...(filter.role ? { role: filter.role } : {}) },
      include: {
        conversation: {
          include: {
            listing: { select: LISTING_CARD_SELECT },
            participants: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
            messages: {
              where: { OR: [{ verdict: { not: 'BLOCK' } }, { senderId: user.id }] },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { conversation: { lastMessageAt: 'desc' } },
      take: 100,
    });

    return Promise.all(
      parts
        .filter((p) => !filter.unanswered || p.conversation.awaitingReplyFrom === p.role)
        .map(async (p) => {
          const c = p.conversation;
          const unread = await this.prisma.message.count({
            where: {
              conversationId: c.id,
              senderId: { not: user.id },
              verdict: { not: 'BLOCK' },
              createdAt: p.lastReadAt ? { gt: p.lastReadAt } : undefined,
            },
          });
          const counterpart = c.participants.find((x) => x.userId !== user.id && x.role !== 'SUPPORT');
          const last = c.messages[0];
          return {
            id: c.id,
            status: c.status,
            myRole: p.role,
            listing: c.listing,
            counterpart: counterpart?.user,
            awaitingReplyFrom: c.awaitingReplyFrom,
            awaitingSince: c.awaitingSince,
            lastMessage: last && {
              ...last,
              status: last.senderId === user.id ? statusFor(last.createdAt, counterpart) : undefined,
            },
            unread,
          };
        }),
    );
  }

  async details(conversationId: string, user: AuthUser) {
    await this.access(conversationId, user);
    return this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        listing: { select: LISTING_CARD_SELECT },
        participants: { include: { user: { select: { id: true, name: true, avatarUrl: true, createdAt: true } } } },
      },
    });
  }
}
