import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.module';
import { analyzeText, RuleResult } from './rules';

export const AI_MODERATION_QUEUE = 'ai-moderation';

@Injectable()
export class ModerationService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue(AI_MODERATION_QUEUE) private aiQueue: Queue,
  ) {}

  check(text: string | null | undefined): RuleResult {
    if (!text?.trim()) return { verdict: 'ALLOW', flags: [], sanitized: text ?? '' };
    return analyzeText(text);
  }

  /** Second pass, async — only when an AI provider is configured. */
  async enqueueAiReview(messageId: string) {
    if (!process.env.ANTHROPIC_API_KEY) return;
    await this.aiQueue.add('review', { messageId }, { removeOnComplete: true, removeOnFail: 100, attempts: 2 });
  }

  /**
   * Repeat offenders: 3+ blocked messages in 24h → automated report to support.
   * We do not auto-ban — a human decides — but the report jumps the queue.
   */
  async trackOffender(userId: string, conversationId: string, messageId: string) {
    const since = new Date(Date.now() - 24 * 3600_000);
    const blocked = await this.prisma.message.count({
      where: { senderId: userId, verdict: 'BLOCK', createdAt: { gte: since } },
    });
    if (blocked < 3) return;
    const existing = await this.prisma.report.findFirst({
      where: { reportedUserId: userId, automated: true, status: { in: ['OPEN', 'IN_REVIEW'] } },
    });
    if (existing) return;
    const system = await this.systemUser();
    await this.prisma.report.create({
      data: {
        reporterId: system.id,
        reportedUserId: userId,
        conversationId,
        messageId,
        reason: 'FRAUD',
        automated: true,
        comment: `${blocked} messages blocked by the moderation filter in 24h`,
      },
    });
  }

  async systemUser() {
    return this.prisma.user.upsert({
      where: { email: 'system@realty.local' },
      update: {},
      create: { email: 'system@realty.local', name: 'Safety System', role: 'ADMIN' },
    });
  }
}

interface AiVerdict {
  verdict: 'ALLOW' | 'WARN' | 'BLOCK';
  categories: string[];
  reason: string;
}

@Processor(AI_MODERATION_QUEUE)
export class AiModerationProcessor extends WorkerHost {
  private log = new Logger('AiModeration');

  constructor(private prisma: PrismaService, private realtime: RealtimeService, private moderation: ModerationService) {
    super();
  }

  async process(job: Job<{ messageId: string }>) {
    const msg = await this.prisma.message.findUnique({
      where: { id: job.data.messageId },
      include: { conversation: { include: { participants: true, listing: true } } },
    });
    if (!msg?.body || msg.verdict === 'BLOCK' || msg.hiddenAt) return;

    // Small context window: the previous messages help spot multi-step scams.
    const context = await this.prisma.message.findMany({
      where: { conversationId: msg.conversationId, createdAt: { lt: msg.createdAt }, kind: 'TEXT' },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { senderId: true, body: true },
    });

    const result = await this.ask(msg.body, context.reverse().map((c) => c.body ?? ''), msg.conversation.listing.title);
    if (!result || result.verdict === 'ALLOW') return;

    const recipients = msg.conversation.participants.map((p) => p.userId);
    if (result.verdict === 'BLOCK') {
      await this.prisma.message.update({
        where: { id: msg.id },
        data: { hiddenAt: new Date(), verdict: 'BLOCK', moderationFlags: { push: result.categories.map((c) => 'ai:' + c) } },
      });
      this.realtime.toUsers(recipients, 'message:hidden', { conversationId: msg.conversationId, messageId: msg.id, reason: result.reason });
      if (msg.senderId) await this.moderation.trackOffender(msg.senderId, msg.conversationId, msg.id);
    } else {
      await this.prisma.message.update({
        where: { id: msg.id },
        data: { verdict: 'WARN', moderationFlags: { push: result.categories.map((c) => 'ai:' + c) } },
      });
      this.realtime.toUsers(recipients, 'message:flagged', {
        conversationId: msg.conversationId,
        messageId: msg.id,
        safetyTip: result.reason,
      });
    }
  }

  private async ask(text: string, context: string[], listingTitle: string): Promise<AiVerdict | null> {
    const prompt = `You moderate a real-estate marketplace chat between a buyer/tenant and a seller/landlord about "${listingTitle}".
Classify the LAST message. Categories: profanity, harassment, phishing, fraud (advance-fee, fake landlord, off-platform payment, identity theft), discrimination, spam.
Return ONLY JSON: {"verdict":"ALLOW"|"WARN"|"BLOCK","categories":[...],"reason":"one short sentence for the other party, in the language of the message"}.
BLOCK only for clear phishing, credential/card harvesting, or explicit threats.

Previous messages:
${context.map((c) => '- ' + c).join('\n') || '(none)'}

LAST message:
${text}`;
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: process.env.AI_MODERATION_MODEL ?? 'claude-haiku-5-5',
          max_tokens: 200,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
      const raw = data.content.find((c) => c.type === 'text')?.text ?? '';
      const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
      return JSON.parse(json) as AiVerdict;
    } catch (e) {
      this.log.warn(`AI review failed: ${(e as Error).message}`);
      return null;
    }
  }
}

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: AI_MODERATION_QUEUE })],
  providers: [ModerationService, AiModerationProcessor],
  exports: [ModerationService],
})
export class ModerationModule {}
