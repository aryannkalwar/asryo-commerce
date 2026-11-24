# Public ASRYO design feedback

The live custom domain uses Cloudflare Worker `asryo-public-storefront`, not the Railway or Vercel deployments. This folder captures its original public code and the additive feedback release. The main repo server is a separate deployment target.

The wrapper serves About and Vote directly, bundles the three concept images to remove the failing external dependency, links the homepage to Vote, and lists the three indexable pages in the sitemap. Existing ordering, accounts and email collection remain closed by the original public-preview handler.

Edit `about.html`, `vote.html`, `vote-client.js` and `handler.mjs`. Run `python deploy/feedback/build-feedback.py` from the repository root, then `node deploy/feedback/test-feedback.mjs`. `worker.mjs` is the generated production entry point and imports the retained `storefront-original.mjs`. The config identifies the existing Worker and dedicated feedback database. Do not replace the original snapshot with the unrelated Node server or deploy other staged infrastructure changes.

D1 uses `schema.sql`. The API exposes GET of only the browser's own preference, POST to save/update it, and DELETE to withdraw it. Mutations require exact same-origin requests. JSON is limited to 1 KiB. Only three designs and a small referral-source allowlist are stored, alongside a random cookie identifier and timestamp. Stored choices expire after 90 days, with removal on subsequent submissions. A maximum of 10,000 stored preferences limits growth. The cookie is Secure, HttpOnly, SameSite=Lax and lasts 90 days. No names, emails, free text, orders, or payment data are collected by this feature.

This is informal preference research, not authenticated voting: clearing cookies allows another entry. No public counts are exposed. Read aggregate results as owner through D1, filtering for unexpired rows; do not publish raw browser IDs. Hosting traffic logs are separate. The UI describes this limitation and the retention policy.

Browser verification covers image loading, no horizontal overflow at the inspected desktop viewport, selection, save, reload persistence and change of choice. Local tests additionally cover withdrawal, invalid input, cross-origin rejection, oversized requests and unchanged row count for repeated choices. Live synthetic QA rows are removed before promotion. No traffic, votes or testimonials are seeded.

Rollback: the original public preview code is retained in `storefront-original.mjs`. Deploy it as the entry point while retaining the feedback binding/database and all records. Do not drop or restore over the database. This rollback removes feedback access until the wrapper is restored.
