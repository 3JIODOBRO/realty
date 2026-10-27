import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.module';
import { ListingsService } from '../listings/listings.module';

export const REMINDERS_QUEUE = 'chat-reminders';

interface ReminderJob {
  conversationId: string;
  /** awaitingSince at scheduling time — if it changed, the seller already replied */
  since: number;
  step: 1 | 2;
}

const minutes = (env: string | undefined, def: number) => Number(env ?? def) * 60_000;

/**
 * Buyer wrote and the seller is silent:
 *   step 1 (default 2h)  → push/in-app notification to the seller
 *   step 2 (default 24h) → second nudge to the seller + system message to the buyer with similar listings
 * No cancellation needed: the processor no-ops if the conversation state moved on.
 */
@Injectable()
export class RemindersService {
  constructor(@InjectQueue(REMINDERS_QUEUE) private queue: Queue<ReminderJob>) {}

  async scheduleForSeller(conversationId: string, since: Date) {
    const base = { conversationId, since: since.getTime() };
    const opts = { removeOnComplete: true, removeOnFail: 50 };
    await this.queue.add('remind', { ...base, step: 1 }, {
      ...opts, delay: minutes(process.env.REMINDER_FIRST_MIN, 120), jobId: `r:${conversationId}:${base.since}:1`,
    });
    await this.queue.add('remind', { ...base, step: 2 }, {
      ...opts, delay: minutes(process.env.REMINDER_SECOND_MIN, 1440), jobId: `r:${conversationId}:${base.since}:2`,
    });
  }
}

@Processor(REMINDERS_QUEUE)
export class RemindersProcessor extends WorkerHost {
  private log = new Logger('Reminders');

  constructor(private prisma: PrismaService, private realtime: RealtimeService, private listings: ListingsService) {
    super();
  }

  async process(job: Job<ReminderJob>) {
    const { conversationId, since, step } = job.data;
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: { include: { user: true } }, listing: true },
    });
    if (!conv || conv.status !== 'OPEN') return;
    if (conv.awaitingReplyFrom !== 'SELLER' || conv.awaitingSince?.getTime() !== since) return; // answered

    const seller = conv.participants.find((p) => p.role === 'SELLER');
    const buyer = conv.participants.find((p) => p.role === 'BUYER');
    if (!seller || !buyer) return;

    const hours = Math.round((Date.now() - since) / 3600_000);
    const notification = await this.prisma.notification.create({
      data: {
        userId: seller.userId,
        type: 'UNANSWERED_CONVERSATION',
        data: { conversationId, listingTitle: conv.listing.title, buyerName: buyer.user.name, hours, step },
      },
    });
    this.realtime.toUsers([seller.userId], 'notification', notification);
    // Email/SMS/push providers plug in here (SES, FCM/APNs). Logged for now.
    this.log.log(`Reminder #${step} → ${seller.user.email}: ${buyer.user.name} waits ${hours}h on "${conv.listing.title}"`);

    if (step === 2) {
      const similar = await this.listings.similar(conv.listingId, 3).catch(() => []);
      const msg = await this.prisma.message.create({
        data: {
          conversationId,
          kind: 'SYSTEM',
          payload: { event: 'seller_slow', hours, similar, audience: 'BUYER' },
          body: `The owner hasn't replied for ${hours} hours. We've sent them a reminder. Meanwhile, here are similar options nearby.`,
        },
      });
      this.realtime.toUsers([buyer.userId], 'message:new', { ...msg, mine: false, attachments: [] });
    }
  }
}
