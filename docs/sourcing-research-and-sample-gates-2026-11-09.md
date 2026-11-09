# ASRYO — Sample-first sourcing research and execution gates
**Research date:** 2026-11-09  
**Scope:** Premium oversized T-shirts, 10–20-piece trials; no orders authorized.

## Technical baseline
- Source: aryannkalwar/asryo-commerce, main be51a1ce, GitHub Actions verify successful.
- Railway Commerce and Staging: currently online on their separate SQLite volumes; staging has unrelated pending CSS/HTML variable changes. The domain asryo.com remains attached to Railway staging.
- Vercel storefront: a READY production build exists, but Vercel reports asryo.com misconfigured. Cloudflare nameservers are external to this repository; do **not** change DNS or redirect the Vercel API to a different database without reconciling records.
- Fashion OS and AI Fashion Studio: platform builds READY but owner-sign-in workflow and server-side AI credentials have not been verified through this investigation.
- Commerce checkout remains intentionally closed; do not set STORE_READY, publish SKUs or invent stock, prices, contact details, shipping policies or vendor connections.

## Supplier price discovery, not procurement approval
These are public advertised prices, *not verified quotations or supplier recommendations*. Obtain a GST invoice, actual fabric composition and written landed quote before purchasing.

| Public source | Advertised trial option | Important qualification |
| --- | --- | --- |
| Plain Bulk Tshirt, https://plainbulktshirt.com/collections/oversized-tshirts | 240 GSM oversize from ₹205/pc, MOQ 10 | Listing describes terry / loopknit. Do not substitute for requested compact-cotton **single jersey** without sample confirmation. |
| NexelPrint, https://nexelprint.com/bulk-order/oversized-240-gsm | 240 GSM 100% cotton at ₹250/pc before 5% GST, MOQ 10; custom DTF print advertised +₹30 | Listing also calls fabric loopknit/French terry; verify shirt structure, GSM and print dimensions. |
| DS Prints, https://dsprintsindia.com/custom-t-shirt-printing-in-delhi/ | Oversized 240 GSM printed garment advertised at ₹329/pc | Confirm quantity, print placement, brand label, tax and packaging in a written quote. |

**Required ASRYO test brief:** 100% combed compact cotton, pre-shrunk, bio-washed, oversized drop-shoulder, 240 GSM *single jersey*, a durable ribbed round neck and measured dimensions. Fabric construction and composition are acceptance criteria, not guaranteed by the advertised listings above.

## First trial proposal (conditional)
- Test **10 pieces**, split between two colours and mixed sizes only after supplier MOQ flexibility is confirmed.
- Avoid printing the full batch until one plain blank and one decorated sample pass checks. For wash testing, reserve at least one garment.
- The new Sample-First Planner at /sample-planner.html calculates gross cash outlay and illustrative contribution from user-entered quotes only. Nothing is saved, ordered, or published.
- Example (illustration, **not** a committed purchase): 10 blanks × ₹250, 10 prints × ₹60, 10 neck labels × ₹15, 10 packaging units × ₹12, and ₹200 inbound freight = ₹3,570 gross trial cash before any additional supplier invoice tax. A ₹999 inclusive retail scenario still needs outbound shipping, payment/marketplace fees, marketing and return reserve assumptions.

## Sampling and production release gate
1. Confirm actual supplier identity, location, GST invoice, delivery, refund/defect terms and MOQ.
2. Compare 220/240/260 GSM **physical** options where available; verify construction, measured fabric weight, shrinkage, seam finish, stitching, neck-rib recovery and fit.
3. Confirm front/back print method, artwork DPI and physical size, colour fastness, print durability after multiple washes, care label and packaging.
4. Record size-wise measurements, photograph defects, and request a correction sample when needed.
5. Finance must confirm full landed cost, pricing, GST/HSN treatment, platform fees, shipping, RTO risks and contribution before publishing.
6. Link an approved design to an inactive commerce draft, then create real size SKUs and ledger-backed stock receipts after physical goods arrive. Only then test end-to-end staging COD and fulfillment.
7. No supplier purchase or publication may be triggered by AI recommendations without explicit owner review.

## Tax research
- As of this review, the GST Council / PIB material states **5% GST on qualifying readymade garments up to ₹2,500 per piece** and **18% above ₹2,500** for the relevant apparel headings. Verify HSN, transaction value, invoicing, any changed notifications and input tax credits with the accountant before operational use.
- Sources: https://www.pib.gov.in/PressReleasePage.aspx?PRID=2163555 and https://www.pib.gov.in/PressReleasePage.aspx?PRID=2163905
- The sample planner uses a *user-selected illustrative* GST rate. It does not calculate filings, actual ITC, or refunds.

## Remaining integration work — do not mislabel as complete
- **Deployment:** Cloudflare zone export and access, source comparison, data volume reconciliation, rollback and authenticated checkout testing before domain cutover.
- **Business OS:** add durable sample purchase orders/receipts and audited supplier QA only after role and data model design. Planner is deliberately stateless.
- **Studio:** verify existing owner/private workflow and artwork exports; AI generation requires configured provider, durable asset records, rate/budget limits and explicit approval. Existing Fashion OS Blob records are not automatically in Commerce.
- **Commercial launch:** complete real samples, measurements, approved photo assets, seller policies and operational contact details before enabling a sellable product.
