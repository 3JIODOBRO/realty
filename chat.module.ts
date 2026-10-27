import { Body, Controller, Delete, Get, Module, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ParticipantRole } from '@prisma/client';
import { AuthGuard, AuthUser, CurrentUser } from '../auth/auth.module';
import { ListingsModule } from '../listings/listings.module';
import { ConversationsService } from './conversations.service';
import { MessagesService } from './messages.service';
import { AttachmentsService } from './attachments.service';
import { REPORT_REASONS, ReportsService, TemplatesService } from './reports-templates.service';
import { RemindersProcessor, RemindersService, REMINDERS_QUEUE } from './reminders';
import { ChatGateway } from './chat.gateway';
import {
  AttachmentFilterQuery, CreateReportDto, HistoryQuery, PresignAttachmentDto, ReceiptDto,
  RespondDto, SendMessageDto, StartConversationDto, TemplateDto,
} from './dto';
import { randomUUID } from 'crypto';

@Controller('conversations')
@UseGuards(AuthGuard)
export class ConversationsController {
  constructor(private conversations: ConversationsService, private messages: MessagesService, private attachments: AttachmentsService) {}

  /** "Contact the owner" on a listing card. Optional first message is sent through the normal pipeline. */
  @Post()
  async start(@CurrentUser() u: AuthUser, @Body() dto: StartConversationDto) {
    const conv = await this.conversations.startOrGet(u.id, dto.listingId);
    let first;
    if (dto.message) first = await this.messages.send(u, { conversationId: conv.id, clientId: randomUUID(), kind: 'TEXT', body: dto.message });
    return { conversation: conv, first };
  }

  @Get()
  inbox(@CurrentUser() u: AuthUser, @Query('role') role?: ParticipantRole, @Query('unanswered') unanswered?: string) {
    return this.conversations.inbox(u, { role, unanswered: unanswered === 'true' });
  }

  @Get(':id')
  details(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.conversations.details(id, u);
  }

  @Get(':id/messages')
  history(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query() q: HistoryQuery) {
    return this.messages.history(u, id, q);
  }

  /** REST fallback for sending (sockets are primary) */
  @Post(':id/messages')
  send(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.messages.send(u, { ...dto, conversationId: id });
  }

  @Post(':id/read')
  read(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ReceiptDto) {
    return this.messages.markRead(u, id, new Date(dto.upTo));
  }

  @Get(':id/attachments')
  files(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query() q: AttachmentFilterQuery) {
    return this.attachments.list(u, id, q);
  }
}

@Controller()
@UseGuards(AuthGuard)
export class ChatActionsController {
  constructor(
    private messages: MessagesService,
    private attachments: AttachmentsService,
    private reports: ReportsService,
    private templates: TemplatesService,
  ) {}

  @Post('messages/:id/respond')
  respond(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: RespondDto) {
    return this.messages.respond(u, id, dto);
  }

  @Post('attachments/presign')
  presign(@CurrentUser() u: AuthUser, @Body() dto: PresignAttachmentDto) {
    return this.attachments.presign(u, dto);
  }

  @Post('attachments/:id/confirm')
  confirm(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.attachments.confirm(u, id);
  }

  @Get('attachments/:id/url')
  download(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.attachments.downloadUrl(u, id);
  }

  @Get('reports/reasons')
  reasons() {
    return REPORT_REASONS;
  }

  @Post('reports')
  report(@CurrentUser() u: AuthUser, @Body() dto: CreateReportDto) {
    return this.reports.create(u, dto);
  }

  @Get('templates')
  listTemplates(@CurrentUser() u: AuthUser) {
    return this.templates.list(u.id);
  }

  @Post('templates')
  createTemplate(@CurrentUser() u: AuthUser, @Body() dto: TemplateDto) {
    return this.templates.create(u.id, dto);
  }

  @Patch('templates/:id')
  updateTemplate(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: TemplateDto) {
    return this.templates.update(u.id, id, dto);
  }

  @Delete('templates/:id')
  deleteTemplate(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.templates.remove(u.id, id);
  }

  @Get('templates/:id/render')
  render(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('conversationId') conversationId: string) {
    return this.templates.render(u, id, conversationId);
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: REMINDERS_QUEUE }), ListingsModule],
  controllers: [ConversationsController, ChatActionsController],
  providers: [
    ConversationsService, MessagesService, AttachmentsService, ReportsService, TemplatesService,
    RemindersService, RemindersProcessor, ChatGateway,
  ],
  exports: [MessagesService, ConversationsService],
})
export class ChatModule {}
