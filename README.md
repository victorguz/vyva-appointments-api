# Vyva WhatsApp API

NestJS + DynamoDB service for WhatsApp Cloud API conversations.

## Endpoints

- `GET /api/whatsapp/webhook` — Meta verification
- `POST /api/whatsapp/webhook` — inbound messages and status updates
- `GET /api/whatsapp/conversations` — list conversations (auth)
- `GET /api/whatsapp/conversations/:id/messages?limit=20` — messages (auth)
- `POST /api/whatsapp/messages` — send text (auth, `clientMessageId` for idempotency)
- `GET /api/whatsapp/integration/status` — credentials configured flag

## Setup

1. Configure per-business credentials via **integrations-api** (`type: whatsapp`: `phoneNumberId`, `accessToken`, `appSecret`).
2. Point Meta webhook to `https://<api-gateway>/qas/api/whatsapp/webhook` and set **Verify Token** = **Phone Number ID** in Meta Developer Console.
3. Deploy: `npm run deploy:qas:force`

Graph API version: `v25.0` (constant in `whatsapp-meta.service.ts`).

## Local dev

```bash
PORT=3010 npm run start
```

Edge proxy (optional): `LOCAL_WHATSAPP_URL=http://localhost:3010` with `EDGE_LOCAL=true`.

Frontend `environment.ts`:

```ts
whatsapp: 'http://localhost:3000/api/whatsapp', // via edge
// whatsapp: 'http://localhost:3010/api/whatsapp', // direct
```

## Tables

- `{stage}-vyva-whatsapp-messages`
- `{stage}-vyva-whatsapp-conversations`
- Reads `{stage}-vyva-integrations` for credentials
