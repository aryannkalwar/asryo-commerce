# Public prelaunch publication

The public read-only storefront is deployed to the Cloudflare Worker `asryo-public-storefront`; it serves `asryo.com` and redirects `www.asryo.com` to the apex. The existing `asryo-hosting-preview` continues to serve `preview.asryo.com`. No production database is bound to the public storefront. Orders, payment, accounts, writes and early-access submissions are disabled. This is not a completed commerce backend migration.

The production Worker bundles the revised homepage and shop assets at migration commit 134830fc81c26675bd3369e6b45f855a3c11d1cf and references public images and supplementary files at main commit ff14cfee24bc93c5f2c5eaa2623757769ed98d5f. The public homepage rendered successfully over HTTPS after cutover. Vercel projects and Railway volume/bucket were not modified.

## Rollback
If required, detach ONLY the two production custom domains from the production Worker, then restore the prior DNS-only CNAMEs for asryo.com and www.asryo.com, both targeting be828afcfb698681.vercel-dns-017.com (TTL automatic). Verify the records and HTTPS. Do not alter preview.asryo.com, unrelated DNS/email records, credentials or backups.

## Remaining gates
Recover and reconcile legacy data privately, complete and test production backend, approve products, delivery and policies, then enable ordering. Free-tier usage limits apply; no paid subscription has been purchased.
