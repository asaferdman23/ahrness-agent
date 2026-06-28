# Development Guide

## Prerequisites

- Node.js 22+
- Docker (for sandbox execution)
- A Twilio account with a WhatsApp sandbox number
- A Google Cloud project with OAuth 2.0 credentials
- An Anthropic API key

## First-time setup

### 1. Clone and install

```bash
git clone https://github.com/asaferdman23/ahrness-agent
cd ahrness-agent
npm install
```

### 2. Create your `.env`

```bash
cp .env.example .env
```

Fill in the required values (see section below).

### 3. Set up a local HTTPS tunnel

Twilio needs a public URL to send webhook events to your laptop. Use ngrok:

```bash
npx ngrok http 3456
```

Copy the `https://` URL it gives you (e.g. `https://abc123.ngrok-free.app`) — you'll need it in two places:
- `CALLBACK_BASE_URL` in your `.env`
- The webhook URL in the Twilio console (see below)

> **Note:** The free ngrok URL changes every session. To get a fixed URL, use a paid ngrok plan ($8/mo) or run `ngrok config add-authtoken <token>` with a free static domain from ngrok.com.

### 4. Configure Twilio webhook

In the [Twilio console](https://console.twilio.com) → Messaging → Try it out → Send a WhatsApp message (sandbox):

Set the webhook URL to:
```
https://YOUR-NGROK-URL/webhooks/twilio/whatsapp
```

### 5. Add Google OAuth redirect URI

In [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → your OAuth client:

Add to **Authorized redirect URIs**:
```
http://localhost:3456/api/auth/callback/google
```

### 6. Run

```bash
npm run dev
```

The agent starts at `http://localhost:3456` with hot reload. Open it in your browser — you'll see the login page.

---

## Environment variables

Copy from `.env.example`. Required values for local dev:

| Variable | Where to get it |
|----------|----------------|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `BETTER_AUTH_SECRET` | Run `openssl rand -hex 32` |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → OAuth 2.0 Clients |
| `GOOGLE_CLIENT_SECRET` | Same as above |
| `TWILIO_ACCOUNT_SID` | Twilio Console → Account Info |
| `TWILIO_AUTH_TOKEN` | Twilio Console → Account Info |
| `TWILIO_WHATSAPP_NUMBER` | `whatsapp:+1415XXXXXXX` (your sandbox number) |
| `CALLBACK_BASE_URL` | Your ngrok URL, e.g. `https://abc123.ngrok-free.app` |
| `WHATSAPP_PROVIDER` | Set to `twilio` |

Optional (leave blank locally to disable):

| Variable | Purpose |
|----------|---------|
| `AGENT_ALLOWED_SENDERS` | Comma-separated phone numbers allowed to message the bot. Leave unset to allow anyone (fine for local dev). |
| `AGENT_SANDBOX_ENABLED` | Set to `true` to run agent code in Docker. Requires Docker running locally. |
| `HIGGSFIELD_MCP_URL` | Only needed if testing Higgsfield video generation. |

---

## Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start with hot reload (tsx watch) |
| `npm start` | Start without hot reload |
| `npm test` | Run all tests |
| `npm run type-check` | TypeScript type check (no emit) |

---

## Sharing Twilio credentials

For a small team it's simplest to share one Twilio sandbox number. Each developer:
1. Uses the same `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`
2. Temporarily points the Twilio webhook at their own ngrok URL while developing
3. Points it back to `https://agent.bizz-claw.com/webhooks/twilio/whatsapp` when done

Alternatively, each developer creates their own Twilio sandbox (free).

---

## Deployment

Merging to `main` automatically deploys to `https://agent.bizz-claw.com` via GitHub Actions.

See [docs/architecture.md](docs/architecture.md) for a full description of the production environment.
