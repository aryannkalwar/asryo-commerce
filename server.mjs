import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, scrypt as scryptCallback, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import catalog from './data/catalog.json' with { type: 'json' };

const scrypt = promisify(scryptCallback);
const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const dataDir = resolve(process.env.DATA_DIR || join(root, 'data'));
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, 'asryo.sqlite'), { timeout: 5000 });
const rateBuckets = new Map();
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, type TEXT NOT NULL,
    image TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price_paise INTEGER,
    stock INTEGER, active INTEGER NOT NULL DEFAULT 0, options_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    verified_at TEXT, verify_token_hash TEXT, verify_expires_at INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, customer_id TEXT REFERENCES customers(id), public_token_hash TEXT NOT NULL,
    status TEXT NOT NULL, payment_status TEXT NOT NULL, total_paise INTEGER NOT NULL,
    shipping_paise INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'INR',
    shipping_json TEXT NOT NULL, razorpay_order_id TEXT UNIQUE, razorpay_payment_id TEXT,
    callback_verified_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS order_items (
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id TEXT NOT NULL,
    product_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price_paise INTEGER NOT NULL,
    PRIMARY KEY(order_id, product_id)
  );
  CREATE TABLE IF NOT EXISTS webhook_events (
    event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS orders_customer_created ON orders(customer_id, created_at DESC);
`);

const now = () => new Date().toISOString();
const hash = value => createHash('sha256').update(value).digest('hex');
const publicBase = path => `${(process.env.APP_ORIGIN || '').replace(/\/$/, '')}${path}`;
const productRow = row => ({
  id: row.id, name: row.name, category: row.category, type: row.type,
  image: `/assets/${encodeURIComponent(row.image)}`, description: row.description,
  pricePaise: row.price_paise, stock: row.stock, active: Boolean(row.active),
  options: JSON.parse(row.options_json || '[]'),
});

for (const item of catalog) {
  db.prepare(`INSERT OR IGNORE INTO products(id,name,category,type,image,updated_at)
    VALUES(?,?,?,?,?,?)`).run(item.id, item.name, item.category, item.type, item.image, now());
}

const mime = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.png':'image/png', '.webp':'image/webp', '.ico':'image/x-icon', '.xml':'application/xml; charset=utf-8',
};

function setHeaders(res, contentType = 'application/json; charset=utf-8') {
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://api.razorpay.com; img-src 'self' data: https://*.razorpay.com; style-src 'self' 'unsafe-inline'; script-src 'self' https://checkout.razorpay.com; connect-src 'self' https://api.openai.com https://api.resend.com; upgrade-insecure-requests");
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function json(res, status, value) {
  setHeaders(res);
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(value));
}

async function body(req, limit = 64 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function jsonBody(req, limit) {
  const raw = await body(req, limit);
  try { return JSON.parse(raw.toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function originOf(req) {
  const forwarded = req.headers['x-forwarded-proto'];
  const scheme = forwarded ? String(forwarded).split(',')[0].trim() : 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${scheme}://${host}`;
}

function requireSameOrigin(req) {
  const expected = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : originOf(req);
  const origin = req.headers.origin;
  if (!origin || origin !== expected) throw Object.assign(new Error('Request origin rejected'), { status: 403 });
}

function rateLimit(req, res, key, limit, windowMs) {
  const at = Date.now();
  const ip = req.socket.remoteAddress || 'unknown';
  const bucketKey = `${key}:${ip}`;
  let bucket = rateBuckets.get(bucketKey);
  if (!bucket || bucket.until <= at) bucket = { count: 0, until: at + windowMs };
  bucket.count++;
  rateBuckets.set(bucketKey, bucket);
  if (rateBuckets.size > 2000) for (const [k, v] of rateBuckets) if (v.until <= at) rateBuckets.delete(k);
  if (bucket.count > limit) {
    res.setHeader('Retry-After', String(Math.ceil((bucket.until-at)/1000)));
    json(res, 429, { error: 'Too many requests. Please wait and try again.' });
    return false;
  }
  return true;
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const i = part.indexOf('='); return [part.slice(0, i), decodeURIComponent(part.slice(i + 1))];
  }));
}

