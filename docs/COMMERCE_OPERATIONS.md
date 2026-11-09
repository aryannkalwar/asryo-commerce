# Customer ordering operations

## Authoritative deployment

`aryannkalwar/asryo-commerce`, `main` → Railway **ASRYO Commerce / asryo-web**, production environment `2b0e1881-afcf-42c6-a4f8-7c12dab14930`.

The database is SQLite on the existing `/data` persistent volume. Keep one application replica. Do not run a second independent writable database for the public storefront. Vercel Fashion OS remains a separate private application, accessible through the existing verified owner bridge. Its designs cannot publish directly to commerce.

Canonical customer origin: `https://asryo.com`. The apex DNS is Railway's required DNS-only CNAME `lz6xmlop.up.railway.app`. `www` redirects to the apex. Preserve email, MX, SPF, DKIM, DMARC and unrelated records.

## Product release

1. Save and review a design in `/design-studio`. An approved design can create only an inactive, unpriced commerce draft.
2. Confirm samples, fit, fabric, GSM, artwork, manufacturing and QC. Use `/costing` and the sample planner for reviewed estimates; they do not change live prices.
3. Create actual size/colour SKUs and record physical receipts in `/admin`. Stock changes require a reason and idempotent request ID.
4. In `/commerce-admin`, save a release profile with measured sizing, approved front/back asset paths, tax treatment, delivery window and an approval reference. Profiles have optimistic revisions.
5. Ready stock requires confirmed physical inventory. Pre-orders require confirmed capacity, a future dispatch date, explicit cancellation/refund conditions and disclosure that **full payment is collected immediately at checkout**. Capacity is shared across sizes and is separate from physical stock.
6. Set only approved prices and activation in Products. A parent with size SKUs cannot be purchased instead of a size. Never invent stock, reviews or specifications to clear launch gates.

## Operational gates

The public storefront stays restricted unless every required condition is met. Set values through the host's private environment settings; never commit credentials or paste secrets into chat.

| Setting | Required evidence |
|---|---|
| `APP_ORIGIN` | Exact customer HTTPS origin; staging must use its own hostname |
| `PUBLIC_BUSINESS_NAME`, `PUBLIC_SUPPORT_EMAIL`, `PUBLIC_SUPPORT_PHONE`, `PUBLIC_RETURN_ADDRESS` | Confirmed ASRYO business and support details |
| `POLICIES_APPROVED=true`, `FULFILMENT_APPROVED=true` | Reviewed sales terms, supported delivery and return operations |
| `RESEND_API_KEY`, `MAIL_FROM`, `NOTIFICATIONS_APPROVED=true` | Verified approved sender; sandbox and real delivery verification |
| `SHIPPING_FEE_PAISE`, `SHIPPING_GST_BPS` | Owner-confirmed tax-inclusive shipping fee and applicable tax treatment |
| `COD_APPROVED=true`, `COD_PINCODES` | Verified COD readiness and comma-separated six-digit eligible PIN codes |
| `SERVICEABLE_PINCODES` | Confirmed prepaid delivery PIN codes; no automatic nationwide assumption |
| `PAYMENTS_MODE` | `disabled` by default; `test` only outside production; `live` only after approval |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Approved merchant's private credentials with the correct test/live prefix |
| `LIVE_PAYMENTS_APPROVED=true`, `PAYMENT_PRODUCTION_VERIFIED=true` | Merchant approval and documented successful production verification |
| `REFUNDS_APPROVED=true` | Owner-authorized refund operations with the merchant |
| `HIDE_PUBLIC_PRODUCTS=false`, `STORE_READY=true` | Final release after all gates and product-level checks pass |
| `DAILY_BACKUPS=true` | Enables daily private snapshots and isolated restore drills |

Missing settings must never be substituted with synthetic values outside disposable tests. `/api/admin/commerce` shows blockers to an authenticated owner. `/api/storefront` exposes only public readiness and approved catalogue facts. Setting global readiness does not make an unapproved product purchasable.

## Payment and order safety

* Quote and order totals use database prices, inclusive tax calculations and server-configured delivery charges. The browser cannot choose prices.
* Every checkout requires an `Idempotency-Key`. Keep the same key and identical payload after a network error. A reused key with different details is rejected.
* Inventory reservations, pre-order limits, line items, order snapshots and audit events are written in a single SQLite `BEGIN IMMEDIATE` transaction.
* Razorpay orders are created server-side. The browser receives only the public key and gateway order ID. Raw card data is never handled by ASRYO.
* `POST /api/payments/verify` requires the private order token, HMAC callback signature and a server-side fetch confirming the exact captured payment, amount, currency and provider order.
* Configure `POST https://asryo.com/api/payments/webhook` with payment capture/failure and refund events in the approved merchant dashboard. The raw body is authenticated using the configured webhook secret. Event IDs are durable and deduplicated. Failed attempts cannot downgrade a captured payment.
* An uncertain Orders API response never triggers blind remote order creation on retry. The customer gets a saved reference while support reconciles the provider receipt. Authenticated `POST /api/admin/commerce/orders/:id/reconcile` attaches only a provider order whose receipt, amount and currency match, then checks its captured payments.
* A late captured payment on a cancelled order becomes `refund_required`; it cannot revive fulfilment or silently consume inventory again.
* Refund requests use a durable provider idempotency key and an immutable full-refund amount. Only verified provider processing marks a refund completed. Partial refunds and exchanges require separate reviewed implementation.

Lifecycle: pending payment → confirmed → processing → packed → shipped → out for delivery → delivered. Shipment requires actual carrier and tracking data. Customers may cancel before shipping or request a return after delivery. Returned clothing is not restocked automatically; record a physical QC receipt first. Legacy order records keep their original compatibility handler.

Confirmation and status messages use a durable outbox with provider idempotency keys. Failed requests stay pending and are retried. A private tracking link and pre-order disclosures are included. Only a successful email API response marks the notification sent; inbox delivery still requires sender/domain verification and operational monitoring.

## Backups and rollback

When enabled, `backups.mjs` creates dated private snapshots in `/data/backups`, verifies SHA-256 and SQLite integrity, and restores to a new temporary directory for a recovery drill. Sessions are revoked in restored copies. The live database is never overwritten. No automatic deletion or retention purge is performed.

**These snapshots share the application volume.** They protect against application-level corruption and bad changes, not loss of the entire volume/account. Configure and verify provider-level/offsite backups before declaring disaster recovery complete. Monitor volume usage; define approved retention externally.

Rollback code to a verified previous Railway deployment. All commerce schema additions are additive; code rollback must not drop tables or restore over newer customer/order data. Inspect current deployment and take a snapshot before any later data migration. Never blindly accept pre-existing staged Railway changes.

## Verification

`npm run check` runs syntax checks, the existing smoke/regression suite, commerce failure/concurrency tests and snapshot/restore tests against disposable data. Gateway responses and email deliveries in unit tests are simulated; they are **not merchant sandbox or production transactions**. Real gateway test payments, webhook delivery, verified customer email and live order processing remain launch gates until configured and observed.

Public browser QA must verify the homepage, canonical redirects, shop/category pages, product/variant UI, checkout restrictions, accounts and private-admin rejection. Do not create fake production stock or use real customer payments as test data.

## Unconfigured external services

Search Console verification requires the actual property verification token/access. Analytics requires an authorized measurement ID and consent design. Courier automation requires an approved carrier account. Do not invent any of these. The site publishes canonical metadata, robots rules and a sitemap without promising rankings.
