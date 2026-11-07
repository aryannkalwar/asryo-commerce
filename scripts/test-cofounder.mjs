import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleCofounder } from '../cofounder.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,category TEXT,stock INTEGER,price_paise INTEGER,active INTEGER,updated_at TEXT)");
  db.exec("CREATE TABLE orders(id TEXT PRIMARY KEY,status TEXT,payment_status TEXT,total_paise INTEGER)");
  db.exec("CREATE TABLE early_access(email TEXT,verified_at TEXT,unsubscribed_at TEXT)");
  db.prepare("INSERT INTO products VALUES('shirt','ASRYO Test Shirt','clothing',3,199900,1,'2026-11-08')").run();
  db.prepare("INSERT INTO orders VALUES('order-1','delivered','collected',199900)").run();
  db.prepare("INSERT INTO early_access VALUES('test@example.invalid','2026-11-08',NULL)").run();
  const request = async (method,path,body) => {
    const res = {};
    await handleCofounder({
      db,req:{method},res,path,
      json:(_res,status,payload)=>{res.status=status;res.payload=payload;return payload;},
      jsonBody:async()=>body
    });
    return res;
  };
  return {db,request};
}

test('cofounder shows real aggregated sales and stock alerts', async () => {
  const {db,request} = fixture();
  try {
    const response = await request('GET','/api/admin/cofounder/overview');
    assert.equal(response.status,200);
    assert.equal(response.payload.metrics.totalOrders,1);
    assert.equal(response.payload.metrics.collectedRevenuePaise,199900);
    assert.equal(response.payload.metrics.subscribedCustomers,1);
    assert.equal(response.payload.lowStock[0].stock,3);
    assert.equal(response.payload.metrics.storeReady,false);
  } finally {db.close();}
});

test('draft approval never mutates stock or checkout records', async () => {
  const {db,request} = fixture();
  try {
    const before=db.prepare("SELECT stock FROM products WHERE id='shirt'").get().stock;
    const created=await request('POST','/api/admin/cofounder/drafts',
      {kind:'campaign',productId:'shirt',brief:'Show original ASRYO apparel without unverified claims.'});
    assert.equal(created.status,201);
    assert.equal(created.payload.draft.status,'draft');
    const approved=await request('PATCH',
      '/api/admin/cofounder/drafts/'+created.payload.draft.id,{status:'approved'});
    assert.equal(approved.status,200);
    assert.match(approved.payload.note,/Nothing is sent/);
    assert.equal(db.prepare("SELECT stock FROM products WHERE id='shirt'").get().stock,before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,1);
  } finally {db.close();}
});

test('invalid proposal types are rejected', async () => {
  const {db,request} = fixture();
  try {
    const response=await request('POST','/api/admin/cofounder/drafts',{kind:'send-all',brief:'Test'});
    assert.equal(response.status,400);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cofounder_drafts').get().n,0);
  } finally {db.close();}
});
