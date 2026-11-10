# ASRYO Commerce

## Customer ordering update — 10 November 2026

The existing storefront now includes dedicated shop/category/product/cart/checkout/account/order routes, product-release approval profiles, separate ready-stock and pre-order controls, gated Razorpay integration, duplicate-order protection, transactional stock reservations, courier tracking, refunds and a durable email outbox. **Ordering remains safely closed until actual products and operational approvals are configured and verified.**

Use [`docs/COMMERCE_OPERATIONS.md`](docs/COMMERCE_OPERATIONS.md) for authoritative deployment, launch gates, payment verification, backup limitations and rollback instructions. Gateway unit tests simulate provider responses; they are not real merchant transactions.


## Speed Meets Street preview (October 2026)

- Responsive black-and-red homepage with original AI-based ASRYO Speed Division and Dream Future concept images.
- Standalone concept detail pages: `/speed-division.html` and `/dream-future.html`. Both include front/back imagery, print-detail zoom and an **unconfirmed** size guide. These are not purchasable products.
- Consent-based, **double-opt-in** email signups: `/api/early-access/status` gates the frontend and `POST /api/early-access` requires an explicit consent checkbox. `GET /api/early-access/verify` confirms email; `POST /api/early-access/unsubscribe` opts out; the authenticated `GET /api/admin/early-access` returns confirmed, currently subscribed contacts. Data is stored in the same persistent SQLite volume.
- The signup records explicitly consented non-binding interest without an email provider. It does not claim a verified subscription or send marketing. Verification mail requires `RESEND_API_KEY`, `MAIL_FROM` and `APP_ORIGIN`. Configure a verified sender and check confirmation/unsubscribe flows on staging before turning on collection. Never send to pending/unconfirmed addresses.
- Pre-launch FAQs and policies are clearly labelled provisional. No fake offers, pricing, shipping promises, inventory, ratings, customer testimonials, or payment-provider claims.
- Page-specific social metadata, canonical URLs and a sitemap pointing to the Railway-verified `asryo.com` staging domain. **When transferring the domain to production, verify DNS/HTTPS and update `APP_ORIGIN` to the origin serving write requests.**
- GitHub Actions `.github/workflows/verify.yml` runs `npm run check` on updates, including security and launch smoke checks.

### Domain and operations

- Railway production service: `asryo-web-production.up.railway.app`; it serves the `main` branch of `aryannkalwar/asryo-commerce`.
- Railway staging service: `asryo-storefront-staging-staging.up.railway.app`; The custom domain has been moved to the production service. Railway confirms ownership and a valid certificate for production. The staging service retains its separate hostname and volume.
- Do not remove/repoint this domain or edit DNS without a coordinated cutover and verification. Preserve unrelated DNS and email/MX records. The staging environment has pre-existing staged settings changes; avoid accepting those blindly.
- Admin login requires `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` in the target environment. Those credentials are not in this repository.
- The store remains explicitly closed until products, contacts, policies, fulfillment and (separately, if used) customer account verification are ready. Leaving `STORE_READY` unset/false and hiding products is intentional.

ASRYO storefront for Node.js 22.16 or later. It uses built-in Node modules and SQLite.

## Current state

- The storefront contains historical/inactive catalog records as well as ASRYO T-shirt design-preview products. The public streetwear homepage shows only the ASRYO concept collection; do not interpret old catalog records as confirmed stock.
- Preview products start inactive and have no price or stock. Ordering remains closed until the operator adds confirmed catalog data and enables `STORE_READY`.
- Checkout supports explicitly approved, serviceable COD and gated Razorpay. The provider remains disabled until approved credentials and verification are present.
- A new COD order is recorded as confirmed with cash due on delivery. Stock is reserved immediately and restored if an unshipped order is cancelled in the admin dashboard.
- Includes customer accounts, order tracking, a shopping assistant, and an authenticated admin dashboard at `/admin`.
- Railway production and staging services are deployed with persistent volumes. Storefront app health checks and CI do not constitute a full commerce-readiness review.
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
- `STORE_READY=true` alone cannot open ordering. Product release approvals, reviewed operational settings, approved payment/serviceability and confirmation email are also required. See the operations guide.
- `OPENAI_API_KEY` is optional. Without it, the assistant stays in preview mode. If enabled, only the visitor's assistant question and active catalog facts are sent to OpenAI.

## COD behavior

The server calculates order totals from its product records; the browser cannot set prices. It validates stock inside a SQLite write transaction, creates an order with cash due on delivery, and reserves stock immediately. Cancelling an unshipped order through admin restores its stock once. Marking an order delivered records cash as collected. Legacy payment-preview database fields are retained for compatibility. The new Razorpay endpoints remain gated and cannot label an order paid without verified capture.

## Hosting and domain

Use the existing Railway staging project and its attached persistent volume. Verify a COD order and order tracking on the staging hostname before considering production. `asryo.com` and `www.asryo.com` must not be pointed to a deployment until the catalog, business details, policies, and staging flow are ready. Preserve GoDaddy email DNS records when adjusting website records.

## Saved Fashion Studio and commerce handoff

Open `/design-studio` from `/business-os` after commerce admin sign-in or owner-session verification. This is a new integrated editor; the existing Vercel Fashion OS remains at `/studio`.

- Edit front/back T-shirt or hoodie sketches, upload your PNG/JPEG/WebP artwork (1 MB per side), adjust position/scale/rotation and graphic text, and use undo/redo.
- Save projects into the existing persistent SQLite volume. An optimistic revision check prevents a stale browser tab overwriting a newer save. All saves return the concept to draft.
- Submit a saved draft for review, approve that saved revision, then create its commerce draft. Repeated requests return the same linked product. New products have no price/stock and remain inactive.
- Commerce images use an immutable approved snapshot. Later project edits cannot silently alter that snapshot or any existing product stock, price or orders.
- Export saved front/back SVG design studies, a JSON tech pack, or a printable sample worksheet. These are reference sketches, not CAD patterns or confirmed manufacturing specifications. Targets remain blank until entered by the owner.
- Project reads, writes, history, exports and unpublished artwork require the commerce session; same-origin checks protect all writes. Private designs are never cached by the service worker.
- Existing Vercel Fashion OS/Blob designs are not automatically imported. This editor does not claim automatic AI image generation, designer team roles, courier integration or full cross-backend synchronization.

Local development: `npm run dev` loads an optional local `.env` and accepts `--port`. Set `DATA_DIR` to a disposable private directory when testing. Never commit credentials or local databases.
