import { AttachmentKind, ReportReason } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString,
  Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

export class StartConversationDto {
  @IsString() listingId: string;
  @IsOptional() @IsString() @MaxLength(4000) message?: string;
}

export class MeetingRequestPayload {
  @IsIn(['SHOWING', 'MEETING', 'RESERVATION']) type: 'SHOWING' | 'MEETING' | 'RESERVATION';
  @IsArray() @ArrayMaxSize(5) @IsDateString({}, { each: true }) slots: string[];
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class OfferPayload {
  @IsNumber() price: number;
  @IsString() currency: string;
  @IsOptional() @IsNumber() deposit?: number;
  @IsOptional() @IsInt() @Min(1) @Max(120) termMonths?: number;
  @IsOptional() @IsDateString() moveInDate?: string;
  @IsOptional() @IsString() @MaxLength(1000) conditions?: string;
  @IsOptional() @IsDateString() validUntil?: string;
}

export class SendMessageDto {
  @IsString() conversationId: string;
  /** Client-generated UUID — makes retries idempotent and lets the UI reconcile optimistic messages */
  @IsString() clientId: string;
  @IsIn(['TEXT', 'ATTACHMENT', 'MEETING_REQUEST', 'OFFER']) kind: 'TEXT' | 'ATTACHMENT' | 'MEETING_REQUEST' | 'OFFER';
  @IsOptional() @IsString() @MaxLength(4000) body?: string;
  @IsOptional() @ValidateNested() @Type(() => MeetingRequestPayload) meeting?: MeetingRequestPayload;
  @IsOptional() @ValidateNested() @Type(() => OfferPayload) offer?: OfferPayload;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) attachmentIds?: string[];
  @IsOptional() @IsString() templateId?: string;
}

export class RespondDto {
  @IsIn(['ACCEPT', 'DECLINE', 'COUNTER']) action: 'ACCEPT' | 'DECLINE' | 'COUNTER';
  /** For meeting requests: the chosen slot */
  @IsOptional() @IsDateString() slot?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ReceiptDto {
  @IsString() conversationId: string;
  /** ISO timestamp of the newest message seen/delivered */
  @IsDateString() upTo: string;
}

export class HistoryQuery {
  @IsOptional() @IsDateString() before?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class PresignAttachmentDto {
  @IsString() conversationId: string;
  @IsString() @MaxLength(200) fileName: string;
  @IsString() mimeType: string;
  @IsInt() @Min(1) sizeBytes: number;
}

export class AttachmentFilterQuery {
  @IsOptional() @IsEnum(AttachmentKind) kind?: AttachmentKind;
  /** substring of the file name */
  @IsOptional() @IsString() q?: string;
  /** e.g. "pdf", "image/png" */
  @IsOptional() @IsString() type?: string;
  @IsOptional() @Type(() => Number) @IsInt() minSize?: number;
  @IsOptional() @Type(() => Number) @IsInt() maxSize?: number;
  @IsOptional() @IsIn(['date', 'size', 'name']) sort?: 'date' | 'size' | 'name';
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
}

export class CreateReportDto {
  @IsOptional() @IsString() messageId?: string;
  @IsOptional() @IsString() reportedUserId?: string;
  @IsOptional() @IsString() conversationId?: string;
  @IsEnum(ReportReason) reason: ReportReason;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

export class TemplateDto {
  @IsString() @MaxLength(60) title: string;
  @IsString() @MaxLength(2000) body: string;
  @IsOptional() @IsString() category?: string;
}
