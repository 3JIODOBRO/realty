import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.module';
import { ConversationsService } from './conversations.service';
import { CreateReportDto, TemplateDto } from './dto';

export const REPORT_REASONS = [
  { value: 'SPAM', label: 'Spam or advertising' },
  { value: 'FRAUD', label: 'Fraud / asks for prepayment' },
  { value: 'PHISHING', label: 'Suspicious link or asks for card details' },
  { value: 'OFFENSIVE', label: 'Offensive language' },
  { value: 'HARASSMENT', label: 'Harassment or threats' },
  { value: 'FAKE_LISTING', label: 'Listing does not exist / fake photos' },
  { value: 'DISCRIMINATION', label: 'Discrimination' },
  { value: 'OTHER', label: 'Other' },
] as const;

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService, private conversations: ConversationsService) {}

  async create(user: AuthUser, dto: CreateReportDto) {
    let reportedUserId = dto.reportedUserId;
    let conversationId = dto.conversationId;

    if (dto.messageId) {
      const msg = await this.prisma.message.findUnique({ where: { id: dto.messageId } });
      if (!msg) throw new NotFoundException('Message not found');
      if (!msg.senderId) throw new BadRequestException('System messages cannot be reported');
      reportedUserId = msg.senderId;
      conversationId = msg.conversationId;
    }
    if (!reportedUserId) throw new BadRequestException('messageId or reportedUserId is required');
    if (reportedUserId === user.id) throw new BadRequestException('You cannot report yourself');

    // Reporter must actually have talked to this user
    if (conversationId) {
      const { me, others } = await this.conversations.access(conversationId, user);
      if (!me || !others.some((o) => o.userId === reportedUserId)) throw new ForbiddenException();
    }

    const dup = await this.prisma.report.findFirst({
      where: { reporterId: user.id, reportedUserId, messageId: dto.messageId ?? null, status: { in: ['OPEN', 'IN_REVIEW'] } },
    });
    if (dup) throw new ConflictException('You have already reported this');

    return this.prisma.report.create({
      data: { reporterId: user.id, reportedUserId, conversationId, messageId: dto.messageId, reason: dto.reason, comment: dto.comment },
    });
  }
}

const DEFAULT_TEMPLATES = [
  { title: 'Still available', category: 'Availability', body: 'Hi {{buyerName}}! Yes, "{{listingTitle}}" is still available. When would you like to see it?' },
  { title: 'Offer a viewing', category: 'Viewing', body: 'I can show the property this week. Please send a viewing request with 2–3 convenient time slots.' },
  { title: 'Documents needed', category: 'Documents', body: 'To proceed I will need: ID, proof of income (last 3 months) and, if applicable, a reference from the previous landlord.' },
  { title: 'Price & terms', category: 'Terms', body: 'The price is {{price}}. Utilities are paid separately. Minimum term — 12 months, deposit — one month, paid via the secure deposit on the platform.' },
  { title: 'Not available', category: 'Availability', body: 'Thank you for your interest, unfortunately the property is already reserved.' },
];

@Injectable()
export class TemplatesService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string) {
    const count = await this.prisma.quickReplyTemplate.count({ where: { ownerId: userId } });
    if (count === 0) {
      await this.prisma.quickReplyTemplate.createMany({ data: DEFAULT_TEMPLATES.map((t) => ({ ...t, ownerId: userId })) });
    }
    return this.prisma.quickReplyTemplate.findMany({ where: { ownerId: userId }, orderBy: [{ usageCount: 'desc' }, { createdAt: 'asc' }] });
  }

  create(userId: string, dto: TemplateDto) {
    return this.prisma.quickReplyTemplate.create({ data: { ...dto, ownerId: userId } });
  }

  async update(userId: string, id: string, dto: TemplateDto) {
    const r = await this.prisma.quickReplyTemplate.updateMany({ where: { id, ownerId: userId }, data: dto });
    if (!r.count) throw new NotFoundException();
    return { ok: true };
  }

  async remove(userId: string, id: string) {
    await this.prisma.quickReplyTemplate.deleteMany({ where: { id, ownerId: userId } });
    return { ok: true };
  }

  /** Fill {{variables}} with conversation context. */
  async render(user: AuthUser, id: string, conversationId: string) {
    const tpl = await this.prisma.quickReplyTemplate.findFirst({ where: { id, ownerId: user.id } });
    if (!tpl) throw new NotFoundException();
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { listing: true, participants: { include: { user: true } } },
    });
    if (!conv || !conv.participants.some((p) => p.userId === user.id)) throw new ForbiddenException();
    const buyer = conv.participants.find((p) => p.role === 'BUYER')?.user;
    const seller = conv.participants.find((p) => p.role === 'SELLER')?.user;
    const price = new Intl.NumberFormat('en-US', { style: 'currency', currency: conv.listing.currency, maximumFractionDigits: 0 })
      .format(Number(conv.listing.price)) + (conv.listing.rentPeriod ? ` / ${conv.listing.rentPeriod}` : '');
    const vars: Record<string, string> = {
      buyerName: buyer?.name.split(' ')[0] ?? '',
      sellerName: seller?.name ?? '',
      listingTitle: conv.listing.title,
      address: conv.listing.address,
      price,
    };
    return { templateId: tpl.id, text: tpl.body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '') };
  }
}
