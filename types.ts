export type Role = 'USER' | 'SUPPORT' | 'ADMIN';
export type ParticipantRole = 'BUYER' | 'SELLER' | 'SUPPORT';
export type MessageKind = 'TEXT' | 'ATTACHMENT' | 'MEETING_REQUEST' | 'OFFER' | 'SYSTEM';
/** pending/failed are client-only states for optimistic sends */
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'blocked';

export interface User { id: string; name: string; email?: string; avatarUrl?: string | null; role?: Role }

export interface ListingCard {
  id: string;
  title: string;
  type: 'SALE' | 'RENT';
  status: 'DRAFT' | 'ACTIVE' | 'RESERVED' | 'CLOSED';
  price: string | number;
  currency: string;
  rentPeriod?: string | null;
  areaM2: number;
  rooms: number;
  address: string;
  city: string;
  photos: string[];
  lat: number;
  lng: number;
  ownerId?: string;
  distance_m?: number | null;
  value_score?: number | null;
}

export interface Attachment { id: string; kind: 'PHOTO' | 'DOCUMENT'; fileName: string; mimeType: string; sizeBytes: number; createdAt?: string }

export interface MeetingPayload {
  type: 'SHOWING' | 'MEETING' | 'RESERVATION';
  slots: string[];
  note?: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'COUNTERED';
  chosenSlot?: string;
}

export interface OfferPayload {
  price: number;
  currency: string;
  deposit?: number;
  termMonths?: number;
  moveInDate?: string;
  conditions?: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'COUNTERED';
}

export interface ChatMessage {
  id: string;
  clientId?: string;
  conversationId: string;
  senderId: string | null;
  sender?: User | null;
  kind: MessageKind;
  body: string | null;
  payload: (MeetingPayload | OfferPayload | Record<string, unknown>) | null;
  attachments: Attachment[];
  createdAt: string;
  verdict: 'ALLOW' | 'WARN' | 'BLOCK';
  hidden?: boolean;
  mine: boolean;
  status?: MessageStatus;
  safetyTip?: string;
  notice?: string;
}

export interface ConversationSummary {
  id: string;
  status: 'OPEN' | 'ARCHIVED' | 'BLOCKED';
  myRole: ParticipantRole;
  listing: ListingCard;
  counterpart?: User;
  awaitingReplyFrom: ParticipantRole | null;
  awaitingSince: string | null;
  lastMessage?: ChatMessage;
  unread: number;
}

export interface QuickReply { id: string; title: string; body: string; category?: string | null; usageCount: number }

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
export type ReportReason = (typeof REPORT_REASONS)[number]['value'];