function cookie(res, name, value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

function clearCookie(res, name) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function customerFrom(req) {
  const raw = cookies(req).asryo_session;
  if (!raw) return null;
  const session = db.prepare('SELECT customer_id FROM sessions WHERE token_hash=? AND expires_at>?').get(hash(raw), Date.now());
  if (!session) return null;
  return db.prepare('SELECT id,email FROM customers WHERE id=? AND verified_at IS NOT NULL').get(session.customer_id) || null;
}

function requireAdmin(req) {
  const raw = cookies(req).asryo_admin;
  if (!raw) throw Object.assign(new Error('Admin sign-in required'), { status: 401 });
  const session = db.prepare('SELECT 1 FROM admin_sessions WHERE token_hash=? AND expires_at>?').get(hash(raw), Date.now());
  if (!session) throw Object.assign(new Error('Admin sign-in required'), { status: 401 });
}

function secureEqHex(a, b) {
  if (!/^[a-f0-9]+$/i.test(a || '') || !/^[a-f0-9]+$/i.test(b || '') || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
function secureEqText(a, b) {
  const left=Buffer.from(String(a)); const right=Buffer.from(String(b));
  return left.length===right.length && timingSafeEqual(left,right);
}

async function passwordHash(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${Buffer.from(key).toString('hex')}`;
}

async function passwordMatches(password, stored) {
  const [scheme, saltHex, expectedHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !/^[a-f0-9]{32}$/i.test(saltHex) || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltHex, 'hex'), 64));
  return timingSafeEqual(actual, Buffer.from(expectedHex, 'hex'));
}

async function sendVerification(email, token) {
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) throw Object.assign(new Error('Account verification is not configured'), { status: 503 });
  const link = publicBase(`/api/auth/verify?token=${encodeURIComponent(token)}`);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [email], subject: 'Verify your ASRYO account', html: `<p>Confirm your ASRYO account:</p><p><a href="${link}">Verify email</a></p><p>This link expires in 30 minutes.</p>` }),
  });
  if (!response.ok) throw Object.assign(new Error('Verification email could not be sent'), { status: 503 });
}

function allProducts() {
  return db.prepare('SELECT * FROM products ORDER BY category, name').all().map(productRow);
}

function publicOrder(order) {
  return { id: order.id, status: order.status, paymentStatus: order.payment_status,
    totalPaise: order.total_paise, shippingPaise: order.shipping_paise, currency: order.currency,
    createdAt: order.created_at, updatedAt: order.updated_at };
}

function verifyWebhook(raw, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  return secureEqHex(expected, String(signature));
}

async function createRazorpayOrder({ orderId, amount, email }) {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) throw Object.assign(new Error('Razorpay is not configured'), { status: 503 });
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ amount, currency: 'INR', receipt: orderId.slice(0, 40), notes: { asryo_order: orderId, email } }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id || result.amount !== amount || result.currency !== 'INR') {
    throw Object.assign(new Error('Razorpay could not create the order'), { status: 502 });
  }
  return { id: result.id, keyId: id };
}

async function checkout(req, res) {
  const input = await jsonBody(req);
  if (String(process.env.STORE_READY).toLowerCase() !== 'true') return json(res, 503, { error: 'Online ordering is not open yet.' });
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || !process.env.RAZORPAY_WEBHOOK_SECRET) return json(res, 503, { error: 'Payment setup is incomplete.' });
  const email = String(input.email || '').trim().toLowerCase();
  const phone = String(input.phone || '').trim();
  const address = input.address || {};
  if (!/^\S+@\S+\.\S+$/.test(email) || phone.length < 7 || !address.name || !address.line1 || !address.city || !address.region || !address.postalCode || !address.country) {
    return json(res, 400, { error: 'Enter a valid email, phone number and complete shipping address.' });
  }
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 20) return json(res, 400, { error: 'Your cart is empty or too large.' });
  const items = [];
  const seen = new Set();
  for (const candidate of input.items) {
    const productId = String(candidate.id || '');
    if (seen.has(productId)) return json(res, 400, { error: 'Your cart contains a duplicate item. Refresh your cart.' });
    seen.add(productId);
    const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(productId);
    const qty = Number(candidate.quantity);
    if (!product || !Number.isInteger(qty) || qty < 1 || qty > 10 || product.price_paise == null || product.stock == null) {
      return json(res, 400, { error: 'A selected item is unavailable or has changed. Refresh your cart.' });
    }
    items.push({ product, qty });
  }
  // Pending Razorpay orders reserve stock for their 30-minute checkout window.
  for (const { product, qty } of items) {
    const reserved = db.prepare(`SELECT COALESCE(SUM(oi.quantity),0) AS units FROM order_items oi
      JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=? AND o.payment_status='created'
      AND o.created_at>?`).get(product.id, new Date(Date.now()-30*60*1000).toISOString()).units;
    if (product.stock - reserved < qty) return json(res, 400, { error: 'A selected item has just sold out. Refresh your cart.' });
  }
  const subtotal = items.reduce((sum, x) => sum + x.product.price_paise * x.qty, 0);
  const shipping = Math.max(0, Number(process.env.SHIPPING_FEE_PAISE || 0));
  const amount = subtotal + shipping;
  if (!Number.isSafeInteger(amount) || amount < 100) return json(res, 400, { error: 'Order total is invalid.' });
  const id = randomUUID();
  const tracking = randomBytes(32).toString('base64url');
  const customer = customerFrom(req);
  const at = now();
  db.prepare(`INSERT INTO orders(id,customer_id,public_token_hash,status,payment_status,total_paise,shipping_paise,shipping_json,created_at,updated_at)
    VALUES(?,?,?,'payment_pending','created',?, ?, ?, ?, ?)`)
    .run(id, customer?.id || null, hash(tracking), amount, shipping, JSON.stringify({ ...address, email, phone }), at, at);
  const insertLine = db.prepare('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price_paise) VALUES(?,?,?,?,?)');
  for (const x of items) insertLine.run(id, x.product.id, x.product.name, x.qty, x.product.price_paise);
  try {
    const rzp = await createRazorpayOrder({ orderId: id, amount, email });
    db.prepare('UPDATE orders SET razorpay_order_id=?,updated_at=? WHERE id=?').run(rzp.id, now(), id);
    return json(res, 201, { orderId: id, trackingToken: tracking, amountPaise: amount, currency: 'INR', razorpayOrderId: rzp.id, razorpayKeyId: rzp.keyId, email });
  } catch (error) {
    db.prepare("UPDATE orders SET status='payment_setup_failed',payment_status='failed',updated_at=? WHERE id=?").run(now(), id);
    throw error;
  }
}

async function handle(req, res) {
  setHeaders(res, 'text/plain; charset=utf-8');
  const url = new URL(req.url, originOf(req));
  const path = decodeURIComponent(url.pathname);
  try {
    if (req.method === 'GET' && path === '/healthz') return json(res, 200, { ok:true });
    if (path.startsWith('/api/') && req.method !== 'GET' && path !== '/api/razorpay/webhook') requireSameOrigin(req);
    const limits = {
      '/api/auth/login': [8, 15*60*1000], '/api/auth/register': [5, 60*60*1000],
      '/api/admin/login': [8, 15*60*1000], '/api/assistant': [30, 60*1000],
      '/api/checkout/orders': [10, 15*60*1000],
    };
    if (req.method === 'POST' && limits[path] && !rateLimit(req, res, path, ...limits[path])) return;

    if (req.method === 'GET' && path === '/api/status') {
      const available = db.prepare('SELECT COUNT(*) AS n FROM products WHERE active=1 AND price_paise>0 AND stock>0').get().n;
      const ready = String(process.env.STORE_READY).toLowerCase() === 'true' && Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET);
      return json(res, 200, { storeReady: ready, availableProducts: available, assistant: Boolean(process.env.OPENAI_API_KEY), accountVerification: Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM), supportEmail: process.env.PUBLIC_SUPPORT_EMAIL || null, supportPhone: process.env.PUBLIC_SUPPORT_PHONE || '+916394755253', businessName: process.env.PUBLIC_BUSINESS_NAME || 'ASRYO' });
    }
    if (req.method === 'GET' && path === '/api/products') return json(res, 200, { products: allProducts() });

    if (req.method === 'POST' && path === '/api/assistant') {
      const { question = '' } = await jsonBody(req, 12 * 1024);
      const q = String(question).trim().slice(0, 700);
      if (!q) return json(res, 400, { error: 'Ask a question about the collection.' });
      const products = allProducts().filter(p => p.active).map(p => ({ name:p.name, category:p.category, type:p.type, description:p.description }));
      if (!process.env.OPENAI_API_KEY) {
        const ql = q.toLowerCase();
        const groups = ['clothing','jewellery','art','home-lifestyle'];
        const selected = groups.find(g => ql.includes(g.replace('-', ' ')) || ql.includes(g.split('-')[0])) || 'clothing';
        const recs = allProducts().filter(p => p.category === selected).slice(0, 3).map(p => p.name);
        return json(res, 200, { mode:'preview', answer: recs.length ? `I can help you explore ${selected.replace('-', ' ')}. These pieces are currently listed as launch previews; prices and availability are still being confirmed.` : 'The ASRYO collection is in preview. Tell me whether you are browsing clothing, jewellery, art or home, and I can point you to the right edit.', suggestions: recs });
      }
      const response = await fetch('https://api.openai.com/v1/responses', {
        method:'POST', headers:{ Authorization:`Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type':'application/json' },
        body:JSON.stringify({ model:process.env.OPENAI_MODEL || 'gpt-4.1-mini', max_output_tokens:220, input:[
          { role:'system', content:`You are ASRYO's concise shopping assistant. Only use these verified product facts: ${JSON.stringify(products)}. Never invent prices, stock, delivery dates, materials, sizing, policies, or order status. If a detail is missing, say the store is confirming it. Do not request payment details or passwords.` },
          { role:'user', content:q },
        ] }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return json(res, 502, { error:'The shopping assistant is temporarily unavailable.' });
      const answer = payload.output?.flatMap(x=>x.content || []).find(x=>x.type==='output_text')?.text || 'I could not find that information. Please contact ASRYO support.';
      return json(res, 200, { mode:'ai', answer });
    }

    if (req.method === 'POST' && path === '/api/auth/register') {
      const input = await jsonBody(req, 12 * 1024);
      const email = String(input.email || '').trim().toLowerCase();
      const password = String(input.password || '');
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 12 || password.length > 128) return json(res, 400, { error:'Use a valid email and a password of at least 12 characters.' });
      if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return json(res, 503, { error:'Verified customer accounts are not configured yet.' });
      if (db.prepare('SELECT 1 FROM customers WHERE email=?').get(email)) return json(res, 409, { error:'An account already exists. Sign in or request a new verification email.' });
      const id = randomUUID(); const token = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO customers(id,email,password_hash,verify_token_hash,verify_expires_at,created_at) VALUES(?,?,?,?,?,?)')
        .run(id,email,await passwordHash(password),hash(token),Date.now()+30*60*1000,now());
      try { await sendVerification(email, token); }
      catch (error) { db.prepare('DELETE FROM customers WHERE id=?').run(id); throw error; }
      return json(res, 202, { message:'Check your email for a verification link.' });
    }
    if (req.method === 'GET' && path === '/api/auth/verify') {
      const token = url.searchParams.get('token') || '';
      if (token.length < 32) return json(res, 400, { error:'Verification link is invalid or expired.' });
      const customer = db.prepare('SELECT id FROM customers WHERE verify_token_hash=? AND verify_expires_at>?').get(hash(token),Date.now());
      if (!customer) return json(res, 400, { error:'Verification link is invalid or expired.' });
      db.prepare('UPDATE customers SET verified_at=?,verify_token_hash=NULL,verify_expires_at=NULL WHERE id=?').run(now(),customer.id);
      res.statusCode = 303; res.setHeader('Location','/account?verified=1'); return res.end();
    }
    if (req.method === 'POST' && path === '/api/auth/login') {
      const input = await jsonBody(req, 12 * 1024); const email = String(input.email || '').trim().toLowerCase();
      const customer = db.prepare('SELECT id,email,password_hash,verified_at FROM customers WHERE email=?').get(email);
      if (!customer || !await passwordMatches(String(input.password || ''), customer.password_hash)) return json(res, 401, { error:'Email or password is incorrect.' });
      if (!customer.verified_at) return json(res, 403, { error:'Verify your email before signing in.' });
      const token = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO sessions(token_hash,customer_id,expires_at,created_at) VALUES(?,?,?,?)').run(hash(token),customer.id,Date.now()+30*24*60*60*1000,now());
      cookie(res,'asryo_session',token,30*24*60*60); return json(res,200,{ id:customer.id,email:customer.email });
    }
    if (req.method === 'GET' && path === '/api/auth/me') {
      const user = customerFrom(req); return json(res, user ? 200 : 401, user || { error:'Sign in required.' });
    }
    if (req.method === 'POST' && path === '/api/auth/logout') {
      const raw = cookies(req).asryo_session; if(raw) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(raw));
      clearCookie(res,'asryo_session'); return json(res,200,{ ok:true });
    }
    if (req.method === 'GET' && path === '/api/account/orders') {
      const user = customerFrom(req); if(!user) return json(res,401,{error:'Sign in required.'});
      const orders = db.prepare('SELECT id,status,payment_status,total_paise,shipping_paise,currency,created_at,updated_at FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 100').all(user.id);
      return json(res,200,{orders:orders.map(publicOrder)});
    }

    if (req.method === 'POST' && path === '/api/admin/login') {
      const input=await jsonBody(req,12*1024); const email=String(input.email||'').trim().toLowerCase();
      const adminEmail=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase(); const saved=process.env.ADMIN_PASSWORD||'';
      if(!adminEmail || email!==adminEmail || saved.length<24 || !secureEqText(String(input.password||''),saved)) return json(res,401,{error:'Admin credentials are incorrect or not configured.'});
      const token=randomBytes(32).toString('base64url'); db.prepare('INSERT INTO admin_sessions(token_hash,expires_at,created_at) VALUES(?,?,?)').run(hash(token),Date.now()+8*60*60*1000,now());
      cookie(res,'asryo_admin',token,8*60*60); return json(res,200,{ok:true});
    }
    if (path.startsWith('/api/admin/')) requireAdmin(req);
    if (req.method === 'POST' && path === '/api/admin/logout') {
      const raw=cookies(req).asryo_admin; if(raw) db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(hash(raw));
      clearCookie(res,'asryo_admin'); return json(res,200,{ok:true});
    }
    if (req.method === 'GET' && path === '/api/admin/products') return json(res,200,{products:allProducts()});
    if (req.method === 'PATCH' && path.startsWith('/api/admin/products/')) {
      const id=path.slice('/api/admin/products/'.length); const p=await jsonBody(req,24*1024);
      const price = p.pricePaise === null || p.pricePaise === '' ? null : Number(p.pricePaise);
      const stock = p.stock === null || p.stock === '' ? null : Number(p.stock);
      const active=Boolean(p.active);
      if(!db.prepare('SELECT 1 FROM products WHERE id=?').get(id)) return json(res,404,{error:'Product not found.'});
      if((price!==null && (!Number.isSafeInteger(price)||price<1)) || (stock!==null && (!Number.isInteger(stock)||stock<0)) || (active && (price===null || stock===null))) return json(res,400,{error:'An active product needs a valid price and stock count.'});
      db.prepare('UPDATE products SET description=?,price_paise=?,stock=?,active=?,options_json=?,updated_at=? WHERE id=?')
        .run(String(p.description||'').slice(0,2500),price,stock,active?1:0,JSON.stringify(Array.isArray(p.options)?p.options.slice(0,30):[]),now(),id);
      return json(res,200,{product:productRow(db.prepare('SELECT * FROM products WHERE id=?').get(id))});
    }
    if (req.method === 'GET' && path === '/api/admin/orders') {
      const orders=db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').all();
      return json(res,200,{orders:orders.map(o=>({...publicOrder(o),email:JSON.parse(o.shipping_json).email,phone:JSON.parse(o.shipping_json).phone,address:JSON.parse(o.shipping_json),items:db.prepare('SELECT product_name AS name,quantity,unit_price_paise AS unitPricePaise FROM order_items WHERE order_id=?').all(o.id)}))});
    }
    if (req.method === 'PATCH' && path.startsWith('/api/admin/orders/')) {
      const id=path.slice('/api/admin/orders/'.length); const {status}=await jsonBody(req,8*1024);
      const allowed=new Set(['processing','shipped','delivered','cancelled']);
      const order=db.prepare('SELECT status,payment_status FROM orders WHERE id=?').get(id);
      if(!order) return json(res,404,{error:'Order not found.'});
      if(!allowed.has(status) || (status!=='cancelled' && order.payment_status!=='paid')) return json(res,400,{error:'This order status change is not allowed.'});
      db.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=?').run(status,now(),id);
      return json(res,200,{ok:true});
    }

    if (req.method === 'POST' && path === '/api/checkout/orders') return await checkout(req,res);
    if (req.method === 'POST' && path === '/api/razorpay/callback') {
      const input=await jsonBody(req,12*1024); const order=db.prepare('SELECT id,razorpay_order_id FROM orders WHERE id=?').get(String(input.orderId||''));
      if(!order || order.razorpay_order_id!==input.razorpay_order_id) return json(res,400,{error:'Payment order could not be verified.'});
      const expected=createHmac('sha256',process.env.RAZORPAY_KEY_SECRET||'').update(`${order.razorpay_order_id}|${String(input.razorpay_payment_id||'')}`).digest('hex');
      if(!process.env.RAZORPAY_KEY_SECRET || !secureEqHex(expected,String(input.razorpay_signature||''))) return json(res,400,{error:'Payment signature is invalid.'});
      db.prepare('UPDATE orders SET razorpay_payment_id=?,callback_verified_at=?,updated_at=? WHERE id=?').run(String(input.razorpay_payment_id),now(),now(),order.id);
      return json(res,200,{ok:true,status:'awaiting_verified_webhook'});
    }
    if (req.method === 'POST' && path === '/api/razorpay/webhook') {
      const raw=await body(req,1024*1024); const signature=req.headers['x-razorpay-signature'];
      if(!verifyWebhook(raw,String(signature||''))) return json(res,401,{error:'Webhook signature rejected.'});
      const event=JSON.parse(raw.toString('utf8')); const eventId=String(req.headers['x-razorpay-event-id']||hash(raw));
      if(db.prepare('SELECT 1 FROM webhook_events WHERE event_id=?').get(eventId)) return json(res,200,{ok:true,duplicate:true});
      const type=String(event.event||'');
      const orderEntity=event.payload?.order?.entity;
      const paymentEntity=event.payload?.payment?.entity;
      const rzpOrderId=String(orderEntity?.id||paymentEntity?.order_id||'');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO webhook_events(event_id,event_type,received_at) VALUES(?,?,?)').run(eventId,type,now());
        if(type==='order.paid' && orderEntity?.status==='paid') {
          const stored=db.prepare('SELECT id,total_paise,payment_status,created_at FROM orders WHERE razorpay_order_id=?').get(rzpOrderId);
          const amount=Number(orderEntity.amount_paid ?? orderEntity.amount);
          if(stored && stored.payment_status==='created' && amount===stored.total_paise && orderEntity.currency==='INR') {
            const stockLines=db.prepare('SELECT oi.product_id,oi.quantity,p.stock FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?').all(stored.id);
            const enough=stockLines.every(line=>line.stock>=line.quantity);
            db.prepare("UPDATE orders SET payment_status='paid',status=?,razorpay_payment_id=COALESCE(?,razorpay_payment_id),updated_at=? WHERE id=? AND payment_status='created'")
              .run(enough?'processing':'manual_review',paymentEntity?.id||null,now(),stored.id);
            if(enough) for(const item of stockLines) db.prepare('UPDATE products SET stock=stock-?,updated_at=? WHERE id=? AND stock>=?').run(item.quantity,now(),item.product_id,item.quantity);
          }
        } else if(type==='payment.failed' && paymentEntity?.order_id) {
          db.prepare("UPDATE orders SET payment_status='failed',status='payment_failed',updated_at=? WHERE razorpay_order_id=? AND payment_status='created'").run(now(),paymentEntity.order_id);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res,200,{ok:true});
    }
    if (req.method === 'GET' && path === '/api/orders/track') {
      const id=url.searchParams.get('id')||''; const token=url.searchParams.get('token')||'';
      const order=db.prepare('SELECT * FROM orders WHERE id=? AND public_token_hash=?').get(id,hash(token));
      if(!order) return json(res,404,{error:'Order not found. Check the tracking link.'});
      const items=db.prepare('SELECT product_name AS name,quantity FROM order_items WHERE order_id=?').all(id);
      return json(res,200,{order:publicOrder(order),items});
    }

    if (req.method === 'GET') {
      const filePath = path === '/' ? '/index.html' : path === '/admin' ? '/admin.html' : path;
      const safe = normalize(filePath).replace(/^([/\\]*\.\.[/\\])+/, '');
      const full = resolve(join(root,'public',safe));
      if (!full.startsWith(resolve(join(root,'public')))) return json(res,404,{error:'Not found.'});
      if (!existsSync(full)) return json(res,404,{error:'Not found.'});
      setHeaders(res,mime[extname(full)] || 'application/octet-stream');
      res.setHeader('Cache-Control', extname(full)==='.html' ? 'no-cache' : 'public, max-age=86400, stale-while-revalidate=604800');
      res.statusCode=200; return createReadStream(full).pipe(res);
    }
    return json(res,404,{error:'Not found.'});
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    const status=Number(error.status)||500;
    if(status>=500) console.error('request_failed', { path, status, type:error?.name||'Error' });
    return json(res,status,{error:status>=500?'The request could not be completed.':error.message});
  }
}

const server=createServer(handle);
server.listen(port,'0.0.0.0',()=>console.log(`ASRYO server listening on ${port}`));
