import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {initInventory,createSku,adjustStock,inventoryOverview} from '../inventory.mjs';
function fixture(){const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,category TEXT,type TEXT,image TEXT,description TEXT,price_paise INTEGER,stock INTEGER,active INTEGER,options_json TEXT,updated_at TEXT); INSERT INTO products VALUES('design','ASRYO sample','clothing','hoodie','sample.webp','Sample',NULL,NULL,0,'[]','test');`);initInventory(db);return db;}
const spec={parentProductId:'design',sku:'ASRYO-TEST-M-BLACK',size:'M',colour:'Black',reorderPoint:2};
test('size SKUs are idempotent drafts without assumed price or stock; parent is preserved',()=>{
 const db=fixture();try{
  const first=createSku(db,spec);assert(first.created);assert.equal(createSku(db,spec).productId,first.productId);
  const row=db.prepare('SELECT active,price_paise,stock FROM products WHERE id=?').get(first.productId);assert.deepEqual({...row},{active:0,price_paise:null,stock:null});
  assert.throws(()=>createSku(db,{...spec,sku:'OTHER-SKU'}),e=>e.status===409);
  assert.throws(()=>createSku(db,{...spec,size:'L'}),e=>e.status===409);
  assert.equal(db.prepare("SELECT stock FROM products WHERE id='design'").get().stock,null);
  assert.throws(()=>createSku(db,{...spec,sku:'BAD<>',size:'L'}),e=>e.status===400);
  db.exec("UPDATE products SET active=1 WHERE id='design'");assert.throws(()=>createSku(db,{...spec,sku:'ASRYO-L',size:'L'}),e=>e.status===409);
 }finally{db.close();}
});
test('stock adjustments reject stale counts and duplicate mutations; alerts use owner threshold',()=>{
 const db=fixture();try{
  const productId=createSku(db,spec).productId;
  assert.equal(inventoryOverview(db).skus[0].alert,'unconfirmed');
  const input={productId,expectedStock:null,delta:5,reason:'receipt',note:'Synthetic receipt',requestId:randomUUID()};
  assert.equal(adjustStock(db,input).stock,5);assert(adjustStock(db,input).replayed);
  assert.throws(()=>adjustStock(db,{...input,delta:4}),e=>e.status===409);
  assert.throws(()=>adjustStock(db,{...input,requestId:randomUUID()}),e=>e.status===409);
  assert.throws(()=>adjustStock(db,{...input,requestId:randomUUID(),expectedStock:5,delta:-6,reason:'damage'}),e=>e.status===400);
  assert.equal(adjustStock(db,{...input,requestId:randomUUID(),expectedStock:5,delta:-3,reason:'damage'}).stock,2);
  assert.equal(inventoryOverview(db).skus[0].alert,'low_stock');
  assert.equal(inventoryOverview(db).movements.length,2);
 }finally{db.close();}
});
