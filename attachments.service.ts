import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AttachmentKind, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.module';
import { ConversationsService } from './conversations.service';
import { AttachmentFilterQuery, PresignAttachmentDto } from './dto';

const MB = 1024 * 1024;

/** Whitelist: MIME → allowed extensions. Anything else is rejected before upload. */
const RULES: Record<AttachmentKind, { maxBytes: number; types: Record<string, string[]> }> = {
  PHOTO: {
    maxBytes: 15 * MB,
    types: {
      'image/jpeg': ['jpg', 'jpeg'],
      'image/png': ['png'],
      'image/webp': ['webp'],
      'image/heic': ['heic'],
    },
  },
  DOCUMENT: {
    maxBytes: 25 * MB,
    types: {
      'application/pdf': ['pdf'],
      'application/msword': ['doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
      'application/vnd.ms-excel': ['xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
      'text/plain': ['txt'],
    },
  },
};

export function classify(mimeType: string): AttachmentKind | null {
  if (mimeType in RULES.PHOTO.types) return 'PHOTO';
  if (mimeType in RULES.DOCUMENT.types) return 'DOCUMENT';
  return null;
}

@Injectable()
export class AttachmentsService {
  private s3 = new S3Client({
    region: process.env.S3_REGION ?? 'eu-central-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials: process.env.S3_ACCESS_KEY_ID
      ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '' }
      : undefined,
  });
  private bucket = process.env.S3_BUCKET ?? 'realty-attachments';

  constructor(private prisma: PrismaService, private conversations: ConversationsService) {}

  /** Step 1: validate metadata, reserve a key, return a short-lived PUT URL. The file never passes through the API. */
  async presign(user: AuthUser, dto: PresignAttachmentDto) {
    const { me } = await this.conversations.access(dto.conversationId, user);
    if (!me) throw new ForbiddenException();

    const kind = classify(dto.mimeType);
    if (!kind) throw new BadRequestException(`File type ${dto.mimeType} is not allowed`);
    const rule = RULES[kind];
    if (dto.sizeBytes > rule.maxBytes) throw new BadRequestException(`Max size for ${kind.toLowerCase()} is ${rule.maxBytes / MB} MB`);

    const safeName = dto.fileName.normalize('NFKC').replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file';
    const ext = safeName.split('.').pop()?.toLowerCase() ?? '';
    if (!rule.types[dto.mimeType].includes(ext)) throw new BadRequestException('File extension does not match its type');

    const key = `conversations/${dto.conversationId}/${randomUUID()}.${ext}`;
    const att = await this.prisma.attachment.create({
      data: {
        conversationId: dto.conversationId,
        uploaderId: user.id,
        kind,
        fileName: safeName,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        s3Key: key,
      },
    });
    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: dto.mimeType, ContentLength: dto.sizeBytes }),
      { expiresIn: 600 },
    );
    return { attachmentId: att.id, uploadUrl, kind };
  }

  /** Step 2: verify the object really landed with the declared size/type. Hook antivirus (e.g. S3 + ClamAV Lambda) here. */
  async confirm(user: AuthUser, attachmentId: string) {
    const att = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!att || att.uploaderId !== user.id) throw new NotFoundException();
    const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: att.s3Key })).catch(() => null);
    const valid = head && head.ContentLength === att.sizeBytes && head.ContentType === att.mimeType;
    return this.prisma.attachment.update({
      where: { id: att.id },
      data: { status: valid ? 'READY' : 'REJECTED' },
      select: { id: true, kind: true, fileName: true, mimeType: true, sizeBytes: true, status: true },
    });
  }

  /** Conversation "Files" panel: filter by name / size / type, sort. */
  async list(user: AuthUser, conversationId: string, f: AttachmentFilterQuery) {
    await this.conversations.access(conversationId, user);
    const where: Prisma.AttachmentWhereInput = {
      conversationId,
      status: 'READY',
      message: { hiddenAt: null, verdict: { not: 'BLOCK' } },
      kind: f.kind,
      fileName: f.q ? { contains: f.q, mode: 'insensitive' } : undefined,
      sizeBytes: f.minSize || f.maxSize ? { gte: f.minSize, lte: f.maxSize } : undefined,
    };
    if (f.type) {
      where.mimeType = f.type.includes('/') ? f.type : undefined;
      if (!f.type.includes('/')) where.fileName = { ...(where.fileName as object), endsWith: '.' + f.type.toLowerCase(), mode: 'insensitive' };
    }
    const sortField = f.sort === 'size' ? 'sizeBytes' : f.sort === 'name' ? 'fileName' : 'createdAt';
    const items = await this.prisma.attachment.findMany({
      where,
      orderBy: { [sortField]: f.order ?? (sortField === 'fileName' ? 'asc' : 'desc') },
      select: { id: true, kind: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true, uploaderId: true, messageId: true },
      take: 200,
    });
    const totals = await this.prisma.attachment.groupBy({
      by: ['kind'], where: { conversationId, status: 'READY' }, _count: true, _sum: { sizeBytes: true },
    });
    return { items, totals };
  }

  async downloadUrl(user: AuthUser, attachmentId: string) {
    const att = await this.prisma.attachment.findUnique({ where: { id: attachmentId }, include: { message: true } });
    if (!att) throw new NotFoundException();
    await this.conversations.access(att.conversationId, user);
    if (att.message?.hiddenAt && user.role === 'USER') throw new ForbiddenException('Removed by moderation');
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: att.s3Key,
        ResponseContentDisposition: `${att.kind === 'PHOTO' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(att.fileName)}`,
      }),
      { expiresIn: 300 },
    );
    return { url };
  }
}
