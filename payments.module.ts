import { BadRequestException, Body, Controller, ForbiddenException, Headers, Module, NotFoundException, Post, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { Request } from 'express';
import Stripe from 'stripe';
import { AuthGuard, AuthUser, CurrentUser } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChatModule } from '../chat/chat.module';
import { MessagesService } from '../chat/messages.service';

class ReserveDto {
  /** An ACCEPTED offer message with a deposit */
  @IsString() offerMessageId: string;
}

/**
 * Secure reservation deposit: the only sanctioned way to pay inside a conversation.
 * Funds are authorized (manual capture) and captured on move-in confirmation —
 * this is what the moderation safety tips point users to instead of off-platform transfers.
 */
@Controller('payments')
export class PaymentsController {
  private stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder');

  constructor(private prisma: PrismaService, private messages: MessagesService) {}

  @Post('reservations')
  @UseGuards(AuthGuard)
  async reserve(@CurrentUser() u: AuthUser, @Body() dto: ReserveDto) {
    const offer = await this.prisma.message.findUnique({
      where: { id: dto.offerMessageId },
      include: { conversation: { include: { participants: true } } },
    });
    if (!offer || offer.kind !== 'OFFER') throw new NotFoundException();
    const buyer = offer.conversation.participants.find((p) => p.role === 'BUYER');
    if (buyer?.userId !== u.id) throw new ForbiddenException();
    const p = offer.payload as { deposit?: number; currency: string; status: string };
    if (p.status !== 'ACCEPTED' || !p.deposit) throw new BadRequestException('Accept an offer with a deposit first');

    const intent = await this.stripe.paymentIntents.create({
      amount: Math.round(p.deposit * 100),
      currency: p.currency.toLowerCase(),
      capture_method: 'manual',
      metadata: { conversationId: offer.conversationId, offerMessageId: offer.id, buyerId: u.id },
    });
    return { clientSecret: intent.client_secret };
  }

  @Post('webhook')
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') sig: string) {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(req.rawBody!, sig, process.env.STRIPE_WEBHOOK_SECRET ?? '');
    } catch {
      throw new BadRequestException('Bad signature');
    }
    if (event.type === 'payment_intent.amount_capturable_updated') {
      const pi = event.data.object as Stripe.PaymentIntent;
      const { conversationId, offerMessageId } = pi.metadata;
      await this.prisma.listing.updateMany({
        where: { conversations: { some: { id: conversationId } }, status: 'ACTIVE' },
        data: { status: 'RESERVED' },
      });
      await this.messages.postSystem(conversationId, { event: 'deposit_held', offerMessageId, amount: pi.amount / 100, currency: pi.currency },
        'Deposit received and held securely by the platform. The property is now reserved.');
    }
    return { received: true };
  }
}

@Module({ imports: [ChatModule], controllers: [PaymentsController] })
export class PaymentsModule {}
