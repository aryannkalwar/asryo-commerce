# ASRYO migration — Railway to Render (preview-only)

This branch prepares a **separate** Render staging/preview deployment of the existing Node.js storefront. It does not modify Railway, DNS, the live `main` branch, or the currently running SQLite database.

## Why Render?

- The application runs a long-lived Node.js HTTP server (`npm start`) using Node's `node:sqlite`.
- Accounts, sessions, inventory, early-access consent, and orders are stored in `DATA_DIR/asryo.sqlite`.
- Render supports a Node web service with a persistent disk; Vercel's standard serverless hosting does not support durable local SQLite writes.
- The Render disk requires a **paid** instance. Confirm the price in the dashboard before authorizing. The Blueprint uses `starter`, 1GB, `singapore`.

## Deployment (requires operator authorization)

1. Open https://dashboard.render.com/select-repo?type=blueprint or use the Render Dashboard: **New → Blueprint**.
2. Connect GitHub repo `aryannkalwar/asryo-commerce` and select branch `migration/render-hosting`. Render reads `render.yaml` from that branch.
3. Review the paid web service and disk costs; do not provision until accepted.
4. Supply `APP_ORIGIN` as the exact HTTPS Render preview URL from the service (for instance the actual `https://<service>.onrender.com` assigned by Render — do not guess it).
5. Configure `ADMIN_EMAIL` and a unique strong `ADMIN_PASSWORD` securely in Render; never commit or paste credentials into a chat.
6. Leave `STORE_READY=false` and `HIDE_PUBLIC_PRODUCTS=true`. Verify `/healthz`, homepage, /admin login, and logs on the Render preview URL.
7. Review exact catalog/product photos. Re-enable public products only after images and specifications are confirmed. Keep checkout closed until stock, policies, support contacts and order handling are verified.
8. For existing users, consent records, orders, inventory, and admin state, **migrate the Railway persistent SQLite volume** using a consistent SQLite backup rather than silently starting with a fresh database. The new disk initially has **no Railway records**. Do not mix the production and preview volumes or copy a live database without a consistent backup.
9. Test protected routes, early access verification, and a controlled COD order and cancellation in an isolated staging copy before considering production cutover.
10. Only after the new deployment is fully verified, plan a separate DNS cutover for `asryo.com`. Preserve all MX/SPF/DKIM/DMARC/TXT records and existing mail services. Do not remove the Railway app or volume until migration is complete and backups are confirmed.

## What this branch intentionally does *not* do

- Does not connect or spend money on a new Render account.
- Does not migrate Railway's SQLite data or copy customer information.
- Does not update `asryo.com`, `www.asryo.com`, or DNS.
- Does not open checkout or publish unverified T-shirt pricing/stock.
- Does not change the current Railway-backed production path.

## Operational notes

- The app health check is `GET /healthz`.
- Build command: `npm run check`. Start command: `npm start`.
- Node.js `>=22.16.0` required by `package.json`.
- `DATA_DIR=/var/data` persists SQLite files on the paid disk.
- A disk-backed Render service cannot scale to multiple instances and has a short interruption during redeploys; evaluate a managed database before substantial traffic.
- Disable automatic deploys initially to keep staging changes deliberate.
