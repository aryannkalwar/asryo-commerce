# Integrated ASRYO Fashion Studio

## Delivered workflow

`/design-studio` -> saved design -> review -> approval -> unpublished commerce product.

- The owner uses the existing Fashion OS-to-Commerce session bridge or existing commerce admin login. No new public signup, credentials or access roles are introduced.
- Front/back T-shirt and hoodie technical sketches accept authorised PNG, JPEG or WebP artwork; position, scale, rotation, ink/text, garment colour and optional sample targets are editable.
- Saved data lives in the existing SQLite volume, with revision conflicts returning HTTP 409 rather than overwriting another tab. Saving any design returns it to draft.
- Review/approval transitions are server-validated, and an exact approved revision is required for the first commerce import. A per-project unique link prevents duplicate products on retries.
- The imported product is inactive, unpriced and unstocked. It is excluded from public catalogue responses. Unpublished images, project records, audit history and exports require authentication.
- Approved product artwork is an immutable snapshot. Editing the source project does not change the imported product, its price, stock or existing orders.
- Saved front/back SVGs, JSON tech packs and printable sample worksheets are available. Blank specifications remain pending. These are technical design studies, not graded CAD patterns or confirmed production-ready files.
- History records revision events, design metadata and artwork fingerprints; it does not offer historical raster restoration. It avoids duplicating large artwork payloads on every revision.
- The workspace's Studio entry points to the new editor. The old Vercel studio stays reachable through the editor header.

## Release and routing

The Node application remains the authoritative backend for this workflow. The existing Vercel project's new additive route is versioned in `deploy/vercel-studio-route.json`; it redirects only the new Studio entry on the stable Vercel alias to asryo.com, where existing same-origin write checks work. It does not replace Vercel Fashion OS functions or alter DNS. The Vercel alias currently rejects writes because its Origin differs from APP_ORIGIN; this redirect avoids broadening origin trust. Existing private API routes are preserved.

Back up the persistent SQLite volume using an online SQLite-aware backup operation or a coordinated offline copy, including WAL handling. The new tables are additive and require no destructive migration. Existing products/orders are not modified by initialization.

## Validation

`npm run check` covers project validation, unsafe image rejection, text escaping, revision conflict preservation, review/approval transitions, idempotent imports, immutable artwork, unpublished catalogue/image isolation, same-origin checks and process-restart persistence. Existing COD, stock, account, owner verification, finance, Cofounder and PWA tests remain in the same suite.

Browser QA covers editor rendering and the anonymous session lock. Full authenticated HTTP workflow is tested using an isolated temporary database. Live authenticated owner editing must be verified by the owner; no production credential is created or inferred for testing.

## Remaining external dependencies

- Cloudflare account access for the coordinated apex/www domain cutover.
- Confirmed first-drop products, sizes, prices, stock and business/fulfillment details before STORE_READY can be enabled.
- AI provider and verified-email sender credentials in protected hosting settings.
- Existing Vercel Fashion OS/Blob project import, per-designer roles, shared identity revocation, manufacturing/order reconciliation, and a successful backup/restore drill are separate work. This release does not claim those are complete.
