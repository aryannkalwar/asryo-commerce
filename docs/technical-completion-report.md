# ASRYO technical release report — 9 November 2026

This is a verified incremental release, not a claim that all five phases are complete.

## Completed in this release

- Re-audited GitHub main, three Vercel projects and both Railway services.
- Recovered a reusable manifest of all 117 original Vercel source files by content hash. Preserved five private functions, dependency/config files, existing designs and assets. No private data or secrets exported.
- Built a preserved baseline (`dpl_ELMQoxicBXEDB3fowSouTfthU7X5`) and a Beyond Ordinary editorial staging candidate (`dpl_8zfztpS5mbnD8ZyUxgZnrXTnhcwq`). The latter uses frontend text from Git commit `05b15b492b7c0f73bcc1d8f7d4c0eb7681ab71f8`; original private code is unchanged. Both reached READY.
- Fixed a verified data-loss risk: startup no longer overwrites existing product descriptions, catalog details or owner prices from bundled seeds, nor assigns assumed stock on restart. Missing archive entries still seed inactive; existing rows remain authoritative.
- Added online SQLite snapshot/restore tooling with integrity checks, SHA-256 validation, overwrite refusal, private file permissions and session invalidation after restore.
- Documented rollback and cutover gates before production changes.
- Public DNS observations identify legacy www Netlify routing and secureserver.net mail routing. No DNS or mail records changed; observation is not a complete zone export.

## Files changed

| Files | Purpose |
| --- | --- |
| server.mjs, scripts/smoke.mjs | Preserve persistent catalog state across restarts, with regression coverage |
| scripts/database-snapshot.mjs, scripts/test-database-snapshot.mjs | Safe online backup and restore drill |
| package.json | Include recovery test in required checks |
| scripts/prepare-vercel-release.mjs | Reproducible preview payload; preserved legacy Vercel source references plus current frontend |
| deploy/snapshots/* | Non-secret Vercel source manifest and public DNS observations |
| docs/release-runbook.md | Release criteria, database boundaries and rollback procedure |
| docs/technical-completion-report.md | Evidence and remaining work |

## Test evidence

- `npm run check`: passed locally. Includes 14 module tests (snapshot 1, Studio 3, owner SSO 2, finance 3, Cofounder 5), HTTP smoke flow, Fashion proxy tests and PWA isolation tests.
- Recovery drill: online snapshot while source connection remained open in WAL mode; restored committed project revision, removed sessions, rejected existing destination, rejected tampered snapshot, preserved source data. This used synthetic isolated data, not a live-volume recovery.
- Catalog regression: owner price, stock and description survive a real server restart.
- Vercel candidate: homepage, editorial CSS and JS match repository SHA-256 exactly; status reports closed checkout/zero sellable products. Private design/operations/creative requests reject anonymous access. Control endpoint returns initialized=true, loggedIn=false, aiConnected=false.
- Browser: Beyond Ordinary heading/layout verified at 1363px; all ten homepage images loaded; no horizontal overflow. No application console error observed (one browser-extension metadata error excluded). Canonical points to https://asryo.com/.
- No production customer/order/project test records were created. No real payment, email, owner login or manufacturer order was exercised.
- Fresh mobile emulation, Lighthouse/Core Web Vitals measurement and authenticated live browser tests remain unverified; desktop rendering is not proof of those.

## Deployment/data boundaries

| System | Observed baseline |
| --- | --- |
| asryo.com | Railway staging, release 05b15b4, deployment 1c50ab27-d76f-44fc-9fe3-7e06622b220b SUCCESS |
| Railway Commerce | Release 05b15b4, deployment f400a523-b50f-4b6d-ae0b-801bda97277e SUCCESS |
| Vercel storefront | Rollback deployment dpl_6HkroxHLvLWBSW1dXp77qrHcCe1S; editorial candidate above |
| Fashion OS | dpl_AsSV2cKEyozbDN1hYQ72bH8tJYmy READY, platform SSO configured |
| AI Fashion Studio | dpl_2jYH3oKxScTRDxchgi5QfsspTgeU READY, platform SSO configured |

Railway SQLite volumes are separate. The Vercel commerce rewrite currently points to production, while the live apex reaches staging. Preserve both until records are reconciled. Blob Fashion OS is another store. READY is platform status, not authenticated workflow evidence.

## Functional status and next actions

| Area | Verified capability | Incomplete / required next action |
| --- | --- | --- |
| Storefront | Premium editorial homepage, concept designs, image delivery, canonical SEO, closed checkout | Fix Cloudflare www/apex after full zone export; verify responsive/performance metrics |
| Commerce | Isolated COD flow, transactional stock reservation, oversell protection, private tracking, cancellation restock, terminal order transitions | Actual clothing catalog/size variants; account email verification; payment gateway/webhooks; courier, returns/refunds; owner-approved policies and launch tests |
| Native Studio | Saved front/back editor, revision conflicts, approval, private exports, idempotent inactive commerce draft | Live authenticated owner QA; designer roles; legacy project migration; genuine AI generation |
| Manufacturing | Existing Vercel functionality preserved | Source-level review of legacy business logic and authenticated records; supplier/sample/PO/QC workflow completion and reconciliation |
| Finance | Verified cost assumptions and illustrative contribution calculations; read-only business summaries | Actual costs, accountant-reviewed GST invoice/reporting rules, returns/refunds reconciliation; do not call current calculations tax compliance |
| AI automation | Deterministic alerts and proposal approval queue tested; no automatic price/stock/order execution | Provider configuration, generation quality/limits, durable jobs and audited owner execution flows |
| Security | Existing auth gates, same-origin writes, private API cache isolation, revisions/transactions; restore revokes local sessions | Shared role/revocation model, live owner tests, scheduled encrypted offsite backups and recovery exercise, private Blob backup |

External blockers: authenticated Cloudflare access; secure AI/email/payment/courier provider setup; owner-confirmed products, inventory and policies. Enter credentials only in protected provider settings. Checkout remains disabled. No obsolete domain attachments should be removed yet.
