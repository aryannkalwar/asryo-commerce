# ASRYO Commerce

ASRYO storefront for Node.js 22.16 or later. It uses built-in Node modules and SQLite.

## Current state

- The storefront includes 20 ASRYO launch-preview products and their preview images.
- Preview products start inactive and have no price or stock. Ordering remains closed until the operator adds confirmed catalog data and enables `STORE_READY`.
- Checkout is cash on delivery only. The app has no online payment provider, browser payment widget, or payment webhook.
- A COD order is recorded as processing with cash due on delivery. Stock is reserved immediately and restored if an unshipped order is cancelled in the admin dashboard.
- Includes customer accounts, order tracking, a shopping assistant, and an authenticated admin dashboard at `/admin`.
- Railway staging exists with a persistent volume. The current source deployment and the custom domain are not verified as production-ready.
- The Shree Vasstram website is an external catalog reference. Its full catalog, images, descriptions, variants, or stock should not be copied and resold without supplier authorization and a current product export. This repository does not contain its product feed.

## Local preview

1. Copy `.env.example` to `.env` and set `APP_ORIGIN` for the local URL.
2. Set `DATA_DIR` to a persistent private data directory outside the public web folder.
3. Run `npm run check`, then `npm start`.
4. Open `http://localhost:3000/`. Admin is at `/admin`.

No package install is needed. `npm run check` runs syntax checks and local HTTP smoke checks using a temporary SQLite directory.

## Before opening checkout

Set these in the hosting provider's environment settings; do not commit secrets or paste them into chat.

- `APP_ORIGIN`: exact HTTPS staging origin.
- `ADMIN_EMAIL` and a random `ADMIN_PASSWORD` with at least 24 characters.
- `DATA_DIR`: persistent volume path. SQLite holds customer accounts, sessions, orders and inventory.
- `RESEND_API_KEY` and `MAIL_FROM`: required for verified customer accounts.
- `PUBLIC_BUSINESS_NAME`, `PUBLIC_SUPPORT_EMAIL`, `PUBLIC_SUPPORT_PHONE`, `PUBLIC_RETURN_ADDRESS`, shipping fee, dispatch times and return/cancellation terms must be confirmed ASRYO information.
- Set actual product prices, stock, variants and descriptions in admin before activating products.
- `STORE_READY=true` opens COD ordering only when at least one active, priced, stocked product exists. Keep it false until the catalog, policies, contact information and delivery process are verified.
- `OPENAI_API_KEY` is optional. Without it, the assistant stays in preview mode. If enabled, only the visitor's assistant question and active catalog facts are sent to OpenAI.

## COD behavior

The server calculates order totals from its product records; the browser cannot set prices. It validates stock inside a SQLite write transaction, creates an order with cash due on delivery, and reserves stock immediately. Cancelling an unshipped order through admin restores its stock once. Marking an order delivered records cash as collected. Legacy payment-preview database fields are retained only for database compatibility; payment endpoints and client integrations are removed.

## Hosting and domain

Use the existing Railway staging project and its attached persistent volume. Verify a COD order and order tracking on the staging hostname before considering production. `asryo.com` and `www.asryo.com` must not be pointed to a deployment until the catalog, business details, policies, and staging flow are ready. Preserve GoDaddy email DNS records when adjusting website records.
