import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, scrypt as scryptCallback, createHash, timingSafeEqual } from 'node:crypto';
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
// Keep archived products and past orders in SQLite, but publish no products until ASRYO relaunches.
const HIDE_PUBLIC_PRODUCTS = String(process.env.HIDE_PUBLIC_PRODUCTS ?? 'true').toLowerCase() !== 'false';
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
    status TEXT NOT NULL, payment_status TEXT NOT NULL, payment_method TEXT NOT NULL DEFAULT 'cash_on_delivery', total_paise INTEGER NOT NULL,
    shipping_paise INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'INR',
    shipping_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS early_access (
    email TEXT PRIMARY KEY,
    consent_at TEXT NOT NULL,
    verified_at TEXT,
    verify_token_hash TEXT,
    verify_expires_at INTEGER,
    last_sent_at INTEGER,
    unsubscribe_token_hash TEXT,
    unsubscribed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS early_access_verified ON early_access(verified_at);
  CREATE TABLE IF NOT EXISTS order_items (
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id TEXT NOT NULL,
    product_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price_paise INTEGER NOT NULL,
    PRIMARY KEY(order_id, product_id)
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS orders_customer_created ON orders(customer_id, created_at DESC);
`);

// Keep databases created by the earlier payment preview compatible without
// mislabelling historical orders as cash-on-delivery orders.
if (!db.prepare('PRAGMA table_info(orders)').all().some(column => column.name === 'payment_method')) {
  db.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'legacy_online'");
}

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
  const initialStock = item.type === 'Saree' ? 20 : null;
  db.prepare(`INSERT OR IGNORE INTO products(id,name,category,type,image,description,price_paise,updated_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(item.id, item.name, item.category, item.type, item.image, item.description || '', item.pricePaise ?? null, now());
  // Refresh catalog details and explicitly confirmed prices in persistent databases.
  // ASRYO confirmed twenty units per saree; preserve any later stock changes and sale status.
  db.prepare(`UPDATE products SET name=?,category=?,type=?,image=?,description=?,
    price_paise=COALESCE(?,price_paise),stock=COALESCE(stock,?),updated_at=? WHERE id=?`)
    .run(item.name, item.category, item.type, item.image, item.description || '',
      Number.isSafeInteger(item.pricePaise) && item.pricePaise > 0 ? item.pricePaise : null, initialStock, now(), item.id);
}

const mime = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8', '.svg':'image/svg+xml', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.png':'image/png', '.webp':'image/webp', '.ico':'image/x-icon', '.xml':'application/xml; charset=utf-8',
};

function setHeaders(res, contentType = 'application/json; charset=utf-8') {
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: https://images.unsplash.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://api.openai.com https://api.resend.com; upgrade-insecure-requests");
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
    paymentMethod: order.payment_method || 'legacy_online',
    totalPaise: order.total_paise, shippingPaise: order.shipping_paise, currency: order.currency,
    createdAt: order.created_at, updatedAt: order.updated_at };
}

async function checkout(req, res) {
  if (HIDE_PUBLIC_PRODUCTS) return json(res, 503, { error: 'The ASRYO collection is currently unavailable.' });
  const input = await jsonBody(req);
  const available = db.prepare('SELECT COUNT(*) AS n FROM products WHERE active=1 AND price_paise>0 AND stock>0').get().n;
  if (String(process.env.STORE_READY).toLowerCase() !== 'true' || available < 1) return json(res, 503, { error: 'Cash-on-delivery ordering is not open yet.' });
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
  const subtotal = items.reduce((sum, x) => sum + x.product.price_paise * x.qty, 0);
  const shipping = Math.max(0, Number(process.env.SHIPPING_FEE_PAISE || 0));
  const amount = subtotal + shipping;
  if (!Number.isSafeInteger(amount) || amount < 100) return json(res, 400, { error: 'Order total is invalid.' });
  const id = randomUUID();
  const tracking = randomBytes(32).toString('base64url');
  const customer = customerFrom(req);
  const at = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const { product, qty } of items) {
      const current = db.prepare('SELECT stock,active,price_paise FROM products WHERE id=?').get(product.id);
      if (!current?.active || current.price_paise !== product.price_paise || current.stock < qty) {
        db.exec('ROLLBACK');
        return json(res, 400, { error: 'A selected item has just sold out or changed. Refresh your cart.' });
      }
    }
    db.prepare(`INSERT INTO orders(id,customer_id,public_token_hash,status,payment_status,payment_method,total_paise,shipping_paise,shipping_json,created_at,updated_at)
      VALUES(?,?,?,'processing','due_on_delivery','cash_on_delivery',?, ?, ?, ?, ?)`)
      .run(id, customer?.id || null, hash(tracking), amount, shipping, JSON.stringify({ ...address, email, phone }), at, at);
    const insertLine = db.prepare('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price_paise) VALUES(?,?,?,?,?)');
    for (const x of items) {
      insertLine.run(id, x.product.id, x.product.name, x.qty, x.product.price_paise);
      db.prepare('UPDATE products SET stock=stock-?,updated_at=? WHERE id=?').run(x.qty, now(), x.product.id);
    }
    db.exec('COMMIT');
    return json(res, 201, { orderId: id, trackingToken: tracking, amountPaise: amount, currency: 'INR', paymentMethod: 'cash_on_delivery' });
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

