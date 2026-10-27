# Realty — marketplace with a deal-focused chat

Buy, sell and rent homes. The chat is not a messenger: every conversation belongs to a property,
and besides text it carries **viewing requests, structured terms, documents and a secure deposit**.

```
apps/
  api/   NestJS · Prisma · PostgreSQL+PostGIS · Redis (BullMQ, Socket.IO adapter) · Elasticsearch · S3 · Stripe
  web/   Next.js (App Router) · TypeScript · Tailwind · Zustand · socket.io-client · Mapbox
```

## Run locally

```bash
cp .env.example .env
docker compose up -d postgres redis elasticsearch minio minio-init

cd apps/api
npm install
npx prisma migrate dev --name init
npm run db:postgis          # PostGIS trigger + GiST index + trigram index
npm run seed                # demo users & listings
npm run dev                 # http://localhost:4000/api

cd ../web
npm install
npm run dev                 # http://localhost:3000
```

Sign in at `/login` with `buyer@demo.dev`, `seller@demo.dev` or `support@demo.dev` (dev login only).
Open two browsers (buyer + seller) to see ✓ → ✓✓ → blue ✓✓ live.

## Chat module

| Actor | Can do |
|---|---|
| **Buyer / tenant** | start a chat from a listing, ask, request viewing / meeting / reservation with time slots, accept terms, pay secure deposit |
| **Seller / landlord** | reply, send photos & documents, send structured terms (price, deposit, term, move-in), confirm a slot, quick-reply templates |
| **Support** | report queue sorted by severity, conversation context, warn / hide message / block user, join a conversation |
| **System (AI)** | moderates every message, posts safety tips, sends reminders, suggests similar listings when the owner is silent |

### MVP
- **Listing-bound conversations** — unique per `(listing, buyer)`; property card pinned on top (`PropertyCard.tsx`).
- **Statuses** — receipts stored as per-participant cursors (`lastDeliveredAt`, `lastReadAt`) instead of per-message rows.
  ✓ sent (stored), ✓✓ delivered (recipient device acked or came online), blue ✓✓ read (chat visible). Statuses never go backwards.
- **Attachments** — presigned S3 PUT (file never passes through the API) → HEAD verification → `READY`.
  MIME/extension whitelist, 15 MB photos / 25 MB docs. Files panel filters by name, type, size bucket and sorts by date/size/name.
- **Reports** — on a message or a user, 8 selectable reasons, duplicate protection, participant check.

### Advanced
- **Moderation** (`moderation/rules.ts`) — synchronous, runs before storing:
  profanity (EN/RU, masked), phishing (shorteners, IP URLs, punycode, brand look-alikes), Luhn-valid card numbers,
  CVV/SMS-code requests, rental-scam patterns (prepay before viewing, "I'm abroad, keys by mail", Western Union/crypto, move to Telegram).
  `ALLOW` → delivered · `WARN` → delivered with a safety tip for the recipient · `BLOCK` → not delivered, sender told why.
  3+ blocks in 24 h → automated report to support. Optional second pass with an LLM (`ANTHROPIC_API_KEY`) can hide a message retroactively.
- **Reminders** (`chat/reminders.ts`) — buyer writes → BullMQ delayed jobs at 2 h and 24 h. The processor no-ops if the seller replied
  (compares `awaitingSince`), so no cancellation bookkeeping. 24 h step also shows the buyer similar listings nearby (PostGIS).
- **Quick replies** — per-seller templates with `{{buyerName}} {{listingTitle}} {{price}} {{address}}`, sorted by usage, 5 defaults.

### Realtime
Socket.IO namespace `/chat`, JWT in handshake. Every socket joins `user:<id>`; the Redis adapter fans events out across API instances
(put the ALB in sticky-session mode). Blocking a user disconnects all their sockets on all nodes.

## AWS deployment notes
- RDS PostgreSQL (enable `postgis`, `pg_trgm`), ElastiCache Redis (`rediss://` supported), OpenSearch Service or Elastic Cloud.
- S3 bucket with CORS for `PUT` from the web origin; keep it private — downloads go through 5-minute presigned GETs.
- ECS Fargate for `api` and `web`; ALB with sticky sessions for WebSockets.
- Stripe: deposits are authorized with manual capture and captured after move-in confirmation.

## What to add next
Identity provider (Cognito/Auth0/phone OTP), antivirus scan on upload (S3 event → ClamAV Lambda), image thumbnails,
email/push delivery for reminders (SES, FCM/APNs), Stripe Elements on `/checkout`, e2e tests.
