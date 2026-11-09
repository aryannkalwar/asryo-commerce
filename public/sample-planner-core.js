// Pure, dependency-free planning model. All currency amounts are integer paise.
// This is a cash-flow scenario, not a tax invoice or an assurance of profit.
const unitFields = ['blankUnitPaise','printUnitPaise','labelUnitPaise','packagingUnitPaise'];
const batchFields = ['freightBatchPaise','extraSupplierTaxBatchPaise'];
const saleFields = ['retailPricePaise','outboundShippingPaise','paymentFeesPaise','marketingPaise','returnReservePaise'];
const validPaise = amount => Number.isSafeInteger(amount) && amount >= 0 && amount <= 100000000;
export function calculateSampleEconomics(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Enter a sample scenario.');
  const quantity = input.quantity;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) throw new RangeError('Pilot quantity must be between 1 and 20 pieces.');
  for (const field of [...unitFields, ...batchFields, ...saleFields]) {
    if (!validPaise(input[field])) throw new RangeError('Enter a non-negative rupee amount for ' + field + '.');
  }
  if (!validPaise(input.retailPricePaise) || input.retailPricePaise === 0) throw new RangeError('A proposed selling price is required.');
  const outputGstBps = input.outputGstBps;
  if (![0,500,1800].includes(outputGstBps)) throw new RangeError('Select a reviewed illustrative sale GST rate.');
  const baseUnitPaise = unitFields.reduce((sum, field) => sum + input[field], 0);
  const grossPilotCashPaise = quantity * baseUnitPaise + input.freightBatchPaise + input.extraSupplierTaxBatchPaise;
  if (!Number.isSafeInteger(grossPilotCashPaise)) throw new RangeError('Pilot total is too large.');
  // Round up allocated batch costs to avoid presenting an optimistic unit margin.
  const landedUnitPaise = Math.ceil(grossPilotCashPaise / quantity);
  const outputGstPaise = Math.round(input.retailPricePaise * outputGstBps / (10000 + outputGstBps));
  const variableSalePaise = input.outboundShippingPaise + input.paymentFeesPaise + input.marketingPaise + input.returnReservePaise;
  const contributionPaise = input.retailPricePaise - outputGstPaise - landedUnitPaise - variableSalePaise;
  return {
    quantity, grossPilotCashPaise, landedUnitPaise, outputGstPaise,
    variableSalePaise, contributionPaise,
    contributionMarginPct: Number((100 * contributionPaise / input.retailPricePaise).toFixed(2)),
    lossMaking: contributionPaise < 0,
    limitations: 'Illustrative contribution on a successful sale with an estimated return reserve; excludes input tax credits, refunds, marketplace-specific fees and actual RTO outcomes. Confirm GST classification with an accountant.'
  };
}
