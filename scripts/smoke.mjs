import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const project = fileURLToPath(new URL('..', import.meta.url));
const dataDir = await mkdtemp(join(tmpdir(), 'asryo-smoke-'));
const portProbe = createServer();
await new Promise((resolve, reject) => portProbe.listen(0, '127.0.0.1', resolve).once('error', reject));
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const adminEmail = 'smoke@example.test';
const adminPassword = 'smoke-only-password-with-more-than-24-characters';
const legacyDb = new DatabaseSync(join(dataDir, 'asryo.sqlite'));
legacyDb.exec(`CREATE TABLE orders (
  id TEXT PRIMARY KEY, customer_id TEXT, public_token_hash TEXT NOT NULL, status TEXT NOT NULL,
  payment_status TEXT NOT NULL, total_paise INTEGER NOT NULL, shipping_paise INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR', shipping_json TEXT NOT NULL,
  razorpay_order_id TEXT UNIQUE, razorpay_payment_id TEXT, callback_verified_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT INTO orders(id,public_token_hash,status,payment_status,total_paise,shipping_paise,shipping_json,created_at,updated_at)
VALUES('legacy-payment-preview','${'a'.repeat(64)}','legacy_preview','created',100,0,'{}','2026-01-01','2026-01-01');`);
legacyDb.close();
let child;
let logs = '';
let openDb;

function startServer(storeReady) {
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: project,
    env: {
      ...process.env, PORT: String(port), DATA_DIR: dataDir, NODE_ENV: 'test',
      STORE_READY: String(storeReady), APP_ORIGIN: base,
      RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', RAZORPAY_WEBHOOK_SECRET: '',
      ADMIN_EMAIL: adminEmail, ADMIN_PASSWORD: adminPassword,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8').on('data', chunk => { logs += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { logs += chunk; });
  return waitForServer();
}

async function waitForServer() {
  let lastHealth = 'not attempted';
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited early: ${logs}`);
    try { const res = await fetch(`${base}/healthz`); if (res.ok) return; lastHealth = `HTTP ${res.status}`; } catch (error) { lastHealth = error.message; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${logs}; health check: ${lastHealth}`);
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
}

