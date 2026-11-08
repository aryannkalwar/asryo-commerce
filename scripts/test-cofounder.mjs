import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleCofounder } from '../cofounder.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,category TEXT,stock INTEGER,price_paise INTEGER,active INTEGER,updated_at TEXT)");
  db.exec("CREATE TABLE orders(id TEXT PRIMARY KEY,status TEXT,payment_status TEXT,total_paise INTEGER,created_at TEXT)");
  db.exec("CREATE TABLE early_access(email TEXT,verified_at TEXT,unsubscribed_at TEXT)");
  db.prepare("INSERT INTO products VALUES('shirt','ASRYO Test Shirt','clothing',3,199900,1,'2026-11-08')").run();
  db.prepare("INSERT INTO orders VALUES('order-1','delivered','collected',199900,'2026-11-08T10:00:00.000Z')").run();
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

test('review automation is idempotent, does not change stock or orders', async () => {
  const {db,request}=fixture();
  try {
    const originalStock=db.prepare("SELECT stock FROM products WHERE id='shirt'").get().stock;
    const one=await request('POST','/api/admin/cofounder/automations/evaluate',{});
    assert.equal(one.status,200);
    assert.ok(one.payload.newRecommendations>=1);
    const two=await request('POST','/api/admin/cofounder/automations/evaluate',{});
    assert.equal(two.status,200);
    assert.equal(two.payload.newRecommendations,0);
    const queue=await request('GET','/api/admin/cofounder/automations');
    assert.equal(queue.status,200);
    const alert=queue.payload.events.find(x=>x.ruleKey==='low_stock:shirt');
    assert.ok(alert);
    assert.equal(alert.status,'pending');
    const review=await request('PATCH','/api/admin/cofounder/automations/'+alert.id,{status:'reviewed'});
    assert.equal(review.status,200);
    assert.match(review.payload.note,/No external action/);
    assert.equal(db.prepare("SELECT stock FROM products WHERE id='shirt'").get().stock,originalStock);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,1);
  }finally{db.close();}
});

test('automation review rejects invalid state transitions without side effects', async()=>{
  const {db,request}=fixture();
  try {
    const analysis=await request('POST','/api/admin/cofounder/automations/evaluate',{});
    const id=analysis.payload.events[0].id;
    const bad=await request('PATCH','/api/admin/cofounder/automations/'+id,{status:'execute'});
    assert.equal(bad.status,400);
    const row=db.prepare('SELECT status FROM cofounder_automation_events WHERE id=?').get(id);
    assert.equal(row.status,'pending');
  }finally{db.close();}
});
