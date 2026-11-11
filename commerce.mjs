import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { skuMetadata, hasSkus, recordStockMovement } from './inventory.mjs';
import {confirmedUnitCost,couponDiscount} from './operations.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const at = () => new Date().toISOString();
const digest = value => createHash('sha256').update(String(value)).digest('hex');
const flag = value => String(value).toLowerCase() === 'true';
const text = (value, max = 2500) => String(value ?? '').trim().slice(0, max);
const emailOK = value => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const secretEqual = (a, b) => /^[a-f0-9]{64}$/i.test(String(b)) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const transitions = {
  pending_payment: ['cancelled'], confirmed: ['processing', 'cancelled'],
  processing: ['packed', 'cancelled'], packed: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'delivery_failed'], out_for_delivery: ['delivered', 'delivery_failed'],
  delivery_failed: ['shipped', 'returned'], delivered: ['return_requested'],
  return_requested: ['delivered', 'returned'], returned: [], cancelled: [],
};

export function initCommerce(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS commerce_listings (
    product_id TEXT PRIMARY KEY REFERENCES products(id), profile_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS commerce_checkouts (
    order_id TEXT PRIMARY KEY REFERENCES orders(id), key_hash TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL, access_seed TEXT NOT NULL, email TEXT NOT NULL,
    gateway_order_id TEXT UNIQUE, gateway_payment_id TEXT UNIQUE,
    gateway_state TEXT NOT NULL DEFAULT 'none', snapshot_json TEXT NOT NULL,
    released INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS commerce_events (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
    kind TEXT NOT NULL, detail_json TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS commerce_webhooks (
    event_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, event_type TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS commerce_refunds (
    order_id TEXT PRIMARY KEY REFERENCES orders(id), request_id TEXT NOT NULL UNIQUE,
    gateway_refund_id TEXT UNIQUE, state TEXT NOT NULL, amount_paise INTEGER NOT NULL,
    reason TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS commerce_shipments (
    order_id TEXT PRIMARY KEY REFERENCES orders(id), carrier TEXT NOT NULL,
    tracking_number TEXT NOT NULL, tracking_url TEXT, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS commerce_notifications (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), kind TEXT NOT NULL,
    state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
    UNIQUE(order_id,kind)
  );
  CREATE INDEX IF NOT EXISTS commerce_events_order ON commerce_events(order_id,created_at);`);
}

function audit(db, orderId, kind, detail = {}) {
  db.prepare('INSERT INTO commerce_events VALUES(?,?,?,?,?)').run(randomUUID(), orderId, kind, JSON.stringify(detail), at());
}
function queue(db, orderId, kind) {
  db.prepare("INSERT OR IGNORE INTO commerce_notifications VALUES(?,?,?,'pending',0,?)").run(randomUUID(), orderId, kind, at());
}
function listingRecord(db, productId) {
  const variant = skuMetadata(db, productId);
  return db.prepare('SELECT * FROM commerce_listings WHERE product_id=?').get(productId)
    || (variant && db.prepare('SELECT * FROM commerce_listings WHERE product_id=?').get(variant.parentProductId)) || null;
}
export function listingFor(db, productId) {
  const record = listingRecord(db, productId);
  return record ? {...JSON.parse(record.profile_json), revision:record.revision, listingId:record.product_id} : null;
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function profileProblems(profile, now = new Date()) {
  const problems = [];
  if (!profile || !profile.approved || profile.mode === 'interest') return ['Product release is not approved.'];
  if (!profile.specificationsVerified || !profile.fabric || !profile.fit || !Number.isSafeInteger(profile.gsm) || profile.gsm < 60 || profile.gsm > 1000) problems.push('Verify the production fabric, GSM and fit.');
  if (!Number.isSafeInteger(profile.gstBps) || profile.gstBps < 0 || profile.gstBps > 10000 || !profile.taxConfirmed) problems.push('Confirm the applicable GST rate and tax-inclusive price.');
  if (!profile.imagesVerified || profile.images.length < 2 || !profile.sizeGuide) problems.push('Approve front/back photographs and the measured size guide.');
  if (!Number.isSafeInteger(profile.deliveryMinDays) || !Number.isSafeInteger(profile.deliveryMaxDays) || profile.deliveryMinDays < 1 || profile.deliveryMaxDays < profile.deliveryMinDays) problems.push('Confirm a supported delivery window.');
  if(!profile.cancellationTerms || !profile.refundTerms)problems.push('Approve the product cancellation and return/refund conditions.');
  if (profile.mode === 'ready_stock' && !profile.stockVerified) problems.push('Verify physical inventory.');
  if (profile.mode === 'preorder') {
    if (!profile.manufacturingConfirmed || !Number.isSafeInteger(profile.capacity) || profile.capacity < 1) problems.push('Confirm manufacturing capacity.');
    if (!validDate(profile.dispatchDate) || profile.dispatchDate < now.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})) problems.push('Confirm a future dispatch date.');
    if (!profile.cancellationTerms || !profile.refundTerms || profile.paymentTiming!=='Full payment is collected immediately at checkout.') problems.push('Disclose immediate payment collection, cancellation and refund terms.');
  }
  return problems;
}

function safeImage(value) {
  const image = text(value, 250);
  return /^\/assets\/[a-zA-Z0-9._/-]+$/.test(image) && !image.includes('..');
}
export function saveListing(db, productId, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Enter a product release profile.');
  if (!db.prepare('SELECT 1 FROM products WHERE id=?').get(productId)) fail(404, 'Product not found.');
  const previous = db.prepare('SELECT revision FROM commerce_listings WHERE product_id=?').get(productId);
  if ((previous?.revision || 0) !== input.expectedRevision) fail(409, 'This product release changed. Refresh before saving.');
  if (!['interest', 'ready_stock', 'preorder'].includes(input.mode)) fail(400, 'Choose interest, ready stock or pre-order.');
  const images = Array.isArray(input.images) ? input.images.map(x => text(x,250)).slice(0,12) : [];
  if (images.some(x => !safeImage(x))) fail(400, 'Use approved images from the ASRYO assets directory.');
  const profile = {
    mode:input.mode, approved:input.approved === true, specificationsVerified:input.specificationsVerified === true,
    imagesVerified:input.imagesVerified === true, stockVerified:input.stockVerified === true,
    manufacturingConfirmed:input.manufacturingConfirmed === true, taxConfirmed:input.taxConfirmed === true,
    fabric:text(input.fabric,200), gsm:input.gsm ?? null, fit:text(input.fit,150), sizeGuide:text(input.sizeGuide,2500),
    images, gstBps:input.gstBps ?? null, mrpPaise:input.mrpPaise ?? null,
    deliveryMinDays:input.deliveryMinDays ?? null, deliveryMaxDays:input.deliveryMaxDays ?? null,
    dispatchDate:text(input.dispatchDate,10), capacity:input.capacity ?? null,
    paymentTiming:text(input.paymentTiming,300), cancellationTerms:text(input.cancellationTerms), refundTerms:text(input.refundTerms),
    approvalReference:text(input.approvalReference,250),
  };
  if (profile.approved && !profile.approvalReference) fail(400, 'Enter a sample/production approval reference.');
  if (profile.mrpPaise !== null && (!Number.isSafeInteger(profile.mrpPaise) || profile.mrpPaise < 1)) fail(400, 'MRP must be a positive number of paise.');
  const problems = profileProblems(profile);
  if (profile.approved && problems.length) fail(400, problems.join(' '));
  db.prepare(`INSERT INTO commerce_listings VALUES(?,?,1,?) ON CONFLICT(product_id) DO UPDATE SET
    profile_json=excluded.profile_json,revision=commerce_listings.revision+1,updated_at=excluded.updated_at`).run(productId,JSON.stringify(profile),at());
  return {profile:listingFor(db,productId)};
}

export function gatewayReadiness(env = process.env) {
  const mode = env.PAYMENTS_MODE || 'disabled';
  const configured = Boolean(env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET &&
    new RegExp(`^rzp_${mode === 'live' ? 'live' : 'test'}_[A-Za-z0-9]+$`).test(env.RAZORPAY_KEY_ID || ''));
  const enabled = ['test','live'].includes(mode) && configured && (mode !== 'live' ||
    (flag(env.LIVE_PAYMENTS_APPROVED) && flag(env.PAYMENT_PRODUCTION_VERIFIED)));
  // Sandbox keys can never accept orders from the production storefront.
  return {enabled:enabled && !(env.NODE_ENV === 'production' && mode === 'test'), mode};
}
export function storeReadiness(db, env = process.env) {
  const blockers = [];
  if (!flag(env.STORE_READY) || flag(env.HIDE_PUBLIC_PRODUCTS ?? 'true')) blockers.push('Store opening is not approved.');
  if (!text(env.PUBLIC_BUSINESS_NAME) || !emailOK(env.PUBLIC_SUPPORT_EMAIL || '') || !text(env.PUBLIC_SUPPORT_PHONE) || !text(env.PUBLIC_RETURN_ADDRESS)) blockers.push('Business, support and return details are missing.');
  if (!flag(env.FULFILMENT_APPROVED) || !flag(env.POLICIES_APPROVED)) blockers.push('Fulfilment and customer policies are not approved.');
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !env.APP_ORIGIN || !flag(env.NOTIFICATIONS_APPROVED)) blockers.push('Approved order confirmation email is not configured.');
  const gateway = gatewayReadiness(env);
  const cod = flag(env.COD_APPROVED) && flag(env.FULFILMENT_APPROVED) && /^\d{6}(,\d{6})*$/.test(env.COD_PINCODES || '');
  const prepaid = /^\d{6}(,\d{6})*$/.test(env.SERVICEABLE_PINCODES || '');
  const methods = [...(gateway.enabled && prepaid ? ['razorpay'] : []), ...(cod ? ['cash_on_delivery'] : [])];
  if (!methods.length) blockers.push('No approved, serviceable payment method is configured.');
  if (!/^\d+$/.test(env.SHIPPING_FEE_PAISE || '') || !/^\d+$/.test(env.SHIPPING_GST_BPS || '') || Number(env.SHIPPING_GST_BPS) > 10000) blockers.push('Shipping fee and GST treatment are not confirmed.');
  return {ready:blockers.length === 0, blockers, methods, paymentMode:gateway.mode};
}

export function publicCatalogue(db, env = process.env) {
  if (flag(env.HIDE_PUBLIC_PRODUCTS ?? 'true')) return [];
  const readiness = storeReadiness(db, env);
  return db.prepare('SELECT * FROM products WHERE active=1 ORDER BY name').all().flatMap(p => {
    const profile = listingFor(db,p.id);
    if (!profile?.approved || hasSkus(db,p.id)) return [];
    const problems = profileProblems(profile);
    const variant = skuMetadata(db,p.id);
    const remaining = profile.mode === 'preorder' ? preorderRemaining(db,profile) : p.stock;
    return [{id:p.id,name:p.name,type:p.type,description:p.description,pricePaise:p.price_paise,
      stock:profile.mode === 'ready_stock' ? remaining : null, remainingCapacity:profile.mode === 'preorder' ? remaining : null,
      variant:variant ? {parentProductId:variant.parentProductId,size:variant.size,colour:variant.colour,sku:variant.sku} : null,
      profile:Object.fromEntries(Object.entries(profile).filter(([k])=>k!=='approvalReference')), purchasable:readiness.ready && !problems.length && remaining > 0 && p.price_paise > 0,
      unavailableReason:problems[0] || (!readiness.ready ? 'Ordering is not open yet.' : remaining < 1 ? 'Currently unavailable.' : null)}];
  });
}
function preorderRemaining(db, profile) {
  const reserved = db.prepare('SELECT snapshot_json FROM commerce_checkouts WHERE released=0').all().reduce((sum,row) =>
    sum + JSON.parse(row.snapshot_json).items.filter(x => x.mode === 'preorder' && x.listingId === profile.listingId).reduce((n,x)=>n+x.quantity,0),0);
  return Math.max(0,(profile.capacity || 0)-reserved);
}
export function validateAddress(input) {
  const address = input?.address;
  if (!address || typeof address !== 'object' || Array.isArray(address)) fail(400,'Enter a complete delivery address.');
  const clean = {email:text(input.email,254).toLowerCase(),phone:text(input.phone,20).replace(/[\s()-]/g,''),
    name:text(address.name,100),line1:text(address.line1,250),line2:text(address.line2,250),city:text(address.city,100),region:text(address.region,100),postalCode:text(address.postalCode,6),country:'India'};
  if (!emailOK(clean.email) || !/^(?:\+91|91)?[6-9]\d{9}$/.test(clean.phone) || clean.name.length<2 || clean.line1.length<5 || clean.city.length<2 || clean.region.length<2 || !/^[1-9]\d{5}$/.test(clean.postalCode) || !['IN','India'].includes(address.country)) fail(400,'Enter a valid Indian address, six-digit PIN code and mobile number.');
  if (String(address.postalCode).trim() !== clean.postalCode) fail(400,'Enter a six-digit Indian PIN code.');
  return clean;
}
export function quote(db, input, env = process.env, includePrivateCosts = false) {
  if(!input || typeof input!=='object' || Array.isArray(input))fail(400,'Enter valid checkout details.');
  const readiness = storeReadiness(db,env);
  if (!readiness.ready) fail(503,'Ordering is not open yet. Approved products, fulfilment, support and payment configuration are required.');
  const address = validateAddress(input);
  const method = input.paymentMethod || 'cash_on_delivery';
  if (!readiness.methods.includes(method)) fail(400,'This payment method is not available.');
  const pincodes = (method === 'cash_on_delivery' ? env.COD_PINCODES : env.SERVICEABLE_PINCODES).split(',');
  if (!pincodes.includes(address.postalCode)) fail(400,'This payment method is not available for your PIN code.');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length>20) fail(400,'Add 1–20 valid items to your bag.');
  const seen = new Set(), capacity = new Map();
  const items = input.items.map(item => {
    if (!item || typeof item !== 'object' || seen.has(item.id) || !Number.isSafeInteger(item.quantity) || item.quantity<1 || item.quantity>10) fail(400,'Choose valid, unique variants and quantities.');
    seen.add(item.id);
    const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(String(item.id));
    const profile = p && listingFor(db,p.id);
    if (!p || hasSkus(db,p.id) || profileProblems(profile).length || !Number.isSafeInteger(p.price_paise) || p.price_paise<1 || (profile.mrpPaise !== null && profile.mrpPaise < p.price_paise)) fail(400,'A selected product is not approved for sale. Refresh your bag.');
    if (profile.mode === 'ready_stock' && (!Number.isSafeInteger(p.stock) || p.stock<item.quantity)) fail(400,'A selected size has sold out. Refresh your bag.');
    if (profile.mode === 'preorder') {
      if (method === 'cash_on_delivery') fail(400,'Pre-orders require the disclosed approved online payment method.');
      if (input.preorderConsent !== true) fail(400,'Please accept the pre-order dispatch, payment and cancellation disclosures.');
      const count = (capacity.get(profile.listingId)||0)+item.quantity;
      capacity.set(profile.listingId,count);
      if (count>preorderRemaining(db,profile)) fail(400,'The confirmed pre-order quantity has been reached.');
    }
    return {id:p.id,name:p.name,quantity:item.quantity,unitPricePaise:p.price_paise,gstBps:profile.gstBps,
      ...(includePrivateCosts?{unitCostPaise:confirmedUnitCost(db,p.id)}:{}),
      mode:profile.mode,listingId:profile.listingId,revision:profile.revision,variant:skuMetadata(db,p.id)?(({sku,size,colour,parentProductId})=>({sku,size,colour,parentProductId}))(skuMetadata(db,p.id)):null,
      dispatchDate:profile.dispatchDate,deliveryMinDays:profile.deliveryMinDays,deliveryMaxDays:profile.deliveryMaxDays,
      paymentTiming:profile.paymentTiming,cancellationTerms:profile.cancellationTerms,refundTerms:profile.refundTerms};
  });
  const subtotalPaise = items.reduce((n,x)=>n+x.unitPricePaise*x.quantity,0);
  const promotion=couponDiscount(db,input.couponCode,subtotalPaise);
  let remainingDiscount=promotion.discountPaise;
  items.forEach((item,index)=>{item.discountPaise=index===items.length-1?remainingDiscount:Math.floor(promotion.discountPaise*(item.unitPricePaise*item.quantity)/subtotalPaise);remainingDiscount-=item.discountPaise;});
  const shippingPaise = Number(env.SHIPPING_FEE_PAISE);
  const taxPaise = items.reduce((n,x)=>n+Math.round((x.unitPricePaise*x.quantity-x.discountPaise)*x.gstBps/(10000+x.gstBps)),0)
    + Math.round(shippingPaise*Number(env.SHIPPING_GST_BPS)/(10000+Number(env.SHIPPING_GST_BPS)));
  const totalPaise = subtotalPaise+shippingPaise-promotion.discountPaise;
  if (![shippingPaise,subtotalPaise,totalPaise,taxPaise].every(Number.isSafeInteger) || totalPaise<100 || totalPaise>100000000) fail(400,'Order total is invalid.');
  return {address,items,paymentMethod:method,subtotalPaise,shippingPaise,taxPaise,totalPaise,...promotion,currency:'INR',taxInclusive:true};
}

function trackingToken(seed, key) {return createHmac('sha256',seed).update(key).digest('base64url');}
function checkoutResponse(db, checkout, key, env) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(checkout.order_id);
  return {orderId:order.id,trackingToken:trackingToken(checkout.access_seed,order.id),amountPaise:order.total_paise,currency:'INR',paymentMethod:order.payment_method,
    status:order.status,paymentStatus:order.payment_status,gatewayOrderId:checkout.gateway_order_id,
    reservationExpiresAt:order.payment_method==='razorpay'?new Date(Date.parse(checkout.created_at)+30*60*1000).toISOString():null,
    keyId:order.payment_method === 'razorpay' ? env.RAZORPAY_KEY_ID : null};
}
async function gatewayRequest(env, path, options = {}, fetcher = fetch) {
  let response;
  try {response = await fetcher('https://api.razorpay.com/v1'+path,{
    ...options,headers:{Authorization:'Basic '+Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64'),'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(15000),
  });} catch {fail(503,'Payment provider response is uncertain. Keep your order reference and contact support; do not submit another payment.');}
  const value = await response.json().catch(()=>null);
  if (!response.ok || !value) fail(502,'The payment provider could not complete this request.');
  return value;
}
export async function createCheckout(db, input, key, customer, env = process.env, fetcher = fetch) {
  if(!storeReadiness(db,env).ready)fail(503,'Ordering is not open yet.');
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(key||'')) fail(400,'A unique checkout request key is required.');
  if(input?.termsAccepted!==true)fail(400,'Review and accept the customer terms before placing an order.');
  const requestHash = digest(JSON.stringify({input,customerId:customer?.id || null}));
  const keyHash = digest(key);
  let saved = db.prepare('SELECT * FROM commerce_checkouts WHERE key_hash=?').get(keyHash);
  if (saved) {
    if (saved.request_hash!==requestHash) fail(409,'This checkout key belongs to different details. Review your bag before starting again.');
    return {...checkoutResponse(db,saved,key,env),replayed:true,pendingReconciliation:['creating','uncertain'].includes(saved.gateway_state)};
  }
  const seed = randomBytes(32).toString('hex'), id = randomUUID();
  let result;
  db.exec('BEGIN IMMEDIATE');
  try {
    // Prices, approval revisions, physical stock and pre-order capacity are checked under the same write lock.
    result = quote(db,input,env,true);
    db.prepare(`INSERT INTO orders(id,customer_id,public_token_hash,status,payment_status,payment_method,total_paise,shipping_paise,currency,shipping_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,customer?.id || null,digest(trackingToken(seed,id)),result.paymentMethod==='razorpay'?'pending_payment':'confirmed',result.paymentMethod==='razorpay'?'pending':'due_on_delivery',result.paymentMethod,result.totalPaise,result.shippingPaise,'INR',JSON.stringify(result.address),at(),at());
    for (const item of result.items) {
      db.prepare('INSERT INTO order_items VALUES(?,?,?,?,?)').run(id,item.id,item.name,item.quantity,item.unitPricePaise);
      if (item.mode === 'ready_stock') {
        db.prepare('UPDATE products SET stock=stock-?,updated_at=? WHERE id=?').run(item.quantity,at(),item.id);
        if (skuMetadata(db,item.id)) recordStockMovement(db,{id:`order:${id}:${item.id}`,productId:item.id,delta:-item.quantity,reason:'order_reserved',reference:id});
      }
    }
    db.prepare('INSERT INTO commerce_checkouts(order_id,key_hash,request_hash,access_seed,email,gateway_state,snapshot_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id,keyHash,requestHash,seed,result.address.email,result.paymentMethod==='razorpay'?'creating':'none',JSON.stringify(result),at());
    if(result.couponCode)db.prepare('INSERT INTO ops_coupon_redemptions(order_id,code,discount_paise) VALUES(?,?,?)').run(id,result.couponCode,result.discountPaise);
    audit(db,id,'order_created',{paymentMethod:result.paymentMethod,preorderConsent:input.preorderConsent===true});
    if (result.paymentMethod==='cash_on_delivery') queue(db,id,'confirmed');
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');throw error;}
  if (result.paymentMethod === 'razorpay') {
    try {
      const gatewayOrder = await gatewayRequest(env,'/orders',{method:'POST',body:JSON.stringify({amount:result.totalPaise,currency:'INR',receipt:id,notes:{asryo_order_id:id}})},fetcher);
      if (!/^order_[A-Za-z0-9]+$/.test(gatewayOrder.id) || gatewayOrder.amount!==result.totalPaise || gatewayOrder.currency!=='INR') fail(502,'Payment setup requires reconciliation.');
      db.prepare("UPDATE commerce_checkouts SET gateway_order_id=?,gateway_state='ready' WHERE order_id=?").run(gatewayOrder.id,id);
    } catch(error) {
      // Orders API has no universal idempotency contract. Never blindly create a second remote order on retry.
      db.prepare("UPDATE commerce_checkouts SET gateway_state='uncertain' WHERE order_id=?").run(id);
      audit(db,id,'gateway_setup_uncertain');
      saved=db.prepare('SELECT * FROM commerce_checkouts WHERE order_id=?').get(id);
      return {...checkoutResponse(db,saved,key,env),replayed:false,pendingReconciliation:true};
    }
  }
  saved = db.prepare('SELECT * FROM commerce_checkouts WHERE order_id=?').get(id);
  return {...checkoutResponse(db,saved,key,env),replayed:false};
}

export async function reconcilePayment(db,orderId,gatewayOrderId,env=process.env,fetcher=fetch){
  if(!gatewayReadiness(env).enabled || !/^order_[A-Za-z0-9]+$/.test(gatewayOrderId||''))fail(400,'Enter the exact provider order ID from the approved merchant dashboard.');
  const checkout=db.prepare('SELECT * FROM commerce_checkouts WHERE order_id=?').get(orderId);
  const order=db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if(!checkout || order.payment_method!=='razorpay' || (checkout.gateway_order_id && checkout.gateway_order_id!==gatewayOrderId))fail(409,'Provider order cannot be attached to this order.');
  const remote=await gatewayRequest(env,'/orders/'+gatewayOrderId,{},fetcher);
  if(remote.id!==gatewayOrderId || remote.receipt!==orderId || remote.amount!==order.total_paise || remote.currency!=='INR')fail(409,'Provider receipt, amount or currency does not match.');
  const payments=await gatewayRequest(env,'/orders/'+gatewayOrderId+'/payments',{},fetcher);
  if(!Array.isArray(payments.items))fail(502,'Provider payments could not be reconciled.');
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare("UPDATE commerce_checkouts SET gateway_order_id=?,gateway_state='ready' WHERE order_id=?").run(gatewayOrderId,orderId);
    for(const entity of payments.items.filter(x=>x.status==='captured')){
      if(entity.order_id!==gatewayOrderId)fail(409,'Payment order mismatch.');capturedPayment(db,entity);
    }
    audit(db,orderId,'provider_reconciled');db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return {ok:true};
}

export function capturedPayment(db, entity) {
  const checkout = db.prepare('SELECT * FROM commerce_checkouts WHERE gateway_order_id=?').get(entity.order_id || '');
  if (!checkout) return false;
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(checkout.order_id);
  if (!/^pay_[A-Za-z0-9]+$/.test(entity.id||'') || entity.status!=='captured' || entity.amount!==order.total_paise || entity.currency!=='INR') fail(400,'Payment amount, currency or capture status does not match the order.');
  if (checkout.gateway_payment_id && checkout.gateway_payment_id!==entity.id) fail(409,'A second payment requires manual reconciliation.');
  if (['paid','refund_pending','refunded'].includes(order.payment_status)) return true;
  db.prepare('UPDATE commerce_checkouts SET gateway_payment_id=? WHERE order_id=?').run(entity.id,order.id);
  if (order.status==='cancelled' || checkout.released) {
    db.prepare("UPDATE orders SET payment_status='refund_required',updated_at=? WHERE id=?").run(at(),order.id);
    audit(db,order.id,'late_capture_refund_required');
  } else {
    db.prepare("UPDATE orders SET status='confirmed',payment_status='paid',updated_at=? WHERE id=?").run(at(),order.id);
    audit(db,order.id,'payment_captured',{paymentId:entity.id}); queue(db,order.id,'confirmed');
  }
  return true;
}
export async function verifyCheckoutPayment(db, input, env = process.env, fetcher = fetch) {
  const checkout = db.prepare('SELECT * FROM commerce_checkouts WHERE order_id=?').get(String(input.orderId||''));
  if (!checkout || !input.trackingToken || digest(input.trackingToken)!==db.prepare('SELECT public_token_hash FROM orders WHERE id=?').get(checkout.order_id).public_token_hash) fail(404,'Order not found.');
  if (!gatewayReadiness(env).enabled || input.razorpay_order_id!==checkout.gateway_order_id || !/^pay_[A-Za-z0-9]+$/.test(input.razorpay_payment_id||'')) fail(400,'Payment details do not match this order.');
  const expected = createHmac('sha256',env.RAZORPAY_KEY_SECRET).update(checkout.gateway_order_id+'|'+input.razorpay_payment_id).digest('hex');
  if (!secretEqual(expected,input.razorpay_signature)) fail(400,'Payment signature is invalid.');
  const entity = await gatewayRequest(env,'/payments/'+input.razorpay_payment_id,{},fetcher);
  if (entity.order_id!==checkout.gateway_order_id) fail(400,'Payment belongs to a different order.');
  db.exec('BEGIN IMMEDIATE');
  try {capturedPayment(db,entity);db.exec('COMMIT');} catch(error){db.exec('ROLLBACK');throw error;}
  return {verified:true};
}
export function processWebhook(db, raw, signature, eventId, env = process.env) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) fail(503,'Payment webhooks are not configured.');
  const expected = createHmac('sha256',env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
  if (!secretEqual(expected,signature)) fail(400,'Invalid webhook signature.');
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(eventId || '')) fail(400,'A webhook event ID is required.');
  let event;try{event=JSON.parse(raw.toString('utf8'));}catch{fail(400,'Invalid webhook payload.');}
  const payloadHash = digest(raw);
  db.exec('BEGIN IMMEDIATE');
  try {
    const duplicate = db.prepare('SELECT payload_hash FROM commerce_webhooks WHERE event_id=?').get(eventId);
    if (duplicate) {if(duplicate.payload_hash!==payloadHash)fail(409,'Webhook ID conflicts with an earlier payload.');db.exec('COMMIT');return {received:true,replayed:true};}
    const entity = event.payload?.payment?.entity;
    if (['payment.captured','order.paid'].includes(event.event) && entity) {
      if (!capturedPayment(db,entity)) fail(409,'Payment order has not been reconciled yet. Retry this event.');
    }
    if (event.event==='payment.failed' && entity) {
      const checkout=db.prepare('SELECT order_id FROM commerce_checkouts WHERE gateway_order_id=?').get(entity.order_id||'');
      if(checkout){audit(db,checkout.order_id,'payment_attempt_failed');/* Other attempts may still succeed. Never turn a paid order into a failure. */}
    }
    const refund = event.payload?.refund?.entity;
    if (['refund.processed','refund.failed'].includes(event.event) && refund) {
      let saved = db.prepare('SELECT * FROM commerce_refunds WHERE gateway_refund_id=?').get(refund.id||'');
      // A webhook can arrive before the refund HTTP response. Match the already approved request by payment.
      if(!saved && /^rfnd_[A-Za-z0-9]+$/.test(refund.id||'')){
        saved=db.prepare('SELECT r.* FROM commerce_refunds r JOIN commerce_checkouts c ON c.order_id=r.order_id WHERE c.gateway_payment_id=? AND r.gateway_refund_id IS NULL AND r.amount_paise=?').get(refund.payment_id||'',refund.amount);
        if(saved)db.prepare('UPDATE commerce_refunds SET gateway_refund_id=? WHERE order_id=?').run(refund.id,saved.order_id);
      }
      const payment = saved && db.prepare('SELECT gateway_payment_id FROM commerce_checkouts WHERE order_id=?').get(saved.order_id);
      if (saved && refund.payment_id===payment.gateway_payment_id && refund.amount===saved.amount_paise && saved.state!=='processed') {
        const state = event.event==='refund.processed'?'processed':'failed';
        db.prepare('UPDATE commerce_refunds SET state=?,updated_at=? WHERE order_id=?').run(state,at(),saved.order_id);
        db.prepare('UPDATE orders SET payment_status=?,updated_at=? WHERE id=?').run(state==='processed'?'refunded':'refund_required',at(),saved.order_id);
        audit(db,saved.order_id,'refund_'+state);
      }
    }
    db.prepare('INSERT INTO commerce_webhooks VALUES(?,?,?,?)').run(eventId,payloadHash,text(event.event,100),at());
    db.exec('COMMIT');return {received:true,replayed:false};
  } catch(error){db.exec('ROLLBACK');throw error;}
}

function releaseReservation(db, checkout) {
  if (checkout.released) return;
  for (const item of JSON.parse(checkout.snapshot_json).items) {
    if (item.mode==='ready_stock') {
      db.prepare('UPDATE products SET stock=stock+?,updated_at=? WHERE id=?').run(item.quantity,at(),item.id);
      if (skuMetadata(db,item.id)) recordStockMovement(db,{id:`cancel:${checkout.order_id}:${item.id}`,productId:item.id,delta:item.quantity,reason:'order_cancelled',reference:checkout.order_id});
    }
  }
  db.prepare('UPDATE commerce_checkouts SET released=1 WHERE order_id=?').run(checkout.order_id);
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='ops_coupon_redemptions'").get())db.prepare('UPDATE ops_coupon_redemptions SET released=1 WHERE order_id=?').run(checkout.order_id);
}
export function updateOrder(db, orderId, input, actor = 'admin') {
  const checkout = db.prepare('SELECT * FROM commerce_checkouts WHERE order_id=?').get(orderId);
  if (!checkout) return null; // Historical orders retain their existing, restricted handler.
  const status = text(input.status,30);
  db.exec('BEGIN IMMEDIATE');
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    if (!transitions[order.status]?.includes(status)) fail(400,'This order status change is not allowed.');
    if (actor==='customer' && !['cancelled','return_requested'].includes(status)) fail(403,'This action requires ASRYO staff.');
    if (['processing','packed','shipped','out_for_delivery','delivered'].includes(status) && !['paid','due_on_delivery'].includes(order.payment_status)) fail(409,'Verify the payment before fulfilment.');
    if (status==='shipped') {
      const carrier=text(input.carrier,100), number=text(input.trackingNumber,150), url=text(input.trackingUrl,500);
      if(!carrier || !number || (url && !/^https:\/\/[^\s<>]+$/.test(url))) fail(400,'Enter the actual courier and tracking number, with an HTTPS tracking link if available.');
      db.prepare('INSERT INTO commerce_shipments VALUES(?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET carrier=excluded.carrier,tracking_number=excluded.tracking_number,tracking_url=excluded.tracking_url,updated_at=excluded.updated_at').run(orderId,carrier,number,url||null,at());
    }
    let payment=order.payment_status;
    if(status==='cancelled'){
      releaseReservation(db,checkout);
      payment=['paid','refund_required'].includes(payment)?'refund_required':'cancelled';
    }
    if(status==='returned' && order.payment_method==='razorpay' && payment==='paid') payment='refund_required';
    // Returned garments require a physical QC receipt through Inventory before restocking.
    if(status==='delivered' && order.payment_method==='cash_on_delivery') payment='collected';
    db.prepare('UPDATE orders SET status=?,payment_status=?,updated_at=? WHERE id=?').run(status,payment,at(),orderId);
    audit(db,orderId,'status_changed',{from:order.status,to:status,actor});queue(db,orderId,status);
    db.exec('COMMIT');return {ok:true};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export function expirePendingOrders(db,now=new Date()){
  const cutoff=new Date(now.getTime()-30*60*1000).toISOString();
  const orders=db.prepare("SELECT c.order_id FROM commerce_checkouts c JOIN orders o ON o.id=c.order_id WHERE o.status='pending_payment' AND c.gateway_state='ready' AND c.released=0 AND c.created_at<?").all(cutoff);
  for(const row of orders)updateOrder(db,row.order_id,{status:'cancelled'},'reservation_timeout');
  return {expired:orders.length};
}
export async function refundOrder(db, orderId, reason, env = process.env, fetcher = fetch) {
  if (!gatewayReadiness(env).enabled || !flag(env.REFUNDS_APPROVED)) fail(503,'Refund execution is not enabled. Review the request in the merchant dashboard.');
  if(text(reason).length<5)fail(400,'Enter the approved refund reason.');
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  const checkout = db.prepare('SELECT * FROM commerce_checkouts WHERE order_id=?').get(orderId);
  if(!order || !checkout?.gateway_payment_id || !['cancelled','returned'].includes(order.status) || !['refund_required','refund_pending','refunded'].includes(order.payment_status)) fail(409,'Only a cancelled or returned captured payment can be refunded.');
  let refund=db.prepare('SELECT * FROM commerce_refunds WHERE order_id=?').get(orderId);
  if(refund?.state==='processed')return {state:'processed',replayed:true};
  if(!refund){db.prepare("INSERT INTO commerce_refunds VALUES(?,?,NULL,'requested',?,?,?)").run(orderId,randomUUID(),order.total_paise,text(reason,250),at());refund=db.prepare('SELECT * FROM commerce_refunds WHERE order_id=?').get(orderId);}
  const entity = await gatewayRequest(env,`/payments/${checkout.gateway_payment_id}/refund`,{method:'POST',headers:{'X-Refund-Idempotency':refund.request_id},body:JSON.stringify({amount:refund.amount_paise,notes:{asryo_order_id:orderId,reason:refund.reason}})},fetcher);
  if(!/^rfnd_[A-Za-z0-9]+$/.test(entity.id||'') || entity.payment_id!==checkout.gateway_payment_id || entity.amount!==order.total_paise)fail(502,'Refund response requires reconciliation.');
  const state=entity.status==='processed'?'processed':'pending';
  db.exec('BEGIN IMMEDIATE');
  try{db.prepare('UPDATE commerce_refunds SET gateway_refund_id=?,state=?,updated_at=? WHERE order_id=?').run(entity.id,state,at(),orderId);db.prepare('UPDATE orders SET payment_status=?,updated_at=? WHERE id=?').run(state==='processed'?'refunded':'refund_pending',at(),orderId);audit(db,orderId,'refund_'+state);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  return {state};
}
export function orderDetail(db, order) {
  const checkout = db.prepare('SELECT snapshot_json FROM commerce_checkouts WHERE order_id=?').get(order.id);
  const savedSummary=checkout?JSON.parse(checkout.snapshot_json):null;
  const summary=savedSummary?{...savedSummary,items:savedSummary.items.map(({unitCostPaise,...item})=>item)}:null;
  return {id:order.id,status:order.status,paymentStatus:order.payment_status,paymentMethod:order.payment_method,totalPaise:order.total_paise,shippingPaise:order.shipping_paise,currency:order.currency,createdAt:order.created_at,updatedAt:order.updated_at,
    summary,
    shipment:db.prepare('SELECT carrier,tracking_number AS trackingNumber,tracking_url AS trackingUrl FROM commerce_shipments WHERE order_id=?').get(order.id)||null,
    events:db.prepare("SELECT kind,detail_json AS detail,created_at AS createdAt FROM commerce_events WHERE order_id=? ORDER BY rowid").all(order.id).map(x=>({...x,detail:JSON.parse(x.detail)}))};
}

export async function deliverNotifications(db, env=process.env, fetcher=fetch) {
  if(!env.RESEND_API_KEY || !env.MAIL_FROM || !flag(env.NOTIFICATIONS_APPROVED))return {sent:0,blocked:true};
  const pending=db.prepare("SELECT * FROM commerce_notifications WHERE state='pending' AND attempts<8 ORDER BY rowid LIMIT 20").all();
  let sent=0;
  for(const note of pending){
    const order=db.prepare('SELECT * FROM orders WHERE id=?').get(note.order_id);
    const checkout=db.prepare('SELECT * FROM commerce_checkouts WHERE order_id=?').get(note.order_id);
    if(!order||!checkout)continue;
    const privateLink=`${env.APP_ORIGIN}/my-orders?id=${encodeURIComponent(order.id)}&token=${encodeURIComponent(trackingToken(checkout.access_seed,order.id))}`;
    const summary=JSON.parse(checkout.snapshot_json);
    const disclosures=summary.items.filter(x=>x.mode==='preorder').map(x=>`${x.name} — PRE-ORDER. Expected dispatch ${x.dispatchDate}. Delivery ${x.deliveryMinDays}–${x.deliveryMaxDays} days later. ${x.paymentTiming}\nCancellation: ${x.cancellationTerms}\nRefunds: ${x.refundTerms}`).join('\n');
    const message=`ASRYO order ${order.id}\nStatus update: ${note.kind.replaceAll('_',' ')}\nPayment: ${order.payment_status.replaceAll('_',' ')}\nTotal (including taxes): INR ${(order.total_paise/100).toFixed(2)}\n${disclosures}\nView and manage your order privately: ${privateLink}\nKeep this link private. Support: ${env.PUBLIC_SUPPORT_EMAIL || ''}\n`;
    db.prepare('UPDATE commerce_notifications SET attempts=attempts+1,updated_at=? WHERE id=?').run(at(),note.id);
    try{
      const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':note.id},body:JSON.stringify({from:env.MAIL_FROM,to:[checkout.email],subject:`ASRYO order ${order.id.slice(0,8).toUpperCase()} — ${note.kind.replaceAll('_',' ')}`,text:message}),signal:AbortSignal.timeout(15000)});
      if(response.ok){db.prepare("UPDATE commerce_notifications SET state='sent',updated_at=? WHERE id=?").run(at(),note.id);sent++;}
    }catch{/* Keep the durable outbox pending; never claim delivery on a failed request. */}
  }
  return {sent,pending:pending.length-sent};
}
