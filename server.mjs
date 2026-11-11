import { createServer } from 'node:http';
import { proxyFashionOS } from './fashion-proxy.mjs';
import { handleCofounder } from './cofounder.mjs';
import {initInventory,skuMetadata,hasSkus,recordStockMovement,handleInventory} from './inventory.mjs';
import { handleFinance } from './commerce-finance.mjs';
import { handleStudio, renderImportedProduct } from './fashion-studio.mjs';
import { evaluateCofounderAutomations } from './cofounder-automation.mjs';
import { verifyFashionOwnerCookie } from './fashion-owner-sso.mjs';
import { createReadStream, statSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, scrypt as scryptCallback, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import catalog from './data/catalog.json' with { type: 'json' };
import { initCommerce, storeReadiness, publicCatalogue, listingFor, saveListing, quote, createCheckout,
  gatewayReadiness, verifyCheckoutPayment, processWebhook, updateOrder, orderDetail, refundOrder,
  deliverNotifications, reconcilePayment, expirePendingOrders } from './commerce.mjs';
import {startBackups,backupState} from './backups.mjs';
import {initOperations,staffCan,handleOperations} from './operations.mjs';

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

// Existing Railway volumes predate design-preference tracking. Extend in place.
for (const [column, definition] of [['design_preference','TEXT'],['size_preference','TEXT']]) {
  if (!db.prepare('PRAGMA table_info(early_access)').all().some(row => row.name === column)) {
    db.exec(`ALTER TABLE early_access ADD COLUMN ${column} ${definition}`);
  }
}

// Keep databases created by the earlier payment preview compatible without
// mislabelling historical orders as cash-on-delivery orders.
if (!db.prepare('PRAGMA table_info(orders)').all().some(column => column.name === 'payment_method')) {
  db.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'legacy_online'");
}

initInventory(db);
initCommerce(db);
initOperations(db);

const now = () => new Date().toISOString();
const hash = value => createHash('sha256').update(value).digest('hex');
const publicBase = path => `${(process.env.APP_ORIGIN || '').replace(/\/$/, '')}${path}`;
const productRow = row => ({
  id: row.id, name: row.name, category: row.category, type: row.type,
  image: row.image.startsWith('studio:') ? `/api/products/${encodeURIComponent(row.id)}/image` : `/assets/${encodeURIComponent(row.image)}`, description: row.description,
  pricePaise: row.price_paise, stock: row.stock, active: Boolean(row.active),
  options: JSON.parse(row.options_json || '[]'),
  variant: skuMetadata(db,row.id), hasVariants: hasSkus(db,row.id),
});

for (const item of catalog) {
  // Seed missing archive entries only. Persistent business records are authoritative:
  // a deploy/restart must never reset reviewed descriptions, prices or stock.
  db.prepare(`INSERT OR IGNORE INTO products(id,name,category,type,image,description,price_paise,updated_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(item.id, item.name, item.category, item.type, item.image, item.description || '', item.pricePaise ?? null, now());
}

const mime = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8', '.svg':'image/svg+xml', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.png':'image/png', '.webp':'image/webp', '.ico':'image/x-icon', '.txt':'text/plain; charset=utf-8', '.xml':'application/xml; charset=utf-8',
};

function setHeaders(res, contentType = 'application/json; charset=utf-8') {
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  const payments = gatewayReadiness().enabled;
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: https://images.unsplash.com https://asryo-design-preview.vercel.app https://asryo-vercel-storefront.vercel.app; style-src 'self' 'unsafe-inline'; script-src 'self'"+(payments?' https://checkout.razorpay.com':'')+"; connect-src 'self' https://api.openai.com https://api.resend.com"+(payments?' https://api.razorpay.com':'')+"; frame-src 'self'"+(payments?' https://api.razorpay.com https://checkout.razorpay.com':'')+"; upgrade-insecure-requests");
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
  try { const parsed=JSON.parse(raw.toString('utf8')); if(!parsed || typeof parsed!=='object' || Array.isArray(parsed))throw new Error('Object required'); return parsed; }
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
  const secure = process.env.NODE_ENV === 'production' || String(process.env.APP_ORIGIN||'').startsWith('https://') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

function clearCookie(res, name) {
  const secure = process.env.NODE_ENV === 'production' || String(process.env.APP_ORIGIN||'').startsWith('https://') ? '; Secure' : '';
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
  const ownerSession=db.prepare('SELECT 1 FROM admin_sessions WHERE token_hash=? AND expires_at>?').get(hash(raw),Date.now());
  // Staff tokens use a separate table. A rollback to older owner-only code must never elevate staff sessions.
  const session=ownerSession?{staff_id:null}:db.prepare('SELECT s.staff_id,u.email,u.role,u.enabled FROM ops_staff_sessions s JOIN ops_staff u ON u.id=s.staff_id WHERE s.token_hash=? AND s.expires_at>?').get(hash(raw),Date.now());
  if (!session) throw Object.assign(new Error('Admin sign-in required'), { status: 401 });
  if(session.staff_id && !session.enabled)throw Object.assign(new Error('Staff access is disabled.'),{status:401});
  const actor=session.staff_id?{id:session.staff_id,email:session.email,role:session.role}:{id:null,email:process.env.ADMIN_EMAIL||'verified-owner',role:'owner'};
  const requestPath=decodeURIComponent(new URL(req.url,'http://internal').pathname);
  if(requestPath.startsWith('/api/admin/')&&!staffCan(actor.role,req.method,requestPath))throw Object.assign(new Error('Your staff role does not permit this action.'),{status:403});
  return actor;
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

function allProducts(includePrivateDrafts = true) {
  const products = db.prepare(`SELECT * FROM products ${includePrivateDrafts ? '' : "WHERE (image NOT LIKE 'studio:%' AND id NOT IN (SELECT product_id FROM inventory_skus) AND id NOT IN (SELECT parent_id FROM inventory_skus)) OR active=1"} ORDER BY category, name`).all().map(productRow);
  return includePrivateDrafts ? products : products.map(p=>({...p,variant:p.variant?{sku:p.variant.sku,size:p.variant.size,colour:p.variant.colour}:null}));
}

function publicOrder(order) {
  return { id: order.id, status: order.status, paymentStatus: order.payment_status,
    paymentMethod: order.payment_method || 'legacy_online',
    totalPaise: order.total_paise, shippingPaise: order.shipping_paise, currency: order.currency,
    createdAt: order.created_at, updatedAt: order.updated_at };
}

function authorizedOrder(req, url, input = {}) {
  const id = String(input.orderId || url.searchParams.get('id') || '');
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  const user = customerFrom(req);
  const token = String(input.trackingToken || url.searchParams.get('token') || '');
  if (!order || !(user && order.customer_id === user.id) && !(token.length >= 32 && hash(token) === order.public_token_hash))
    throw Object.assign(new Error('Order not found.'), {status:404});
  return order;
}


async function handle(req, res) {
  setHeaders(res, 'text/plain; charset=utf-8');
  let path = '';
  try {
    let url;
    try {
      url = new URL(req.url, originOf(req));
      path = decodeURIComponent(url.pathname);
      if (path.includes('\0')) throw new Error('Null byte');
    } catch {
      return json(res, 400, { error: 'Invalid request URL.' });
    }
    // HEAD follows the same read-only handlers as GET. Node omits the body.
    if (req.method === 'HEAD') req.method = 'GET';
    if (await proxyFashionOS(req, res, path, originOf(req))) return;
    if (req.method === 'GET' && path === '/healthz') return json(res, 200, { ok:true });
    // The provider webhook authenticates the exact raw body with its HMAC, not a browser Origin header.
    if (req.method === 'POST' && path === '/api/payments/webhook') {
      const result = processWebhook(db, await body(req,256*1024), req.headers['x-razorpay-signature'], req.headers['x-razorpay-event-id']);
      return json(res,200,result);
    }
    if (path.startsWith('/api/') && req.method !== 'GET') requireSameOrigin(req);
    const limits = {
      '/api/auth/login': [8, 15*60*1000], '/api/auth/register': [5, 60*60*1000],
      '/api/admin/login': [8, 15*60*1000],
      '/api/admin/fashion-login': [8, 15*60*1000], '/api/assistant': [30, 60*1000],
      '/api/checkout/orders': [10, 15*60*1000],
      '/api/checkout/quote': [60, 15*60*1000], '/api/payments/verify': [30,15*60*1000],
      '/api/storefront/orders/action': [15,15*60*1000],
      '/api/early-access': [4, 60*60*1000],
    };
    if (req.method === 'POST' && limits[path] && !rateLimit(req, res, path, ...limits[path])) return;
    if ((path.startsWith('/api/admin/designs') || path.startsWith('/api/admin/inventory')) && !['GET','HEAD'].includes(req.method)
      && !rateLimit(req,res,'studio-write',120,60*1000)) return;

    if (req.method === 'GET' && path === '/api/status') {
      const available = publicCatalogue(db).filter(p=>p.purchasable).length;
      const ready = storeReadiness(db).ready && available>0;
      return json(res, 200, { storeReady: ready, availableProducts: HIDE_PUBLIC_PRODUCTS ? 0 : available, paymentMethod: 'cash_on_delivery', assistant: Boolean(process.env.OPENAI_API_KEY), accountVerification: Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM), supportEmail: process.env.PUBLIC_SUPPORT_EMAIL || null, supportPhone: process.env.PUBLIC_SUPPORT_PHONE || null, businessName: process.env.PUBLIC_BUSINESS_NAME || 'ASRYO' });
    }
    if (req.method === 'GET' && path === '/api/storefront') {
      const readiness = storeReadiness(db);
      return json(res,200,{ready:readiness.ready,methods:readiness.methods,paymentMode:readiness.paymentMode,
        products:publicCatalogue(db),businessName:process.env.PUBLIC_BUSINESS_NAME || 'ASRYO',
        supportEmail:process.env.PUBLIC_SUPPORT_EMAIL || null,supportPhone:process.env.PUBLIC_SUPPORT_PHONE || null,
        returnAddress:process.env.PUBLIC_RETURN_ADDRESS || null,accountVerification:Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM),
        shippingFeePaise:/^\d+$/.test(process.env.SHIPPING_FEE_PAISE || '')?Number(process.env.SHIPPING_FEE_PAISE):null,
        policiesApproved:String(process.env.POLICIES_APPROVED).toLowerCase()==='true'});
    }
    if (req.method === 'POST' && path === '/api/checkout/quote') return json(res,200,quote(db,await jsonBody(req)));
    if (req.method === 'POST' && path === '/api/checkout/orders') {
      const result = await createCheckout(db,await jsonBody(req),req.headers['idempotency-key'],customerFrom(req));
      return json(res,result.pendingReconciliation?202:result.replayed?200:201,result);
    }
    if (req.method === 'POST' && path === '/api/payments/verify') return json(res,200,await verifyCheckoutPayment(db,await jsonBody(req)));
    if (req.method === 'GET' && path === '/api/storefront/orders') return json(res,200,{order:orderDetail(db,authorizedOrder(req,url))});
    if (req.method === 'POST' && path === '/api/storefront/orders/action') {
      const input=await jsonBody(req,8192), order=authorizedOrder(req,url,input);
      const result=updateOrder(db,order.id,input,'customer');
      if(!result)return json(res,409,{error:'Please contact ASRYO support about this historical order.'});
      return json(res,200,result);
    }
    if (req.method === 'GET' && path === '/api/early-access/status') {
      const emailReady=Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM && process.env.APP_ORIGIN);
      return json(res, 200, { enabled:emailReady, acceptingInterest:true, emailVerificationAvailable:emailReady, doubleOptIn:true });
    }

    if (req.method === 'POST' && path === '/api/early-access') {
      const cfgReady=Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM && process.env.APP_ORIGIN);
      const input = await jsonBody(req, 2048);
      if (!input || typeof input !== 'object' || Array.isArray(input)) return json(res,400,{error:'Invalid signup request.'});
      // Honeypot: accept silently but do not store automated submissions.
      if (String(input.website || '').trim()) return json(res,202,{message:'If eligible, your confirmation email is on its way.'});
      const email=String(input.email || '').trim().toLowerCase();
      if (email.length > 254 || !/^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/.test(email) || input.consent !== true)
        return json(res,400,{error:'Enter a valid email and agree to receive ASRYO launch updates.'});
      const designChoices=new Set(['speed-division','dream-future','shadowbound','raven','other','not-sure']);
      const sizeChoices=new Set(['S','M','L','XL','XXL','not-sure']);
      const design=String(input.design||'not-sure');
      const size=String(input.size||'not-sure');
      if (!designChoices.has(design) || !sizeChoices.has(size)) return json(res,400,{error:'Please select a valid design and size preference.'});
      const existing=db.prepare('SELECT verified_at,unsubscribed_at,last_sent_at FROM early_access WHERE email=?').get(email);
      if (existing?.verified_at && !existing.unsubscribed_at) return json(res,202,{message:'This address is already confirmed for ASRYO launch news.'});
      if (!cfgReady) {
        // Record a real, consented interest request, but never call it a verified subscriber.
        // Give the visitor a cancellation link because no delivery service exists yet.
        const cancelToken=randomBytes(32).toString('hex'),at=now();
        db.prepare(`INSERT INTO early_access(email,consent_at,verified_at,verify_token_hash,verify_expires_at,last_sent_at,unsubscribe_token_hash,unsubscribed_at,design_preference,size_preference)
          VALUES(?,?,NULL,NULL,NULL,NULL,?,NULL,?,?) ON CONFLICT(email) DO UPDATE SET
          consent_at=excluded.consent_at,verified_at=NULL,verify_token_hash=NULL,verify_expires_at=NULL,
          last_sent_at=NULL,unsubscribe_token_hash=excluded.unsubscribe_token_hash,unsubscribed_at=NULL,
          design_preference=excluded.design_preference,size_preference=excluded.size_preference`)
          .run(email,at,hash(cancelToken),design,size);
        return json(res,202,{
          pendingVerification:true,
          message:'Your ASRYO launch interest is saved, including your preferred design and size. No email updates are active yet. You are not subscribed until you verify your address when confirmations become available. Save the cancellation link below.',
          cancelUrl:'/unsubscribe.html?token='+encodeURIComponent(cancelToken)
        });
      }
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
      db.prepare(`INSERT INTO early_access(email,consent_at,verified_at,verify_token_hash,verify_expires_at,last_sent_at,unsubscribe_token_hash,unsubscribed_at,design_preference,size_preference)
        VALUES(?,?,?,?,?,?,?,NULL,?,?) ON CONFLICT(email) DO UPDATE SET
        consent_at=excluded.consent_at, verified_at=NULL, verify_token_hash=excluded.verify_token_hash,
        verify_expires_at=excluded.verify_expires_at,last_sent_at=excluded.last_sent_at,
        unsubscribe_token_hash=excluded.unsubscribe_token_hash,unsubscribed_at=NULL,
        design_preference=excluded.design_preference,size_preference=excluded.size_preference`)
        .run(email,at,null,hash(token),Date.now()+24*60*60*1000,Date.now(),hash(unsubscribeToken),design,size);
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

    if (req.method === 'GET' && path === '/api/products') return json(res, 200, { products: publicCatalogue(db).map(p=>({...p,category:'clothing',image:p.profile.images[0],active:true,options:[]})) });

    const productImage = path.match(/^\/api\/products\/([a-zA-Z0-9-]{1,100})\/image$/);
    if (req.method === 'GET' && productImage) {
      const product = db.prepare('SELECT active FROM products WHERE id=?').get(productImage[1]);
      if (!product) return json(res,404,{error:'Product image not found.'});
      if (HIDE_PUBLIC_PRODUCTS || !product.active) requireAdmin(req);
      const svg = renderImportedProduct(db,skuMetadata(db,productImage[1])?.parentProductId || productImage[1]);
      if (!svg) return json(res,404,{error:'Product image not found.'});
      res.setHeader('Content-Type','image/svg+xml; charset=utf-8');
      res.setHeader('Cache-Control','private, no-store');
      res.setHeader('Content-Security-Policy',"default-src 'none'; img-src data:; sandbox");
      res.statusCode=200; return res.end(svg);
    }

    if (req.method === 'POST' && path === '/api/assistant') {
      const { question = '' } = await jsonBody(req, 12 * 1024);
      const q = String(question).trim().slice(0, 700);
      if (!q) return json(res, 400, { error: 'Ask a question about the collection.' });
      const products = publicCatalogue(db).map(p => ({ name:p.name, category:'clothing', type:p.type, description:p.description }));
      if (!process.env.OPENAI_API_KEY) {
        const ql = q.toLowerCase();
        const groups = ['clothing','jewellery','art','home-lifestyle'];
        const selected = groups.find(g => ql.includes(g.replace('-', ' ')) || ql.includes(g.split('-')[0])) || 'clothing';
        const recs = selected==='clothing'?publicCatalogue(db).slice(0,3).map(p=>p.name):[];
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
      return json(res,200,{orders:orders.map(o=>orderDetail(db,o))});
    }

    if (req.method === 'POST' && path === '/api/admin/login') {
      const input=await jsonBody(req,12*1024); const email=String(input.email||'').trim().toLowerCase();
      const adminEmail=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase(); const saved=process.env.ADMIN_PASSWORD||'';
      const ownerLogin=adminEmail&&email===adminEmail&&saved.length>=24&&secureEqText(String(input.password||''),saved);
      const staff=ownerLogin?null:db.prepare('SELECT * FROM ops_staff WHERE email=? AND enabled=1').get(email);
      if(!ownerLogin&&(!staff||!await passwordMatches(String(input.password||''),staff.password_hash)))return json(res,401,{error:'Admin credentials are incorrect or not configured.'});
      const token=randomBytes(32).toString('base64url');
      if(staff)db.prepare('INSERT INTO ops_staff_sessions VALUES(?,?,?,?)').run(hash(token),staff.id,Date.now()+8*60*60*1000,now());
      else db.prepare('INSERT INTO admin_sessions(token_hash,expires_at,created_at) VALUES(?,?,?)').run(hash(token),Date.now()+8*60*60*1000,now());
      cookie(res,'asryo_admin',token,8*60*60); return json(res,200,{ok:true,role:staff?.role||'owner'});
    }
    // A Fashion OS owner can obtain a short-lived commerce admin session.
    // Authorization is checked by the existing Vercel Fashion OS authority.
    if (req.method === 'POST' && path === '/api/admin/fashion-login') {
      let fashionSession='';
      try { fashionSession=cookies(req).fashion_os_session||''; } catch {}
      if(!await verifyFashionOwnerCookie(fashionSession))
        return json(res,401,{error:'Sign in as the Fashion OS owner before unlocking Commerce.'});
      const token=randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO admin_sessions(token_hash,expires_at,created_at) VALUES(?,?,?)')
        .run(hash(token),Date.now()+30*60*1000,now());
      cookie(res,'asryo_admin',token,30*60);
      return json(res,200,{ok:true,expiresInMinutes:30,mode:'fashion-owner-verified'});
    }
    const actor=path.startsWith('/api/admin/')?requireAdmin(req):null;
    if(path.startsWith('/api/admin/operations')&&!['GET','HEAD'].includes(req.method)&&!rateLimit(req,res,'operations-write',120,60*1000))return;
    if(req.method==='GET'&&path==='/api/admin/me')return json(res,200,actor);
    if(path==='/api/admin/operations'||path.startsWith('/api/admin/operations/'))return await handleOperations({db,req,res,path,url,actor,json,jsonBody,passwordHash});
    if (req.method === 'GET' && path === '/api/admin/commerce') {
      return json(res,200,{readiness:storeReadiness(db),backups:backupState,products:allProducts().map(p=>({...p,profile:listingFor(db,p.id)})),
        notifications:db.prepare('SELECT state,COUNT(*) AS count FROM commerce_notifications GROUP BY state').all(),
        metrics:db.prepare("SELECT COUNT(*) AS orders,COALESCE(SUM(CASE WHEN payment_status IN ('paid','collected') THEN total_paise ELSE 0 END),0) AS receivedPaise FROM orders WHERE status<>'legacy_preview'").get(),
        customers:db.prepare('SELECT id,email,verified_at AS verifiedAt,created_at AS createdAt FROM customers ORDER BY created_at DESC LIMIT 200').all()});
    }
    if(req.method==='PUT' && path.startsWith('/api/admin/commerce/listings/')) return json(res,200,saveListing(db,path.slice('/api/admin/commerce/listings/'.length),await jsonBody(req,32*1024)));
    if(req.method==='GET' && path==='/api/admin/commerce/orders') return json(res,200,{orders:db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').all().map(o=>orderDetail(db,o))});
    if(req.method==='POST' && path==='/api/admin/commerce/notifications/retry') return json(res,200,await deliverNotifications(db));
    const refundRoute=path.match(/^\/api\/admin\/commerce\/orders\/([a-f0-9-]{36})\/refund$/);
    if(req.method==='POST' && refundRoute){const input=await jsonBody(req,8192);return json(res,200,await refundOrder(db,refundRoute[1],input.reason));}
    const reconcileRoute=path.match(/^\/api\/admin\/commerce\/orders\/([a-f0-9-]{36})\/reconcile$/);
    if(req.method==='POST' && reconcileRoute){const input=await jsonBody(req,8192);return json(res,200,await reconcilePayment(db,reconcileRoute[1],input.gatewayOrderId));}
    if (path === '/api/admin/inventory' || path.startsWith('/api/admin/inventory/')) return await handleInventory({db,req,res,path,json,jsonBody});
    if (path === '/api/admin/designs' || path.startsWith('/api/admin/designs/')) return await handleStudio({db,req,res,path,json,jsonBody});
    if (path.startsWith('/api/admin/cofounder/')) return await handleCofounder({ db, req, res, path, json, jsonBody });
    if (path.startsWith('/api/admin/finance/')) return await handleFinance({ db, req, res, path, json, jsonBody });
    if (req.method === 'POST' && path === '/api/admin/logout') {
      const raw=cookies(req).asryo_admin; if(raw) db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(hash(raw));
      if(raw)db.prepare('DELETE FROM ops_staff_sessions WHERE token_hash=?').run(hash(raw));
      clearCookie(res,'asryo_admin'); return json(res,200,{ok:true});
    }
    if (req.method === 'GET' && path === '/api/admin/early-access') {
      const count=db.prepare('SELECT COUNT(*) n FROM early_access WHERE verified_at IS NOT NULL AND unsubscribed_at IS NULL').get().n;
      const subscribers=db.prepare('SELECT email,verified_at AS verifiedAt FROM early_access WHERE verified_at IS NOT NULL AND unsubscribed_at IS NULL ORDER BY verified_at DESC LIMIT 1000').all();
      const pending=db.prepare('SELECT COUNT(*) n FROM early_access WHERE verified_at IS NULL AND unsubscribed_at IS NULL').get().n;
      const preferences=db.prepare('SELECT design_preference AS design,COUNT(*) AS count FROM early_access WHERE unsubscribed_at IS NULL AND design_preference IS NOT NULL GROUP BY design_preference ORDER BY count DESC').all();
      const sizes=db.prepare('SELECT size_preference AS size,COUNT(*) AS count FROM early_access WHERE unsubscribed_at IS NULL AND size_preference IS NOT NULL GROUP BY size_preference ORDER BY count DESC').all();
      return json(res,200,{count,subscribers,pending,preferences,sizes});
    }
    if (req.method === 'GET' && path === '/api/admin/products') return json(res,200,{products:allProducts()});
    if (req.method === 'PATCH' && path.startsWith('/api/admin/products/')) {
      const id=path.slice('/api/admin/products/'.length); const p=await jsonBody(req,24*1024);
      const price = p.pricePaise === null || p.pricePaise === '' ? null : Number(p.pricePaise);
      const stock = p.stock === null || p.stock === '' ? null : Number(p.stock);
      const active=Boolean(p.active);
      if(!db.prepare('SELECT 1 FROM products WHERE id=?').get(id)) return json(res,404,{error:'Product not found.'});
      if(active && hasSkus(db,id))return json(res,400,{error:'Publish the individual size SKUs; the parent design cannot be sold separately.'});
      const currentStock=db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock;
      if(skuMetadata(db,id) && stock!==currentStock)return json(res,409,{error:'Use Inventory to record stock changes with a reason; refresh this product first.'});
      const preorder=listingFor(db,id)?.mode==='preorder';
      if((price!==null && (!Number.isSafeInteger(price)||price<1)) || (stock!==null && (!Number.isInteger(stock)||stock<0)) || (active && (price===null || (!preorder && stock===null)))) return json(res,400,{error:'An active product needs a valid price and confirmed ready stock, or an approved pre-order release.'});
      db.prepare('UPDATE products SET description=?,price_paise=?,stock=?,active=?,options_json=?,updated_at=? WHERE id=?')
        .run(String(p.description||'').slice(0,2500),price,stock,active?1:0,JSON.stringify(Array.isArray(p.options)?p.options.slice(0,30):[]),now(),id);
      return json(res,200,{product:productRow(db.prepare('SELECT * FROM products WHERE id=?').get(id))});
    }
    if (req.method === 'GET' && path === '/api/admin/orders') {
      const orders=db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').all();
      return json(res,200,{orders:orders.map(o=>({...publicOrder(o),email:JSON.parse(o.shipping_json).email,phone:JSON.parse(o.shipping_json).phone,address:JSON.parse(o.shipping_json),items:db.prepare('SELECT product_name AS name,quantity,unit_price_paise AS unitPricePaise FROM order_items WHERE order_id=?').all(o.id)}))});
    }
    if (req.method === 'PATCH' && path.startsWith('/api/admin/orders/')) {
      const id=path.slice('/api/admin/orders/'.length); const input=await jsonBody(req,8*1024); const {status}=input;
      const managed=updateOrder(db,id,input);
      if(managed)return json(res,200,managed);
      const transitions = { processing: ['shipped','delivered','cancelled'], shipped: ['delivered'], delivered: [], cancelled: [] };
      const order=db.prepare('SELECT status,payment_status,payment_method FROM orders WHERE id=?').get(id);
      if(!order) return json(res,404,{error:'Order not found.'});
      if(!transitions[order.status]?.includes(status)) return json(res,400,{error:'This order status change is not allowed.'});
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE orders SET status=?,payment_status=?,updated_at=? WHERE id=?')
          .run(status,status==='delivered' && order.payment_method==='cash_on_delivery'?'collected':status==='cancelled'?'cancelled':order.payment_status,now(),id);
        if(status==='cancelled') {
          for (const item of db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(id)) {
            db.prepare('UPDATE products SET stock=stock+?,updated_at=? WHERE id=?').run(item.quantity,now(),item.product_id);
            if(skuMetadata(db,item.product_id))recordStockMovement(db,{id:`cancel:${id}:${item.product_id}`,productId:item.product_id,delta:item.quantity,reason:'order_cancelled',reference:id});
          }
        }
        db.exec('COMMIT');
      } catch(error) { db.exec('ROLLBACK'); throw error; }
      return json(res,200,{ok:true});
    }

    if (req.method === 'GET' && path === '/api/orders/track') {
      const id=url.searchParams.get('id')||''; const token=url.searchParams.get('token')||'';
      const order=db.prepare('SELECT * FROM orders WHERE id=? AND public_token_hash=?').get(id,hash(token));
      if(!order) return json(res,404,{error:'Order not found. Check the tracking link.'});
      const items=db.prepare('SELECT product_name AS name,quantity FROM order_items WHERE order_id=?').all(id);
      return json(res,200,{order:orderDetail(db,order),items});
    }

    if (req.method === 'GET') {
      const storePages=['/shop','/oversized-t-shirts','/hoodies','/tracksuits','/new-arrivals','/collections','/product','/size-guide','/cart','/checkout','/account','/my-orders','/wishlist','/contact','/shipping-policy','/returns','/privacy','/terms'];
      const filePath = path === '/' ? '/index.html' : path === '/admin' ? '/admin.html' : path === '/business-os' ? '/business-os.html' : path === '/costing' ? '/finance.html' : path === '/design-studio' ? '/design-studio.html' : path === '/operations-admin'?'/operations-admin.html':path === '/commerce-admin' ? '/commerce-admin.html' : storePages.includes(path) ? '/store.html' : path;
      const safe = normalize(filePath).replace(/^([/\\]*\.\.[/\\])+/, '');
      const full = resolve(join(root,'public',safe));
      const publicRoot = resolve(join(root,'public'));
      if (!full.startsWith(publicRoot + sep)) return json(res,404,{error:'Not found.'});
      let file;
      try { file = statSync(full); } catch (error) {
        if (['ENOENT','ENOTDIR'].includes(error.code)) return json(res,404,{error:'Not found.'});
        throw error;
      }
      if (!file.isFile()) return json(res,404,{error:'Not found.'});
      setHeaders(res,mime[extname(full)] || 'application/octet-stream');
      res.setHeader('Cache-Control', ['.html','.js','.css'].includes(extname(full)) ? 'no-cache' : 'public, max-age=86400, stale-while-revalidate=604800');
      if (['/admin.html','/admin.js','/inventory.js','/design-studio.html','/design-studio.js','/design-studio.css','/studio-render.js','/commerce-admin.html','/commerce-admin.js','/operations-admin.html','/operations-admin.js'].includes(filePath) || ['/account','/my-orders','/cart','/checkout','/wishlist'].includes(path)) {
        res.setHeader('Cache-Control','private, no-store');
        res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
      }
      if(filePath==='/store.html'){
        const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const titles={'/shop':'The collection','/oversized-t-shirts':'Oversized T-shirts','/hoodies':'Hoodies','/tracksuits':'Tracksuits','/new-arrivals':'New arrivals','/collections':'Collections','/size-guide':'Size guide','/cart':'Shopping bag','/checkout':'Checkout','/account':'Your account','/my-orders':'Order history','/wishlist':'Wishlist','/contact':'Contact ASRYO','/shipping-policy':'Shipping & delivery','/returns':'Returns & refunds','/privacy':'Privacy','/terms':'Terms & conditions'};
        const product=path==='/product'?publicCatalogue(db).find(p=>p.id===url.searchParams.get('id')):null;
        const pageTitle=product?.name || titles[path] || 'Product unavailable';
        const canonical='https://asryo.com'+path+(product?'?id='+encodeURIComponent(product.id):'');
        const privatePage=['/cart','/checkout','/account','/my-orders','/wishlist'].includes(path)||(path==='/product'&&!product);
        let html=readFileSync(full,'utf8').replace('<title>ASRYO | The collection</title>',`<title>ASRYO | ${escape(pageTitle)}</title>`).replace('href="https://asryo.com/shop"',`href="${escape(canonical)}"`);
        html=html.replace('</head>',`<meta property="og:title" content="ASRYO | ${escape(pageTitle)}"><meta property="og:url" content="${escape(canonical)}"><meta property="og:type" content="${product?'product':'website'}">${privatePage?'<meta name="robots" content="noindex,nofollow">':''}</head>`);
        if(product){
          const schema={'@context':'https://schema.org','@type':'Product',name:product.name,description:product.description,image:product.profile.images.map(x=>'https://asryo.com'+x),brand:{'@type':'Brand',name:'ASRYO'},sku:product.variant?.sku||product.id};
          if(product.purchasable)schema.offers={'@type':'Offer',priceCurrency:'INR',price:(product.pricePaise/100).toFixed(2),url:canonical,availability:product.profile.mode==='preorder'?'https://schema.org/PreOrder':'https://schema.org/InStock'};
          html=html.replace('</head>','<script type="application/ld+json">'+JSON.stringify(schema).replaceAll('<','\\u003c')+'</script></head>');
        }
        res.statusCode=200;return res.end(html);
      }
      res.statusCode=200;
      const stream = createReadStream(full);
      stream.on('error', () => {
        if (res.headersSent) res.destroy();
        else json(res, 500, { error: 'The resource could not be loaded.' });
      });
      return stream.pipe(res);
    }
    return json(res,404,{error:'Not found.'});
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    const status=Number(error.status)||500;
    if(status>=500) console.error('request_failed', { path, status, type:error?.name||'Error' });
    return json(res,status,{error:status>=500?'The request could not be completed.':error.message});
  }
}

// Best-effort in-process daily recommendation monitor; no external actions.
// Unique database constraints make multiple replicas idempotent.
if (process.env.NODE_ENV !== 'test' && process.env.COFOUNDER_AUTO_REVIEW !== 'false') {
  const scan=()=>{try{evaluateCofounderAutomations(db)}catch(error){
    console.error('cofounder_monitor_failed',{type:error?.name||'Error'});
  }};
  setTimeout(scan,5000).unref();
  setInterval(scan,6*60*60*1000).unref();
}
const server=createServer(handle);
server.listen(port,'0.0.0.0',()=>console.log(`ASRYO server listening on ${port}`));
if(process.env.NODE_ENV!=='test') {
  startBackups(dataDir);
  let notifying=false;
  const notify=async()=>{if(notifying)return;notifying=true;try{expirePendingOrders(db);await deliverNotifications(db);}catch{console.error('order_notification_retry_failed');}finally{notifying=false;}};
  setInterval(notify,60*1000).unref();
}

