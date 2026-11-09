import {calculateSampleEconomics} from './sample-planner-core.mjs';
const form = document.getElementById('sample-form');
const message = document.getElementById('message');
const results = document.getElementById('results');
const rupees = paise => '₹' + (paise / 100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const paise = id => {
  const raw = document.getElementById(id).value.trim();
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(raw)) throw new Error('Enter a valid non-negative rupee amount for ' + id + '.');
  const [whole,fraction=''] = raw.split('.');
  return Number(whole)*100 + Number((fraction+'00').slice(0,2));
};
const fields = {
  blankUnitPaise:'blank',printUnitPaise:'printing',labelUnitPaise:'labels',
  packagingUnitPaise:'packaging',freightBatchPaise:'freight',
  extraSupplierTaxBatchPaise:'extra-tax',retailPricePaise:'retail',
  outboundShippingPaise:'shipping',paymentFeesPaise:'fees',
  marketingPaise:'marketing',returnReservePaise:'returns'
};
const set = (id,value) => {document.getElementById(id).textContent=value;};
form.addEventListener('submit',event=>{
  event.preventDefault();
  results.hidden=true;
  message.textContent='';
  try{
    const scenario={quantity:Number(document.getElementById('quantity').value),
      outputGstBps:Number(document.getElementById('gst').value)};
    for(const [field,id] of Object.entries(fields)) scenario[field]=paise(id);
    const estimate=calculateSampleEconomics(scenario);
    set('budget',rupees(estimate.grossPilotCashPaise));
    set('landed',rupees(estimate.landedUnitPaise));
    set('sale-gst',rupees(estimate.outputGstPaise));
    set('sale-costs',rupees(estimate.variableSalePaise));
    set('contribution',rupees(estimate.contributionPaise));
    set('margin',estimate.contributionMarginPct.toFixed(2)+'%');
    message.textContent=estimate.lossMaking
      ? 'This scenario shows negative contribution. Review costs and pricing before sampling.'
      : 'Scenario calculated. Supplier prices and quality remain unverified until you inspect real samples.';
    if(scenario.retailPricePaise>250000 && scenario.outputGstBps===500)
      message.textContent += ' Verify the apparel GST bracket: 5% is generally for garments valued up to ₹2,500 per piece.';
    if(scenario.retailPricePaise<=250000 && scenario.outputGstBps===1800)
      message.textContent += ' Confirm whether the 5% garment bracket applies.';
    results.hidden=false;
  }catch(error){message.textContent=error.message;}
});
