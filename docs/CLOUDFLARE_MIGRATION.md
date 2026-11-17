# ASRYO free-hosting migration (staging only)

The Cloudflare D1 staging database `asryo-migration-staging` exists and starts empty. Do not route public orders to it. The live domain remains unchanged. Do not purchase a plan or enable a paid add-on.

## Recovery and acceptance gates

1. Recover the existing Railway SQLite snapshot privately via the original volume or verified offsite snapshot using the documented recovery procedure. Current account restrictions prevent live recovery using the connected tools. Do not delete the volume or backup bucket.
2. Run `node scripts/cloudflare-migration-audit.mjs /private/path/asryo.sqlite` using Node 22.16+ on a private recovered copy. Verify integrity, foreign keys and table counts. Do not commit or share snapshots, SQL dumps, keys, customer records or the audit report.
3. Port the asynchronous database adapter and HTTP interface. Existing synchronous node:sqlite statements, filesystem access, BEGIN IMMEDIATE write transactions, password hashing, backup routines, sessions and private admin handlers require explicit adaptations; D1 is not a drop-in replacement. Preserve atomic stock and order writes, idempotency, pricing and all approval gates. Revoke all sessions and outstanding verification tokens at cutover.
4. Test the port with synthetic data in an isolated environment first. Validate the real import against source schema and counts in a private staging database, retain a verified recovery copy, and test authorization, concurrency, cancellation and the full COD lifecycle.
5. Only after data reconciliation and operational approvals, deploy the tested application and verify public HTTPS and DNS. Preserve Vercel Fashion OS, email records and the Railway backup. Never create parallel writable production databases.
6. Confirm Workers Free account status before production traffic. Free usage limits apply; no billing change is authorized. See https://developers.cloudflare.com/workers/platform/pricing/ and https://developers.cloudflare.com/d1/platform/pricing/.

The migration is incomplete: no production data has been imported or Worker storefront deployed. The audit is a read-only prerequisite, not a database export or a compatibility guarantee.
