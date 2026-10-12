# ASRYO Commerce

Private Node.js storefront prepared from the existing ASRYO preview. It uses only built-in Node modules and SQLite (`node:sqlite`) and requires Node 22.16 or later.

## Current state

- The storefront contains 20 products and original ASRYO preview images copied from the existing ASRYO project.
- The products are intentionally inactive with no price or stock. Checkout stays closed unless the operator explicitly configures the store and payment credentials.
- Includes customer email verification and sign-in, cart, order tracking, AI shopping assistant (preview without an API key), Razorpay checkout/webhook handlers, and an authenticated product/order admin at `/admin`.
- The live domain and DNS have not been changed. This source has not been deployed.
- The Shree Vasstram website has a public shop, but no authorized catalog feed or resale agreement was available during implementation. Do not copy/relist its full products, product photography, copy, stock, or prices without the supplier's authorization and a current supplier export. The products currently in this package are the 20 ASRYO launch previews, not a complete Shree Vasstram feed.

## Local preview

1. Copy `.env.example` to `.env` and set `APP_ORIGIN` for the local URL.
2. Set `DATA_DIR` to a persistent, private data directory outside the public web folder.
3. Run `npm run check`, then `npm start`.
4. Open `http://localhost:3000/`. Admin is at `/admin`.

No package install is needed. `npm run check` performs syntax checks and local HTTP smoke checks. The smoke test uses a temporary SQLite directory and removes it afterward.

## Required before staging checkout

Set these in the hosting provider's secret/environment settings; never commit or paste credentials into chat.

- `APP_ORIGIN`: the exact HTTPS staging origin.
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`: Razorpay **test mode** credentials. Configure the webhook URL as `https://<staging-origin>/api/razorpay/webhook` and subscribe to `order.paid` and `payment.failed`.
- `ADMIN_EMAIL` and a random `ADMIN_PASSWORD` with at least 24 characters.
- `DATA_DIR`: persistent volume path. SQLite holds customer accounts, sessions, orders, inventory and webhook event IDs.
- `RESEND_API_KEY` and `MAIL_FROM`: required to verify customer accounts.
- `OPENAI_API_KEY` is optional; without it, the assistant remains in preview mode. The app sends only the user's assistant question and active catalog facts to OpenAI when configured.
- `PUBLIC_BUSINESS_NAME`, `PUBLIC_SUPPORT_EMAIL`, `PUBLIC_SUPPORT_PHONE`, `PUBLIC_RETURN_ADDRESS`, shipping fee and dispatch/returns terms must contain confirmed ASRYO information. The currently published support phone (`+91 63947 55253`) is carried over from the existing ASRYO contact page.
- Set actual product price, stock, variants and descriptions in the admin area before activating each product.
- Only set `STORE_READY=true` after products, policies, staging order, test payment, webhook delivery and notification flow are verified.

## Payment behavior

The server creates Razorpay orders and calculates totals from its own product records; the browser cannot set prices. Razorpay's callback signature is checked, but the order is marked paid only after a signed webhook with a matching paid amount and INR currency. Webhook event IDs are stored to make duplicate delivery idempotent. Unsigned events are rejected. A paid order with insufficient inventory is marked `manual_review` for operator resolution. Test-mode payment and webhook delivery still need to be run against ASRYO's Razorpay account before launch.

## Hosting and domain handoff

The existing Railway service was found without a source repository or deployment. Connect a private GitHub repository to the existing Railway service (or provide a current repository that the user can access), configure the variables above, and deploy to a Railway staging hostname first. Use the attached persistent volume for `DATA_DIR`. Do not point `asryo.com` or `www.asryo.com` at the new service until the complete staging order and test payment succeed and existing DNS/email records are backed up. Existing live DNS currently points to Netlify, whose production deploys were paused for quota reasons.
