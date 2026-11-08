import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {unitEconomics,validateProfile,emptyProfile,handleFinance} from '../commerce-finance.mjs';
const mk=()=>({fabric:20000,printing:10000,packaging:2000,inbound:1000,shipping:5000,platform:6000,payment:2000,marketing:5000,returnHandling:10000,gstBps:500,returnBps:1000});
test('INR calculations use tax-inclusive amount and explicitly reserve only return handling',()=>{
 const model=unitEconomics(99900,mk());
 assert.equal(model.cogsPaise,33000);
 assert.equal(model.otherCostPaise,18000);
 assert.equal(model.illustrativeOutputGstPaise,4757);
 assert.equal(model.contributionOnSuccessfulSalePaise,44143);
 assert.equal(model.expectedReturnHandlingPaise,1000);
 assert.equal(model.contributionAfterHandlingReservePaise,43143);
 assert.match(model.note,/does not model refunds/i);
});
test('negative, fractional, oversized and missing costs are rejected',()=>{
 assert.ok(validateProfile({}).error);
 for(const bad of [-1,1.25,100000001,Infinity,NaN]){
  assert.ok(validateProfile({...mk(),fabric:bad}).error);
 }
 assert.ok(validateProfile({...mk(),gstBps:10001}).error);
 assert.deepEqual(validateProfile(emptyProfile()).value,emptyProfile());
});
test('saving cost profile does not change catalog price, activation or stock',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON;CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,category TEXT,type TEXT,price_paise INTEGER,stock INTEGER,active INTEGER);');
 db.prepare("INSERT INTO products VALUES('shirt','ASRYO heavyweight tee','clothing','tshirt',99900,8,0)").run();
 const perform=async(method,path,input)=>{
  let result;
  await handleFinance({db,req:{method},res:{},path,json:(_res,code,data)=>{result={code,data};return data;},jsonBody:async()=>input});
  return result;
 };
 try{
  const saved=await perform('PUT','/api/admin/finance/products/shirt',mk());
  assert.equal(saved.code,200);
  assert.match(saved.data.note,/not modified/i);
  const products=await perform('GET','/api/admin/finance/products');
  assert.equal(products.code,200);
  assert.equal(products.data.products[0].economics.contributionOnSuccessfulSalePaise,44143);
  assert.equal(db.prepare("SELECT price_paise,stock,active FROM products WHERE id='shirt'").get().stock,8);
  assert.deepEqual(db.prepare("SELECT price_paise,stock,active FROM products WHERE id='shirt'").get(),{price_paise:99900,stock:8,active:0});
  const invalid=await perform('PUT','/api/admin/finance/products/shirt',{...mk(),payment:-5});
  assert.equal(invalid.code,400);
  assert.equal((await perform('GET','/api/admin/finance/products')).data.products[0].profile.payment,2000);
  assert.equal((await perform('PUT','/api/admin/finance/products/missing',mk())).code,404);
 }finally{db.close();}
});
