import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ReportStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthGuard, AuthUser, CurrentUser, Roles } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.module';
import { ChatModule } from '../chat/chat.module';
import { MessagesService } from '../chat/messages.service';

class ResolveDto {
  @IsIn(['DISMISS', 'WARN_USER', 'HIDE_MESSAGE', 'BLOCK_USER']) action: 'DISMISS' | 'WARN_USER' | 'HIDE_MESSAGE' | 'BLOCK_USER';
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

class BlockDto {
  @IsString() @MaxLength(500) reason: string;
}

@Controller('support')
@UseGuards(AuthGuard)
@Roles('SUPPORT', 'ADMIN')
export class SupportController {
  constructor(private prisma: PrismaService, private realtime: RealtimeService, private messages: MessagesService) {}

  /** Queue: automated + multi-reporter cases first */
  @Get('reports')
  async queue(@Query('status') status: ReportStatus = 'OPEN') {
    const reports = await this.prisma.report.findMany({
      where: { status },
      include: {
        reporter: { select: { id: true, name: true } },
        reportedUser: { select: { id: true, name: true, blockedAt: true } },
        message: { select: { id: true, body: true, kind: true, moderationFlags: true, createdAt: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const againstCount = new Map<string, number>();
    reports.forEach((r) => againstCount.set(r.reportedUserId, (againstCount.get(r.reportedUserId) ?? 0) + 1));
    const severity = (r: (typeof reports)[number]) =>
      (r.automated ? 3 : 0) + (['FRAUD', 'PHISHING', 'HARASSMENT'].includes(r.reason) ? 2 : 0) + (againstCount.get(r.reportedUserId)! - 1);
    return reports.map((r) => ({ ...r, severity: severity(r) })).sort((a, b) => b.severity - a.severity);
  }

  /** Report with the surrounding conversation for context */
  @Get('reports/:id')
  async report(@Param('id') id: string) {
    const report = await this.prisma.report.findUnique({ where: { id }, include: { reporter: true, reportedUser: true, message: true } });
    if (!report) throw new NotFoundException();
    const context = report.conversationId
      ? await this.prisma.message.findMany({
          where: { conversationId: report.conversationId },
          orderBy: { createdAt: 'desc' },
          take: 30,
          include: { sender: { select: { id: true, name: true } } },
        })
      : [];
    const history = await this.prisma.report.groupBy({ by: ['status'], where: { reportedUserId: report.reportedUserId }, _count: true });
    return { report, context: context.reverse(), history };
  }

  @Post('reports/:id/resolve')
  async resolve(@CurrentUser() staff: AuthUser, @Param('id') id: string, @Body() dto: ResolveDto) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException();
    if (report.status === 'RESOLVED' || report.status === 'DISMISSED') throw new BadRequestException('Already closed');

    if (dto.action === 'HIDE_MESSAGE' && report.messageId) {
      const m = await this.prisma.message.update({ where: { id: report.messageId }, data: { hiddenAt: new Date() } });
      const parts = await this.prisma.conversationParticipant.findMany({ where: { conversationId: m.conversationId } });
      this.realtime.toUsers(parts.map((p) => p.userId), 'message:hidden', { conversationId: m.conversationId, messageId: m.id, reason: 'Removed by support' });
    }
    if (dto.action === 'WARN_USER' && report.conversationId) {
      await this.prisma.notification.create({
        data: { userId: report.reportedUserId, type: 'POLICY_WARNING', data: { reason: report.reason, note: dto.note } },
      });
    }
    if (dto.action === 'BLOCK_USER') await this.block(report.reportedUserId, dto.note ?? report.reason);

    // Close every open report against the same message/user that this decision covers
    await this.prisma.report.updateMany({
      where: {
        status: { in: ['OPEN', 'IN_REVIEW'] },
        ...(dto.action === 'BLOCK_USER' ? { reportedUserId: report.reportedUserId } : { id }),
      },
      data: {
        status: dto.action === 'DISMISS' ? 'DISMISSED' : 'RESOLVED',
        resolvedById: staff.id,
        resolution: `${dto.action}${dto.note ? ': ' + dto.note : ''}`,
        resolvedAt: new Date(),
      },
    });
    return { ok: true };
  }

  @Post('users/:id/block')
  blockUser(@Param('id') id: string, @Body() dto: BlockDto) {
    return this.block(id, dto.reason);
  }

  @Post('users/:id/unblock')
  async unblock(@Param('id') id: string) {
    await this.prisma.user.update({ where: { id }, data: { blockedAt: null, blockReason: null } });
    await this.prisma.conversation.updateMany({ where: { status: 'BLOCKED', participants: { some: { userId: id } } }, data: { status: 'OPEN' } });
    return { ok: true };
  }

  /** Support joins a conversation (visible to both sides) to mediate */
  @Post('conversations/:id/join')
  async join(@CurrentUser() staff: AuthUser, @Param('id') id: string) {
    await this.prisma.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId: id, userId: staff.id } },
      update: {},
      create: { conversationId: id, userId: staff.id, role: 'SUPPORT' },
    });
    await this.messages.postSystem(id, { event: 'support_joined', by: staff.name }, `${staff.name} from Support joined the conversation`);
    return { ok: true };
  }

  private async block(userId: string, reason: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { blockedAt: new Date(), blockReason: reason } });
    // Freeze their conversations and listings, kick live sockets on every node
    const convs = await this.prisma.conversation.findMany({ where: { participants: { some: { userId } }, status: 'OPEN' }, select: { id: true } });
    await this.prisma.conversation.updateMany({ where: { id: { in: convs.map((c) => c.id) } }, data: { status: 'BLOCKED' } });
    await this.prisma.listing.updateMany({ where: { ownerId: userId, status: 'ACTIVE' }, data: { status: 'CLOSED' } });
    for (const c of convs) {
      await this.messages.postSystem(c.id, { event: 'user_blocked' }, 'This user was blocked for violating platform rules. Do not send money or documents to them.');
    }
    this.realtime.disconnectUser(userId);
    return { ok: true, conversationsFrozen: convs.length };
  }
}

@Module({ imports: [ChatModule], controllers: [SupportController] })
export class SupportModule {}
