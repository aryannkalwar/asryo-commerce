# ASRYO AI Cofounder — feature parity plan

Original ASRYO implementation inspired by publicly advertised e-commerce capabilities. Do not copy Alippo's source code, assets, brand identity, private APIs, UI text or proprietary workflows.

Sources checked 2026-11-08:
- https://alippo.com/
- https://alippo.com/pricing

## Existing ASRYO commerce capability
- Storefront, product records, catalog updates, admin authentication
- Customer accounts, COD order processing and order tracking
- Verified opt-in launch interest, with confirmation and unsubscribe
- Shopping assistant if OpenAI API key is configured
- Production readiness gate prevents unconfirmed products and checkout

## Implemented in this branch
- Admin-protected AI Cofounder workbench at /cofounder.html
- Order and collected-revenue totals derived from stored orders; product and subscriber counts
- Readiness alerts for closed store, low stock and no verified subscribers
- Product-specific SEO, listing, marketing campaign, social, email and automation drafts
- OpenAI writing when configured, with deterministic fallback on errors
- Persisted draft/approved/archived states and copy actions
- No externally dispatched messages, no automatic promotions, no publication
- Test coverage for revenue metrics, stock non-mutation and invalid inputs
- On-demand review engine: low-stock warnings, processing orders older than 48 hours, store-closed checks, verified-subscriber checks
- Idempotent per-day recommendation queue with reviewed/dismissed states; no external side effects
- Same-origin Fashion OS portal links and an explicit owner-session connection check through /api/ops


## Not yet implemented — requires real provider integrations and QA
| Module | Implementation requirement |
| --- | --- |
| AI website/page builder | Versioned page components, live preview, permissions, human publish approval, rollback |
| Product image generation | Authorized image API, file storage, usage permissions, human asset approval |
| Full checkout | Razorpay/Cashfree integration, idempotent payment webhooks, order reconciliation, security review |
| Courier and returns | Shiprocket/Delhivery integration, shipping labels, tracking, RTO and return workflows |
| Abandoned-cart recovery | Consent-aware cart event model, scheduled recovery queue, delivery provider, opt-out |
| Email / WhatsApp campaigns | Consent/opt-in status, templates, provider credentials, rate limiting, legal review, unsubscribe |
| Discount and flash-sale automation | Inventory checks, approved pricing, budget caps, expiry, audit logs, manual rollback |
| Advanced SEO management | Product/page metadata editor, XML sitemaps, schema validation, indexing feedback |
| Performance attribution | Privacy-conscious analytics events, conversion funnel, campaign attribution, return rates |
| AI operator scheduling | Job queue, retries, audit trails, job permissions and explicit approval thresholds |
| Manufacturer integration | Supplier quote requests, production stage updates, tech packs, quality control |
| Cost, GST and profits | Purchase and shipping cost inputs, correct tax classification, marketplace fee and return models |
| Team roles and Android | Role-based access, audit logs, responsive/PWA or native app testing |
| Marketplace sync | Amazon and Flipkart authorized seller APIs and reconciliation |

## Implementation priorities

**P0** Keep store closed until current catalog, prices, policies and fulfillment are confirmed. Preserve existing COD and customer-data rules.

**P1** Verify the new admin workbench in staging, link it to Fashion OS through authenticated APIs, and add secure draft-driven product/page editing.

**P2** Integrate transactional infrastructure in sandbox mode: payment, courier, consented messages and reliable event storage. Automated sending is disabled by default.

**P3** Deliver monitored AI workflows: trigger -> reasoned proposal -> human approval -> execution -> audit log -> rollback. No self-modifying code in production.

## Security and operational rules
- All `/api/admin/cofounder/*` routes require the existing admin cookie/session and same-origin write checks.
- Never use customer order addresses or phone numbers to generate AI marketing copy.
- Marketing communications require verified consent and unsubscribe enforcement.
- The word `approved` means a human reviewed a proposal, **not** that the system dispatched it.
- No invented discounts, prices, stock, materials, testimonials or tax claims.
- This branch does not modify `STORE_READY`, activate stock or publish the public store.

