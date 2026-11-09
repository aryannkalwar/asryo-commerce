# ASRYO development review — 9 November 2026

## Verified current state

- `asryo.com` serves the editorial concept storefront, not an open shop. Browser checks confirmed homepage and Speed Division navigation and the authenticated workspace launcher at `/business-os`.
- Cloudflare nameservers: `becky.ns.cloudflare.com`, `bowen.ns.cloudflare.com`. Vercel reports the apex domain misconfigured. Railway attaches the domain to the staging service, not the production service. Keep routing unchanged until a coordinated, tested cutover.
- Vercel storefront latest staging deployment: `dpl_H3DwAT95V4gxmuRMLrGNFYi7xitR`, READY. This source tree is a separate static design with `/collection` and `/product/*` pages; it is not the full commerce backend.
- Vercel Fashion OS production deployment: `dpl_AsSV2cKEyozbDN1hYQ72bH8tJYmy`, READY, with Vercel SSO protection configured. Platform readiness does not prove authenticated editor or operations workflows work.
- Storefront Vercel API `/api/status`: storeReady=false, availableProducts=0, assistant=false, accountVerification=false, no support email or phone.
- `/api/control`: initialized=true, loggedIn=false, aiConnected=false, private-blob storage. The private workspace UI also reports owner login required and AI not configured.
- Commerce and Fashion OS have separate stores. Owner verification issues a short-lived commerce session; it does not synchronize products, inventory, orders or manufacturing.
- Railway commerce and staging both last deployed `db3af53` successfully before this review. Both have persistent `/data` volumes, but no admin/email/AI provider variable names in live service configuration. Staging has two pre-existing staged environment changes: ASRYO_ATELIER_HTML and ASRYO_ATELIER_CSS. Do not accept that staged patch as part of this fix.
- No matching error/fatal runtime logs were returned for the Vercel storefront in the checked ten-minute window. This is a bounded check, not proof of zero historical errors.

## Fixes in this review

1. Reject malformed percent-encoding and null bytes inside request error handling. Previously URI decoding ran outside the async handler's try/catch and could terminate the Node process.
2. Reject directory paths, constrain static paths to the public directory boundary, and handle file-stream errors. Previously directory streams could emit an unhandled error and terminate the process.
3. Serve HEAD requests through read-only GET handlers, with empty response bodies. Previously health monitors using HEAD received 404 for working pages.
4. Enforce forward order transitions; delivered and cancelled orders are final. Previously shipped -> processing -> cancelled could restore inventory for goods already dispatched.
5. Repair stale collection/lookbook fragment links on concept and tracking pages.

Validation: `npm run check`, including malformed-request survival, directory/traversal rejection, HEAD behavior, COD totals, stock reservation, oversell rejection, cancellation restock, terminal delivery/payment status, owner verification, private finance records, AI draft safeguards, and PWA cache isolation.

## Completion priorities and acceptance criteria

| Priority | Task | Done when | Dependency |
| --- | --- | --- | --- |
| P0 | Release critical request/order fixes | Reviewed commit passes CI, Railway reaches SUCCESS on that commit, GET/HEAD and normal pages work after release | Existing Git deployment |
| P0 | Establish one authoritative storefront release | Exact production source and Vercel route configuration are versioned; test all API writes through the chosen public origin; then cut over apex and www together with rollback | Cloudflare DNS access, Vercel/Git connection |
| P0 | Confirm sellable first-drop catalog | Real sample approval, SKU/size stock, INR prices, images, measurements, care and business contact/return/dispatch terms entered and reviewed | Owner-confirmed commercial data |
| P0 | Verify launch flow | Same-origin guest COD order -> stock reservation -> private tracking -> admin shipping/delivery -> cash collection; test cancellation and sold-out behavior in isolated staging | Confirmed catalog and operations |
| P1 | Finish Fashion Studio vertical slice | Owner/designer login -> create project -> upload original artwork -> edit front/back placement -> save -> reload -> export tech pack; test mobile and access isolation | Versioned Vercel Studio/OS source, authenticated QA |
| P1 | Connect genuine AI generation | Server-only provider credentials, usage limits, error handling and durable generated-asset/project records; successful reviewed generation | Provider account and key in protected settings |
| P1 | Link approved designs to commerce | Idempotent approved-design -> draft-SKU import with stable IDs and audit records; manual review before price/stock/publication | Shared data contract and transaction-capable commerce source of truth |
| P1 | Verify identity and data durability | Shared roles, session expiry/logout/revocation checks, backup/restore drill, concurrency testing; do not use a JSON blob as transactional inventory | Owner sign-in and storage architecture |
| P1 | Enable email verification | Verified sender, confirmation/expiry/unsubscribe tests; pending interest never treated as subscribed | Resend/sender configuration |
| P2 | Add online payment and courier | Sandbox order/webhook reconciliation with signatures/idempotency, shipping/returns/RTO tests | Authorized gateway/courier accounts |
| P2 | Complete AI operations | Reliable job queue, retries, explicit review/execution states, audit trail, failure recovery | Working catalog, identity and providers |

Keep STORE_READY=false until the P0 commerce acceptance criteria are met. Do not invent prices, stock, contact details or provider credentials to clear launch gates.
