# SpecFlow License API

Cloudflare Worker for SpecFlow license management with Stripe subscription integration.

## Overview

This worker handles:
- Stripe subscription webhooks (invoice.paid, subscription updates/deletions)
- Checkout session creation for new subscriptions
- Subscription management (cancel, status check)
- NEAR contract integration for license granting

## Setup

### Prerequisites

- Node.js 18+
- Cloudflare account
- Stripe account with a price configured for subscriptions
- NEAR account with deployed license contract

### Installation

```bash
npm install
```

### Create KV Namespaces

Create the required KV namespaces:

```bash
# Create PROCESSED_EVENTS namespace (for webhook idempotency)
wrangler kv:namespace create "PROCESSED_EVENTS"

# Create SUBSCRIPTIONS namespace (for subscription tracking)
wrangler kv:namespace create "SUBSCRIPTIONS"
```

Update `wrangler.toml` with the returned namespace IDs.

### Configure Secrets

Set the required secrets:

```bash
# Stripe secrets
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put STRIPE_PRICE_ID

# NEAR secrets
wrangler secret put NEAR_PRIVATE_KEY
wrangler secret put LICENSE_CONTRACT_ID
wrangler secret put NEAR_NETWORK
wrangler secret put FASTNEAR_API_KEY
```

### Local Development

Copy `.dev.vars.example` to `.dev.vars` and fill in your development values:

```bash
cp .dev.vars.example .dev.vars
```

Start the development server:

```bash
npm run dev
```

### Stripe Webhook Setup

Configure a webhook in the Stripe Dashboard:

1. Go to Developers > Webhooks
2. Add endpoint: `https://your-worker.your-subdomain.workers.dev/webhook/stripe`
3. Select events:
   - `invoice.paid`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the signing secret to `STRIPE_WEBHOOK_SECRET`

### Deploy

```bash
npm run deploy
```

## API Endpoints

### Health Check
```
GET /api/health
```

Returns service status.

### Create Checkout Session
```
POST /api/checkout
Content-Type: application/json

{
  "nearAccountId": "user.near",
  "successUrl": "https://app.specflow.dev/success",
  "cancelUrl": "https://app.specflow.dev/cancel"
}
```

Returns checkout session URL for Stripe redirect.

### Cancel Subscription
```
POST /api/subscription/cancel
Content-Type: application/json

{
  "nearAccountId": "user.near"
}
```

Cancels subscription at period end (license remains valid until expiry).

### Get Subscription Status
```
GET /api/subscription/status?nearAccountId=user.near
```

Returns current subscription status and expiry.

### Stripe Webhook
```
POST /webhook/stripe
```

Receives Stripe webhook events. Do not call directly.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Stripe         │     │  Cloudflare      │     │  NEAR Contract  │
│  Subscriptions  │────>│  Worker          │────>│  (License)      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               v
                        ┌──────────────────┐
                        │  Cloudflare KV   │
                        │  (Subscriptions) │
                        └──────────────────┘
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| STRIPE_SECRET_KEY | Stripe API secret key |
| STRIPE_WEBHOOK_SECRET | Stripe webhook signing secret |
| STRIPE_PRICE_ID | Stripe price ID for subscription product |
| NEAR_PRIVATE_KEY | NEAR account private key for signing transactions |
| LICENSE_CONTRACT_ID | NEAR license contract account ID |
| NEAR_NETWORK | NEAR network (mainnet or testnet) |
| FASTNEAR_API_KEY | FastNEAR API key for RPC access |
| NEAR_RPC_URL | NEAR RPC endpoint (default: https://rpc.mainnet.fastnear.com) |
| LICENSE_DURATION_DAYS | License duration per billing period (default: 30) |

## License

MIT
