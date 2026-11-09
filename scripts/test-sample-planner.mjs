import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSampleEconomics } from '../public/sample-planner-core.mjs';
const scenario = {
  quantity:10, blankUnitPaise:25000, printUnitPaise:6000,
  labelUnitPaise:1500, packagingUnitPaise:1200,
  freightBatchPaise:20000, extraSupplierTaxBatchPaise:0,
  retailPricePaise:99900, outboundShippingPaise:6500,
  paymentFeesPaise:1500, marketingPaise:8000,
  returnReservePaise:3500, outputGstBps:500
};
test('pilot cash outlay, conservative per-unit cost and contribution', () => {
  const result = calculateSampleEconomics(scenario);
  assert.equal(result.grossPilotCashPaise,357000);
  assert.equal(result.landedUnitPaise,35700);
  assert.equal(result.outputGstPaise,4757);
  assert.equal(result.contributionPaise,39943);
  assert.equal(result.lossMaking,false);
});
test('quantity and input validation prevent silent assumptions', () => {
  for (const quantity of [0,21,1.5]) assert.throws(() => calculateSampleEconomics({...scenario,quantity}));
  assert.throws(() => calculateSampleEconomics({...scenario,blankUnitPaise:-1}));
  assert.throws(() => calculateSampleEconomics({...scenario,freightBatchPaise:undefined}));
  assert.throws(() => calculateSampleEconomics({...scenario,retailPricePaise:0}));
  assert.throws(() => calculateSampleEconomics({...scenario,outputGstBps:1200}));
});
test('higher GST bracket and loss scenario remain explicit', () => {
  const result = calculateSampleEconomics({...scenario,outputGstBps:1800,retailPricePaise:35000});
  assert.equal(result.outputGstPaise,5339);
  assert.equal(result.lossMaking,true);
  assert(result.contributionPaise < 0);
});
test('freight allocation rounds up for conservative cost estimate', () => {
  const result = calculateSampleEconomics({...scenario,quantity:3,freightBatchPaise:1});
  assert.equal(result.landedUnitPaise,33701);
});
