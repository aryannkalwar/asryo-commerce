# Size inventory and reconciliation tooling

## Working flow

Owner signs in via the existing Commerce/Fashion owner bridge, opens `/admin`, then **Size inventory**.

1. Select an unpublished parent design with no stock; create an explicitly named SKU/size/colour combination. New SKUs have no assumed stock or price and are inactive. No parent record is rewritten.
2. Record a receipt or physical count with a reference. An unknown stock count stays unknown until the owner confirms one. Blank low-stock thresholds remain unset.
3. Set the SKU's price and availability in Products. Stock is read-only there; receipts/corrections go through the audited Inventory form. A parent with size SKUs cannot be published or ordered separately.
4. Each SKU is an independent sellable product row, using the established cart, costing, order tracking and fulfillment flow. Two sizes of one design can be in the same order. The cart displays size/colour in the item name; a grouped size-picker product page is not yet implemented.
5. Checkout reserves the selected size only. Cancelling an unshipped order restores its exact SKU stock once. Receipts, corrections, order reservations and cancellation restocks have movement records.

This adds no stock, customer or financial records during deployment. Checkout remains controlled by existing closed launch settings. The owner must approve real samples, inventory, prices and launch policies before selling.

## Safeguards and limitations

- Existing server admin sessions and same-origin checks protect every Inventory API. Writes share the private-workspace rate limit; private UI scripts bypass the service-worker cache.
- Unique SKU and parent/size/colour constraints prevent duplicate combinations. Retrying an identical create is safe; conflicting duplicates return 409.
- Stock writes use BEGIN IMMEDIATE, expected current stock and an idempotency key. Stale counts and negative balances fail without changing records. Reusing a request ID with another payload fails.
- Old products/orders remain valid. Two additive tables hold SKU relationships and movement records. No destructive migration or pooling of legacy stock occurs.
- Approved Studio artwork is inherited through the immutable parent import; unpublished SKU artwork stays behind admin access.
- Existing parent descriptions/images are copied at SKU creation. Later parent copy changes do not silently rewrite sellable SKU records. Grouped customer size selection, updating SKU labels/thresholds, reservation expiry, returns/RTO, supplier receipts and full warehouse accounting remain separate work.
- Inventory movements record references and session-authorized actions; existing sessions lack individual staff IDs, so per-person attribution requires the pending role/identity work.
- Rollback: retain the additive tables and deploy the prior app only with checkout disabled. Older code does not enforce SKU audit restrictions; do not continue stock editing on that release. Prefer a forward fix. Take a SQLite-aware backup before data recovery.

## Verification

`npm run check` includes draft creation/uniqueness tests, absent stock/price assertions, receipt retry safety, conflicting request IDs, stale-count rejection, negative-stock rejection, owner-defined low-stock alerts, and HTTP purchase/cancel flows for two sizes of a single design. Tests use synthetic isolated databases; they do not create live products or orders. Live authenticated owner browser QA remains required.

## Database comparison before DNS cutover

Generate protected SQLite snapshots on each hosting service using the existing backup CLI. Keep these private; never commit them or upload them to public build artifacts.

```sh
node scripts/compare-databases.mjs /private/staging/asryo.sqlite /private/production/asryo.sqlite
```

The tool opens both databases read-only and emits per-table counts: matching records, conflicts and records present on only one side. It emits no record values or identifiers. Sessions are excluded and must not be migrated. Exit 0 means matching inspected tables, 2 means review needed, 1 means an error. Matching is not authorization for a DNS cutover. Schema differences or tables without primary keys require manual review. Private Fashion OS Blob is outside this tool.

Actual live database comparison, a complete Cloudflare zone export and DNS cutover remain pending secure data/access availability. Do not merge databases or select one as authoritative merely because its environment is called production: asryo.com currently reaches Railway staging.
