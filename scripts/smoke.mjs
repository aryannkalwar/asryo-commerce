import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const project = fileURLToPath(new URL('..', import.meta.url));
const dataDir = await mkdtemp(join(tmpdir(), 'asryo-smoke-'));
const portProbe = createServer();
await new Promise((resolve, reject) => portProbe.listen(0, '127.0.0.1', resolve).once('error', reject));
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));

const child = spawn(process.execPath, ['server.mjs'], {
  cwd: project,
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, NODE_ENV: 'test', STORE_READY: 'false', APP_ORIGIN: `http://127.0.0.1:${port}`, RAZORPAY_WEBHOOK_SECRET: 'smoke-webhook-secret' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.setEncoding('utf8').on('data', chunk => { logs += chunk; });
child.stderr.setEncoding('utf8').on('data', chunk => { logs += chunk; });
const base = `http://127.0.0.1:${port}`;
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited early: ${logs}`);
    try { const res = await fetch(`${base}/healthz`); if (res.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${logs}`);
}

try {
  await waitForServer();
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200, 'storefront loads');
  assert.match(page.headers.get('content-security-policy') || '', /frame-ancestors 'none'/, 'security headers are set');
  assert.match(await page.text(), /ASRYO/);

  const [health, status, catalog, adminPage, trackPage] = await Promise.all([
    fetch(`${base}/healthz`), fetch(`${base}/api/status`), fetch(`${base}/api/products`),
    fetch(`${base}/admin`), fetch(`${base}/track.html`),
  ]);
  assert.deepEqual(await health.json(), { ok: true });
  const readiness = await status.json();
  assert.equal(readiness.storeReady, false, 'store is closed by default');
  const products = (await catalog.json()).products;
  assert.equal(products.length, 20, 'all launch preview products load');
  assert(products.every(p => !p.active && p.pricePaise === null), 'no unpriced preview item is purchasable');
  assert.equal(adminPage.status, 200, 'admin page loads');
  assert.equal(trackPage.status, 200, 'tracking page loads');

  const blockedCheckout = await fetch(`${base}/api/checkout/orders`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [] }),
  });
  assert.equal(blockedCheckout.status, 503, 'checkout remains disabled until explicitly configured');
  const wrongOrigin = await fetch(`${base}/api/admin/login`, {
    method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(wrongOrigin.status, 403, 'cross-origin write is rejected');
  const unauthorizedAdmin = await fetch(`${base}/api/admin/orders`);
  assert.equal(unauthorizedAdmin.status, 401, 'admin endpoints require a session');
  const invalidWebhook = await fetch(`${base}/api/razorpay/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': 'bad' }, body: '{}',
  });
  assert.equal(invalidWebhook.status, 401, 'unsigned Razorpay webhooks are rejected');

  const db = new DatabaseSync(join(dataDir, 'asryo.sqlite'));
  const product = db.prepare('SELECT id FROM products LIMIT 1').get();
  db.prepare('UPDATE products SET price_paise=200,stock=5,active=1 WHERE id=?').run(product.id);
  const orderId = 'smoke-order'; const at = new Date().toISOString();
  db.prepare(`INSERT INTO orders(id,public_token_hash,status,payment_status,total_paise,shipping_paise,shipping_json,razorpay_order_id,created_at,updated_at)
    VALUES(?,?,'payment_pending','created',400,0,?,'order_smoke',?,?)`).run(orderId,'a'.repeat(64),JSON.stringify({email:'smoke@example.test'}),at,at);
  db.prepare('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price_paise) VALUES(?,?,?,?,?)').run(orderId,product.id,'Smoke Product',2,200);
  const paidEvent = JSON.stringify({event:'order.paid',payload:{order:{entity:{id:'order_smoke',status:'paid',amount_paid:400,currency:'INR'}},payment:{entity:{id:'pay_smoke',order_id:'order_smoke'}}}});
  const signature = createHmac('sha256','smoke-webhook-secret').update(paidEvent).digest('hex');
  const signed = async eventId => fetch(`${base}/api/razorpay/webhook`, { method:'POST', headers:{'Content-Type':'application/json','X-Razorpay-Signature':signature,'X-Razorpay-Event-Id':eventId}, body:paidEvent });
  assert.equal((await signed('evt-smoke-1')).status,200,'a valid signed payment webhook is accepted');
  assert.equal(db.prepare('SELECT payment_status FROM orders WHERE id=?').get(orderId).payment_status,'paid','a matching paid event confirms the order');
  assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock,3,'stock is reduced after payment confirmation');
  assert.equal((await signed('evt-smoke-1')).status,200,'duplicate event delivery is accepted idempotently');
  await signed('evt-smoke-2');
  assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock,3,'a repeated paid event never reduces stock twice');
  db.close();
  const assistant = await fetch(`${base}/api/assistant`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'What can I browse?' }),
  });
  assert.equal(assistant.status, 200, 'preview shopping assistant works without an AI key');
  assert.equal((await assistant.json()).mode, 'preview');
  console.log('ASRYO smoke checks passed: storefront, catalogue, readiness lock, admin protection, origin checks, unsigned webhook rejection, valid signed-webhook processing, payment idempotence, and assistant preview.');
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
  await rm(dataDir, { recursive: true, force: true });
}
