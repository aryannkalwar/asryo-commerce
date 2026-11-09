# ASRYO release and rollback — 9 November 2026

## Authoritative state and safeguards

- Git main `05b15b492b7c0f73bcc1d8f7d4c0eb7681ab71f8` supplies the verified Beyond Ordinary editorial frontend and native commerce/Studio backend.
- Public apex currently reaches Railway **ASRYO Staging**. Treat its database as live business data regardless of the environment's name. Vercel's existing commerce API rewrite reaches the distinct ASRYO Commerce production database. Do not switch between these databases without a reconciliation/backup decision.
- Vercel private functions, internal source, existing pages/assets, cron and configuration are preserved by original content hashes. `deploy/snapshots/vercel-storefront-source.json` is a source manifest, NOT a backup of private Blob data or secrets.
- The editorial staging deployment replaces only repository-owned frontend text files. Original API functions and dependency/configuration files remain identical.
- STORE_READY remains false, with public products hidden. No price, stock, product activation, supplier order, payment, tax action or AI execution is authorized by this release.
- Existing Railway staged Atelier patch is unrelated and must not be accepted.

## Before any production change

1. Record deployment IDs, source commit, project route version and environment **names**, never values.
2. Run `npm run check`, inspect the reviewed diff and confirm CI success.
3. Verify staging homepage/file hashes, images, private API gates and closed checkout. Confirm private function hashes and preview/production variable target scopes match before Vercel promotion.
4. Keep rollback deployment `dpl_6HkroxHLvLWBSW1dXp77qrHcCe1S` available. Retain project routing version `94b55754-4f8a-4dce-8d84-f8bf4f6a128b`.
5. Database changes in this release are non-destructive: startup stops rewriting existing product rows. Backup CLI is operator-invoked and never runs automatically against live data.

## Rollback

- Vercel: promote the recorded prior deployment to the same storefront project and restore the prior project route version if routing changed. Verify `/`, `/api/control`, `/api/status`, private API 401 and the owner bridge. Do not delete the replacement or old deployment.
- Railway: redeploy the recorded successful prior commit/snapshot. Current schema remains compatible. Avoid reverting the product-preservation fix casually: the old startup code can overwrite owner edits. Prefer forward fixes.
- DNS: restore the exact exported Cloudflare records, proxy flags and TTLs for apex/www only. Preserve MX/TXT/DKIM/DMARC/CAA and other subdomains. Never use public DNS answers as a complete zone backup.
- Database recovery: pause writes; back up the damaged volume before intervention; restore into a new private data directory, validate counts/invariants, then deliberately change the application mount/directory. Never overwrite a running SQLite file. Retain the original volume for recovery.

## SQLite backup and restore

```sh
node scripts/database-snapshot.mjs backup /data/asryo.sqlite /private-backups/asryo-UNIQUE_TIMESTAMP
node scripts/database-snapshot.mjs restore /private-backups/asryo-UNIQUE_TIMESTAMP /private-restore/asryo-UNIQUE_TIMESTAMP
```

Parent directories must exist; leaf destination must not exist. Online SQLite backup includes committed WAL data. Snapshot has integrity/foreign-key checks and SHA-256 manifest. Directory mode 0700, files 0600. Restoring verifies checksum and clears customer/admin sessions, requiring fresh sign-in. Backup directories contain private data: never put them in public/, Git, build artifacts or this public repository. Encryption, remote retention, scheduling, access policy and live-volume restore drill remain deployment work. Blob private records need a separate provider backup/export, not this SQLite tool.

## DNS cutover gate

Both domains must be tested against the candidate before changing Cloudflare. `www.asryo.com` currently resolves to the legacy Netlify target `jade-yeot-7deb48.netlify.app.`; apex is Cloudflare proxied. Vercel reports both misconfigured.

Current domain-specific Vercel recommendation: CNAME `be828afcfb698681.vercel-dns-017.com.` (apex flattening where supported), or rank-1 A values `216.198.79.1` and `64.29.17.1` for apex. Re-query Vercel immediately before applying; do not rely on this historical snapshot alone.

Required before cutover: authenticated Cloudflare zone export including mail records; explicit authoritative database reconciliation; authenticated owner/customer checks; www->apex redirect and certificate verification. No domain attachment is obsolete until these pass. Cloudflare connector discovery returned no available connector. Public DNS is not enough to identify every email service or DKIM selector.