async function handle(req, res) {
  setHeaders(res, 'text/plain; charset=utf-8');
  const url = new URL(req.url, originOf(req));
  const path = decodeURIComponent(url.pathname);
  try {
    if (req.method === 'GET' && path === '/healthz') return json(res, 200, { ok:true });
    if (path.startsWith('/api/') && req.method !== 'GET') requireSameOrigin(req);
    const limits = {
      '/api/auth/login': [8, 15*60*1000], '/api/auth/register': [5, 60*60*1000],
      '/api/admin/login': [8, 15*60*1000], '/api/assistant': [30, 60*1000],
      '/api/checkout/orders': [10, 15*60*1000],
      '/api/early-access': [4, 60*60*1000],
    };
    if (req.method === 'POST' && limits[path] && !rateLimit(req, res, path, ...limits[path])) return;

    if (req.method === 'GET' && path === '/api/status') {
      const available = db.prepare('SELECT COUNT(*) AS n FROM products WHERE active=1 AND price_paise>0 AND stock>0').get().n;
      const ready = !HIDE_PUBLIC_PRODUCTS && String(process.env.STORE_READY).toLowerCase() === 'true' && available > 0;
      return json(res, 200, { storeReady: ready, availableProducts: HIDE_PUBLIC_PRODUCTS ? 0 : available, paymentMethod: 'cash_on_delivery', assistant: Boolean(process.env.OPENAI_API_KEY), accountVerification: Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM), supportEmail: process.env.PUBLIC_SUPPORT_EMAIL || null, supportPhone: process.env.PUBLIC_SUPPORT_PHONE || null, businessName: process.env.PUBLIC_BUSINESS_NAME || 'ASRYO' });
    }
    if (req.method === 'GET' && path === '/api/early-access/status')
      return json(res, 200, { enabled: Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM && process.env.APP_ORIGIN), doubleOptIn:true });

    if (req.method === 'POST' && path === '/api/early-access') {
      const cfgReady=Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM && process.env.APP_ORIGIN);
      if (!cfgReady) return json(res, 503, { error:'Early-access email confirmation is not available yet. Please check back soon.' });
      const input = await jsonBody(req, 2048);
      if (!input || typeof input !== 'object' || Array.isArray(input)) return json(res,400,{error:'Invalid signup request.'});
      // Honeypot: accept silently but do not store automated submissions.
      if (String(input.website || '').trim()) return json(res,202,{message:'If eligible, your confirmation email is on its way.'});
      const email=String(input.email || '').trim().toLowerCase();
      if (email.length > 254 || !/^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/.test(email) || input.consent !== true)
        return json(res,400,{error:'Enter a valid email and agree to receive ASRYO launch updates.'});
      const existing=db.prepare('SELECT verified_at,unsubscribed_at,last_sent_at FROM early_access WHERE email=?').get(email);
      if (existing?.verified_at && !existing.unsubscribed_at) return json(res,202,{message:'If eligible, your confirmation email is on its way.'});
      if (existing?.last_sent_at && Date.now()-existing.last_sent_at < 60*60*1000)
        return json(res,202,{message:'If eligible, your confirmation email is on its way.'});
      const token=randomBytes(32).toString('hex');
      const unsubscribeToken=randomBytes(32).toString('hex');
      const href=publicBase('/api/early-access/verify?token='+encodeURIComponent(token));
      const unsub=publicBase('/unsubscribe.html?token='+encodeURIComponent(unsubscribeToken));
      const result=await fetch('https://api.resend.com/emails',{
        method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({from:process.env.MAIL_FROM,to:[email],subject:'Confirm your ASRYO Drop 001 early access',html:'<p>You asked to hear about the ASRYO Drop 001 release.</p><p><a href="'+href+'">Confirm my email</a></p><p>This link expires in 24 hours. If you did not request this, ignore this email.</p><p>You can <a href="'+unsub+'">unsubscribe</a> at any time.</p>'})
      }).catch(()=>null);
      if(!result?.ok) return json(res,503,{error:'Confirmation email could not be sent. Please try later.'});
      const at=now();
      db.prepare(`INSERT INTO early_access(email,consent_at,verified_at,verify_token_hash,verify_expires_at,last_sent_at,unsubscribe_token_hash,unsubscribed_at)
        VALUES(?,?,?,?,?,?,?,NULL) ON CONFLICT(email) DO UPDATE SET
        consent_at=excluded.consent_at, verified_at=NULL, verify_token_hash=excluded.verify_token_hash,
        verify_expires_at=excluded.verify_expires_at,last_sent_at=excluded.last_sent_at,
        unsubscribe_token_hash=excluded.unsubscribe_token_hash,unsubscribed_at=NULL`)
        .run(email,at,null,hash(token),Date.now()+24*60*60*1000,Date.now(),hash(unsubscribeToken));
      return json(res,202,{message:'Check your inbox and confirm your email to join the early-access list.'});
    }
    if (req.method === 'GET' && path === '/api/early-access/verify') {
      const token=url.searchParams.get('token')||'';
      if (!/^[a-f0-9]{64}$/.test(token)) return json(res,400,{error:'Invalid or expired confirmation link.'});
      const item=db.prepare('SELECT email FROM early_access WHERE verify_token_hash=? AND verify_expires_at>? AND unsubscribed_at IS NULL').get(hash(token),Date.now());
      if(!item) return json(res,400,{error:'Invalid or expired confirmation link.'});
      db.prepare('UPDATE early_access SET verified_at=?,verify_token_hash=NULL,verify_expires_at=NULL WHERE email=?').run(now(),item.email);
      res.statusCode=303;res.setHeader('Location','/early-access-confirmed.html');return res.end();
    }
    if (req.method === 'POST' && path === '/api/early-access/unsubscribe') {
      const input=await jsonBody(req,1024);
      const token=String(input?.token||'');
      if(!/^[a-f0-9]{64}$/.test(token)) return json(res,400,{error:'Invalid unsubscribe link.'});
      db.prepare('UPDATE early_access SET unsubscribed_at=?,verified_at=NULL,verify_token_hash=NULL,verify_expires_at=NULL WHERE unsubscribe_token_hash=?').run(now(),hash(token));
      return json(res,200,{message:'You have been unsubscribed from ASRYO launch updates.'});
    }

    if (req.method === 'GET' && path === '/api/products') return json(res, 200, { products: HIDE_PUBLIC_PRODUCTS ? [] : allProducts() });

    if (req.method === 'POST' && path === '/api/assistant') {
      const { question = '' } = await jsonBody(req, 12 * 1024);
      const q = String(question).trim().slice(0, 700);
      if (!q) return json(res, 400, { error: 'Ask a question about the collection.' });
      const products = HIDE_PUBLIC_PRODUCTS ? [] : allProducts().filter(p => p.active).map(p => ({ name:p.name, category:p.category, type:p.type, description:p.description }));
      if (!process.env.OPENAI_API_KEY) {
        const ql = q.toLowerCase();
        const groups = ['clothing','jewellery','art','home-lifestyle'];
        const selected = groups.find(g => ql.includes(g.replace('-', ' ')) || ql.includes(g.split('-')[0])) || 'clothing';
        const recs = HIDE_PUBLIC_PRODUCTS ? [] : allProducts().filter(p => p.category === selected).slice(0, 3).map(p => p.name);
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
      const orders = db.prepare('SELECT id,status,payment_status,payment_method,total_paise,shipping_paise,currency,created_at,updated_at FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 100').all(user.id);
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
    if (req.method === 'GET' && path === '/api/admin/early-access') {
      const count=db.prepare('SELECT COUNT(*) n FROM early_access WHERE verified_at IS NOT NULL AND unsubscribed_at IS NULL').get().n;
      const subscribers=db.prepare('SELECT email,verified_at AS verifiedAt FROM early_access WHERE verified_at IS NOT NULL AND unsubscribed_at IS NULL ORDER BY verified_at DESC LIMIT 1000').all();
      return json(res,200,{count,subscribers});
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
      const order=db.prepare('SELECT status,payment_status,payment_method FROM orders WHERE id=?').get(id);
      if(!order) return json(res,404,{error:'Order not found.'});
      if(!allowed.has(status) || order.status==='cancelled' || (status==='cancelled' && order.status!=='processing')) return json(res,400,{error:'This order status change is not allowed.'});
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE orders SET status=?,payment_status=?,updated_at=? WHERE id=?')
          .run(status,status==='delivered' && order.payment_method==='cash_on_delivery'?'collected':status==='cancelled'?'cancelled':order.payment_status,now(),id);
        if(status==='cancelled') {
          for (const item of db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(id)) {
            db.prepare('UPDATE products SET stock=stock+?,updated_at=? WHERE id=?').run(item.quantity,now(),item.product_id);
          }
        }
        db.exec('COMMIT');
      } catch(error) { db.exec('ROLLBACK'); throw error; }
      return json(res,200,{ok:true});
    }

    if (req.method === 'POST' && path === '/api/checkout/orders') return await checkout(req,res);
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
      res.setHeader('Cache-Control', ['.html','.js','.css'].includes(extname(full)) ? 'no-cache' : 'public, max-age=86400, stale-while-revalidate=604800');
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

