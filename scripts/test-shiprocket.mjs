import test from 'node:test';
import assert from 'node:assert/strict';
import {createShiprocketClient,shiprocketConfigured} from '../shiprocket.mjs';
const env={SHIPROCKET_API_EMAIL:'api@example.test',SHIPROCKET_API_PASSWORD:'test-only',SHIPROCKET_PICKUP_PINCODE:'273155'};
test('configuration requires credentials and valid pickup PIN',()=>{
  assert.equal(shiprocketConfigured(env),true);
  assert.equal(shiprocketConfigured({...env,SHIPROCKET_PICKUP_PINCODE:'invalid'}),false);
  assert.equal(shiprocketConfigured({...env,SHIPROCKET_API_PASSWORD:''}),false);
});
test('authenticates and filters non-COD or blocked couriers',async()=>{
  const calls=[];
  const fetchImpl=async (url,opts)=>{
    calls.push({url,opts});
    return {ok:true,json:async()=>url.endsWith('/auth/login')?{token:'fake-token'}:
      {data:{available_courier_companies:[
        {courier_company_id:10,courier_name:'COD Courier',cod:1,blocked:0,freight_charge:60},
        {courier_company_id:11,courier_name:'Prepaid only',cod:0},
        {courier_company_id:12,courier_name:'Blocked',cod:1,blocked:1}
      ]}}};
  };
  const client=createShiprocketClient({env,fetchImpl});
  const result=await client.checkCod({deliveryPincode:'226001',weightKg:0.5});
  assert.equal(result.serviceable,true);
  assert.deepEqual(result.couriers.map(c=>c.courierId),[10]);
  assert.match(calls[1].url,/delivery_postcode=226001/);
  assert.match(calls[1].url,/cod=1/);
  assert.equal(calls[1].opts.headers.Authorization,'Bearer fake-token');
  await client.checkCod({deliveryPincode:'110001',weightKg:0.5});
  assert.equal(calls.filter(c=>c.url.endsWith('/auth/login')).length,1);
});
test('fails closed on malformed provider data and invalid inputs',async()=>{
  const client=createShiprocketClient({env,fetchImpl:async(url)=>({ok:true,json:async()=>url.endsWith('/auth/login')?{token:'fake'}:{data:{}}})});
  await assert.rejects(client.checkCod({deliveryPincode:'123',weightKg:0.5}),/PIN/);
  await assert.rejects(client.checkCod({deliveryPincode:'226001',weightKg:0}),/weight/);
  await assert.rejects(client.checkCod({deliveryPincode:'226001',weightKg:0.5}),/could not be verified/);
});
test('does not treat upstream errors as serviceable',async()=>{
  const client=createShiprocketClient({env,fetchImpl:async()=>({ok:false,status:503})});
  await assert.rejects(client.checkCod({deliveryPincode:'226001',weightKg:0.5}),/unavailable/);
});