## Current deployment and authentication constraints (2026-11-08)
- Superseded by the 9 November review: the Cofounder, Finance Studio and owner bridge are merged on main and deployed on Railway at db3af53. See development-review-2026-11-09.md for verified current state.
- The original ASRYO Fashion OS deployed on Vercel has its own owner session and operations data; the storefront already proxies private workspace paths to Fashion OS.
- The Cofounder UI can check that the browser's Fashion OS session reaches /api/ops. It **does not** yet synchronize operational data, credentials, or inventory between independent backends.
- Current Railway environment variable names do **not** show ADMIN_EMAIL, ADMIN_PASSWORD, OPENAI_API_KEY or payment/courier keys. Cofounder API will remain gated by the existing Railway admin session. Configure required credentials via Railway's protected settings, not GitHub or chat.
- The Railway staging service has asryo.com attached and pre-existing staged config changes: **do not deploy, redeploy, or accept those changes casually**.
- User-facing actions in this branch are drafts and review notes; no checkout activation, external provider API action, or operational scheduling.

## Unified website entry point
- `/business-os` is the unified private-workspace launcher, served directly by the ASRYO Node storefront, also linked from `/admin`.
- It provides authenticated Commerce metrics through `/api/admin/cofounder/overview`, plus Fashion OS session health through the existing `/api/ops` gateway. It shows no sensitive data when either system is not authenticated.
- Fashion OS remains hosted separately on Vercel and linked through the same-origin gateway routes `/workspace`, `/operations`, `/studio`, and `/manufacturing`.
- **A unified UI is not yet an integrated database:** bidirectional order-to-production synchronization, financial reconciliation, and shared identity/roles remain separate engineering work.
- The public luxury-streetwear homepage remains unchanged; only administrative navigation is expanded.
- Do not call these Alippo's proprietary features or source; the implementation is original ASRYO code.

## Finance Studio and one-owner login (November 2026)

### New modules
- `/costing`: standalone INR-unit economics calculator works without logging in and makes no API write until Save is pressed. Pre-populated sample costs are illustrative, not confirmed ASRYO procurement data.
- `/api/admin/finance/products`: read-only product/cost/economics endpoint for authenticated commerce administrators.
- `PUT /api/admin/finance/products/:id`: saves private unit-cost assumptions against existing products; does **not** change product selling prices, inventory, publication state, orders, cash collection, tax reporting or supplier commitments.
- Calculation decomposes successful retained-sale contribution, GST-inclusive output tax estimate, production and selling expense, and a **handling-only** reserve for returns. It explicitly excludes refund losses, RTO, damaged stock, GST input credit and statutory tax filings.
- `COFOUNDER_AUTO_REVIEW=false` disables the new best-effort background monitor; otherwise the running storefront scans for recommendations on startup and every six hours. Its writes are only idempotent review notes. This is NOT a guaranteed scheduler when hosting processes are asleep or unavailable.

### Owner identity bridge
- Fashion OS still owns its user identities and data. Its existing `GET /api/control` returns explicit booleans `initialized`, `loggedIn` and `aiConnected`.
- Once an owner signs into Fashion OS through the ASRYO same-origin workspace, `POST /api/admin/fashion-login` sends the owner's signed `fashion_os_session` cookie to the hard-coded Fashion OS origin for server-side validation.
- Only `initialized:true` and `loggedIn:true`, with a matching owner role if supplied, permits a separate, **30-minute** local commerce session. This route is same-origin, rate-limited and does not reveal tokens to the browser.
- Do not fake Fashion OS sign-in or expose the owner cookie via JavaScript. The user must personally sign into Fashion OS to activate this feature.
- The legacy Railway `ADMIN_EMAIL` + `ADMIN_PASSWORD` remains supported as an independent fallback, but is not required if a valid Fashion OS owner session works.
- Revoking a Fashion OS session may leave an already-issued commerce session valid until its short expiry. Full centralized identity and shared revocation remain future work.

### Still requires authorized external accounts
- Fashion AI is currently not connected according to `/api/control`. It cannot generate model-backed artwork without its required AI provider credentials and service configuration.
- Payment gateways, courier APIs, WhatsApp and SMTP/Resend campaigns are not connected or activated in this branch.
- GST rate in Finance Studio is a user-supplied modelling assumption, never an automatically determined HSN/GST classification.