try {
  await startServer(false);
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200, 'storefront loads');
  assert.match(page.headers.get('content-security-policy') || '', /frame-ancestors 'none'/, 'security headers are set');
  assert.doesNotMatch(page.headers.get('content-security-policy') || '', /razorpay/i, 'payment provider is absent from the browser policy');
  assert.match(await page.text(), /ASRYO/);

  const [health, status, catalog, adminPage, trackPage] = await Promise.all([
    fetch(`${base}/healthz`), fetch(`${base}/api/status`), fetch(`${base}/api/products`),
    fetch(`${base}/admin`), fetch(`${base}/track.html`),
  ]);
  assert.deepEqual(await health.json(), { ok: true });
  const readiness = await status.json();
  assert.equal(readiness.storeReady, false, 'store is closed by default');
  assert.equal(readiness.paymentMethod, 'cash_on_delivery', 'COD is the only configured payment method');
  const products = (await catalog.json()).products;
  assert.equal(products.length, 20, 'all ASRYO preview products load');
  assert(products.every(p => !p.active && p.pricePaise === null), 'no unpriced preview item is purchasable');
  assert.equal(adminPage.status, 200, 'admin page loads');
  assert.equal(trackPage.status, 200, 'tracking page loads');

  const blockedCheckout = await fetch(`${base}/api/checkout/orders`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [] }),
  });
  assert.equal(blockedCheckout.status, 503, 'checkout stays closed until explicitly configured');
  const wrongOrigin = await fetch(`${base}/api/admin/login`, {
    method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(wrongOrigin.status, 403, 'cross-origin writes are rejected');
  const unauthorizedAdmin = await fetch(`${base}/api/admin/orders`);
  assert.equal(unauthorizedAdmin.status, 401, 'admin endpoints require a session');
  for (const endpoint of ['/api/razorpay/callback', '/api/razorpay/webhook']) {
    const response = await fetch(`${base}${endpoint}`, {
      method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(response.status, 404, `${endpoint} is disabled`);
  }

  await stopServer();
  const db = new DatabaseSync(join(dataDir, 'asryo.sqlite'));
  assert.equal(db.prepare("SELECT payment_method FROM orders WHERE id='legacy-payment-preview'").get().payment_method, 'legacy_online', 'legacy payment records are not mislabeled as COD');
  const product = db.prepare('SELECT id FROM products LIMIT 1').get();
  db.prepare('UPDATE products SET price_paise=200,stock=5,active=1 WHERE id=?').run(product.id);
  db.close();
  await startServer(true);

  const openStatus = await (await fetch(`${base}/api/status`)).json();
  assert.equal(openStatus.storeReady, true, 'an explicitly opened store with available products is ready without payment credentials');
  assert.equal(openStatus.paymentMethod, 'cash_on_delivery');
  const payload = {
    email: 'customer@example.test', phone: '+919876543210',
    address: { name: 'Test Customer', line1: '1 Example Road', city: 'Jaipur', region: 'Rajasthan', postalCode: '302001', country: 'India' },
    items: [{ id: product.id, quantity: 2 }],
  };
  const createOrder = () => fetch(`${base}/api/checkout/orders`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const placed = await createOrder();
  assert.equal(placed.status, 201, 'COD order can be placed without any online payment keys');
  const order = await placed.json();
  assert.equal(order.paymentMethod, 'cash_on_delivery');
  assert.equal(order.amountPaise, 400);
  openDb = new DatabaseSync(join(dataDir, 'asryo.sqlite'));
  const stored = openDb.prepare('SELECT status,payment_status,payment_method,total_paise FROM orders WHERE id=?').get(order.orderId);
  assert.deepEqual({ ...stored }, { status: 'processing', payment_status: 'due_on_delivery', payment_method: 'cash_on_delivery', total_paise: 400 });
  assert.equal(openDb.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock, 3, 'stock is reserved on order placement');

  const tracking = await fetch(`${base}/api/orders/track?id=${encodeURIComponent(order.orderId)}&token=${encodeURIComponent(order.trackingToken)}`);
  assert.equal(tracking.status, 200, 'private tracking link finds the new order');
  assert.equal((await tracking.json()).order.paymentStatus, 'due_on_delivery', 'tracking reports cash due on delivery');

  const oversell = await fetch(`${base}/api/checkout/orders`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, items: [{ id: product.id, quantity: 4 }] }),
  });
  assert.equal(oversell.status, 400, 'stock cannot be oversold');
  assert.equal(openDb.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock, 3, 'rejected order leaves stock unchanged');

  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  assert.equal(login.status, 200, 'admin can sign in to manage COD orders');
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert(cookie, 'admin session cookie is issued');
  const cancelled = await fetch(`${base}/api/admin/orders/${encodeURIComponent(order.orderId)}`, {
    method: 'PATCH', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  assert.equal(cancelled.status, 200, 'admin can cancel an unshipped COD order');
  assert.equal(openDb.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock, 5, 'cancelling restores reserved stock');
  const doubleCancel = await fetch(`${base}/api/admin/orders/${encodeURIComponent(order.orderId)}`, {
    method: 'PATCH', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  assert.equal(doubleCancel.status, 400, 'repeated cancellation cannot restock twice');
  assert.equal(openDb.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock, 5);
  openDb.close();
  openDb = null;

  const assistant = await fetch(`${base}/api/assistant`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'What can I browse?' }),
  });
  assert.equal(assistant.status, 200, 'preview shopping assistant works without an AI key');
  assert.equal((await assistant.json()).mode, 'preview');
  console.log('ASRYO checks passed: closed-by-default readiness, storefront, catalog, security headers, origin checks, admin protection, disabled online-payment routes, COD ordering without payment credentials, order tracking, stock reservation, oversell rejection, cancellation restock, and assistant preview.');
} finally {
  await stopServer();
  openDb?.close();
  await rm(dataDir, { recursive: true, force: true });
}
