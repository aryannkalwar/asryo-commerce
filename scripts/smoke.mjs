import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import sourceCatalog from '../data/catalog.json' with { type: 'json' };

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
      STORE_READY: String(storeReady), APP_ORIGIN: base, HIDE_PUBLIC_PRODUCTS: 'false',
      RESEND_API_KEY: '', MAIL_FROM: '',
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
  for (const path of ['/', '/healthz', '/api/status', '/editorial.css']) {
    const head = await fetch(base + path, {method:'HEAD'});
    assert.equal(head.status,200,`HEAD ${path} matches GET`);
    assert.equal(await head.text(),'','HEAD responses have no body');
  }
  for (const path of ['/%ZZ', '/%00']) {
    assert.equal((await fetch(base + path)).status,400,'malformed URL rejected');
    assert.equal((await fetch(base + '/healthz')).status,200,'bad URL does not stop server');
  }
  for (const path of ['/assets', '/assets/', '/..%2fserver.mjs', '/..%2fpublic-other/file.txt']) {
    assert.equal((await fetch(base + path)).status,404,'directory and traversal requests rejected');
    assert.equal((await fetch(base + '/healthz')).status,200,'static miss does not stop server');
  }
  const unifiedHub=await fetch(base+'/business-os');
  assert.equal(unifiedHub.status,200,'consolidated business workspace loads');
  const hubMarkup=await unifiedHub.text();
  assert.match(hubMarkup,/One command centre/,'unified hub identifies ASRYO workspace');
  assert.match(hubMarkup,/\/cofounder\.html/,'hub links AI Cofounder');
  assert.match(hubMarkup,/\/manufacturing/,'hub links Fashion OS production');
  assert.equal((await fetch(base+'/business-os.js')).status,200,'hub JavaScript is served');
  assert.equal((await fetch(base+'/cofounder.html')).status,200,'private Cofounder shell loads');
  assert.equal((await fetch(base+'/costing')).status,200,'product-costing route loads');
  assert.equal((await fetch(base+'/finance.js')).status,200,'finance calculator assets load');
  const privateDesigns=await fetch(base+'/api/admin/designs');
  assert.equal(privateDesigns.status,401,'saved designs require admin session');
  const studioShell=await fetch(base+'/design-studio');
  assert.equal(studioShell.status,200,'design studio shell loads');
  assert.match(studioShell.headers.get('cache-control'),/private, no-store/,'studio shell is never cached');
  const privateFinance=await fetch(base+'/api/admin/finance/products');
  assert.equal(privateFinance.status,401,'anonymous visitors cannot read product cost profiles');

  const secretMetrics=await fetch(base+'/api/admin/cofounder/overview');
  assert.equal(secretMetrics.status,401,'Cofounder business records require admin session');
  const anonymousBridge=await fetch(base+'/api/admin/fashion-login',{
    method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'
  });
  assert.equal(anonymousBridge.status,401,'Fashion OS bridge rejects unauthenticated users');
  const noOriginBridge=await fetch(base+'/api/admin/fashion-login',{
    method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
  });
  assert.equal(noOriginBridge.status,403,'Fashion OS bridge requires same-origin writes');



  const [health, status, catalog, adminPage, trackPage] = await Promise.all([
    fetch(`${base}/healthz`), fetch(`${base}/api/status`), fetch(`${base}/api/products`),
    fetch(`${base}/admin`), fetch(`${base}/track.html`),
  ]);
  assert.deepEqual(await health.json(), { ok: true });
  const readiness = await status.json();
  assert.equal(readiness.storeReady, false, 'store is closed by default');
  assert.equal(readiness.paymentMethod, 'cash_on_delivery', 'COD is the only configured payment method');
  const products = (await catalog.json()).products;
  assert.equal(products.length, sourceCatalog.length, 'all ASRYO preview products load');
  assert.equal(products.filter(p => p.type === 'Saree').length, 18, 'all source-listed sarees are in the catalog');
  assert(products.every(p => !p.active), 'preview items remain unavailable for purchase');
  assert.equal(adminPage.status, 200, 'admin page loads');
  assert.equal(trackPage.status, 200, 'tracking page loads');
  for (const path of ['/editorial.css','/editorial.js','/speed-division.html','/dream-future.html','/unsubscribe.html','/early-access-confirmed.html','/product.css','/product-page.js','/speed.css']){
    const resource=await fetch(base+path);
    assert.equal(resource.status,200,path+' is served');
  }
  const speedPage=await (await fetch(base+'/speed-division.html')).text();
  assert.match(speedPage,/Size guide/);
  assert.match(speedPage,/DESIGN PREVIEW \/ NOT FOR SALE/);
  assert.match(speedPage,/asryo-speed-division-back.webp/);
  const homePage=await (await fetch(base+'/')).text();
  assert.match(homePage,/href="\/speed-division.html"/);
  assert.match(homePage,/href="\/dream-future.html"/);
  assert.match(homePage,/id="faq"/);
  assert.match(homePage,/THREE IDEAS\./,'curated sample concepts are shown');
  assert.match(homePage,/name="design"/,'launch interest includes favorite original design');
  assert.match(homePage,/name="size"/,'launch interest includes non-binding size preference');
  assert.match(homePage,/BEYOND<br><em>ORDINARY\.<\/em>/,'hero introduces ASRYO master brand');
  assert.match(homePage,/id="editorialMenuButton"/,'mobile navigation is available');
  assert.match(homePage,/id="editorialNav"/,'mobile navigation is labelled');
  assert.match(homePage,/id="headerActions" hidden/,'account and bag controls start hidden while checkout is closed');
  assert.match(homePage,/id="heroAvailability"/);
  assert.match(homePage,/href="\/design-archive.html"/,'full extended archive remains accessible');
  assert.equal((homePage.match(/class="editorial-product"/g)||[]).length,3,'homepage features precisely three launch concepts');
  assert((homePage.match(/<img /g)||[]).length<15,'editorial homepage avoids shipping the old 48-image catalog');
  assert.doesNotMatch(homePage,/href="\/workspace"/,'internal business links are removed from public brand homepage');
  assert.doesNotMatch(homePage,/<nav aria-label="Main navigation">[^<]*<a href="\/workspace"/,'private operations are not the primary shopping navigation');
  const earlyStatus=await (await fetch(base+'/api/early-access/status')).json();
  assert.equal(earlyStatus.enabled,false,'verified email newsletter remains gated without verified sender');
  assert.equal(earlyStatus.acceptingInterest,true,'genuine prelaunch interest requests are accepted');
  assert.equal(earlyStatus.emailVerificationAvailable,false,'no fake email delivery is implied');
  const noMail=await fetch(base+'/api/early-access',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'buyer@example.test',consent:true,design:'speed-division',size:'L'})});
  assert.equal(noMail.status,202,'consented research interest is stored without email delivery');
  const interest=await noMail.json();
  assert.equal(interest.pendingVerification,true,'research contact is not a verified subscriber');
  assert.match(interest.cancelUrl,/^\/unsubscribe\.html\?token=[a-f0-9]{64}$/,'visitor receives private cancellation link');
  const testDb=new DatabaseSync(join(dataDir,'asryo.sqlite'));
  const pendingInterest=testDb.prepare("SELECT verified_at,design_preference,size_preference FROM early_access WHERE email=?").get('buyer@example.test');
  assert.equal(pendingInterest.verified_at,null,'consented email is still unverified');
  assert.equal(pendingInterest.design_preference,'speed-division');
  assert.equal(pendingInterest.size_preference,'L');
  testDb.close();
  const cancelToken=new URL(interest.cancelUrl,base).searchParams.get('token');
  const withdraw=await fetch(base+'/api/early-access/unsubscribe',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token:cancelToken})});
  assert.equal(withdraw.status,200,'pending research request can be withdrawn securely');
  const unauthorizedWaitlist=await fetch(base+'/api/admin/early-access');
  assert.equal(unauthorizedWaitlist.status,401,'early-access contact list is admin-only');
  const unsubWrongOrigin=await fetch(base+'/api/early-access/unsubscribe',{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json'},body:'{}'});
  assert.equal(unsubWrongOrigin.status,403,'early access unsubscribe rejects cross-origin writes');

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
  db.prepare("UPDATE products SET price_paise=200,stock=5,active=1,description='Owner reviewed sample description' WHERE id=?").run(product.id);
  db.close();
  await startServer(true);

  const reopened = new DatabaseSync(join(dataDir, 'asryo.sqlite'), {readOnly:true});
  const preserved = reopened.prepare('SELECT price_paise,stock,description FROM products WHERE id=?').get(product.id);
  assert.equal(preserved.price_paise, 200, 'restart preserves owner price');
  assert.equal(preserved.stock, 5, 'restart preserves real inventory');
  assert.equal(preserved.description, 'Owner reviewed sample description', 'restart preserves owner copy');
  reopened.close();

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
  const studioHeaders={Origin:base,Cookie:cookie,'Content-Type':'application/json'};
  const studioLayer=()=>({text:'ASRYO TEST',ink:'#d4c4a8',artwork:'',x:300,y:290,width:160,rotation:0});
  const studioInput={name:'Smoke design',design:{garment:'hoodie',color:'#222222',fabric:'',gsm:null,printMethod:'',notes:'Test sample only',measurements:{chest:null,length:null,printWidth:null},sides:{front:studioLayer(),back:studioLayer()}}};
  const studioCrossOrigin=await fetch(base+'/api/admin/designs',{method:'POST',headers:{...studioHeaders,Origin:'https://attacker.example'},body:JSON.stringify(studioInput)});
  assert.equal(studioCrossOrigin.status,403,'studio writes reject cross-site requests');
  const newStudio=await fetch(base+'/api/admin/designs',{method:'POST',headers:studioHeaders,body:JSON.stringify(studioInput)});
  assert.equal(newStudio.status,201,'authenticated owner creates a design');
  let studioProject=(await newStudio.json()).project;
  const studioId=studioProject.id;
  for(const action of ['review','approve']){
    const response=await fetch(base+'/api/admin/designs/'+studioId+'/'+action,{method:'POST',headers:studioHeaders,body:JSON.stringify({revision:studioProject.revision})});
    assert.equal(response.status,200,'studio '+action+' succeeds');studioProject=(await response.json()).project;
  }
  const importStudio=()=>fetch(base+'/api/admin/designs/'+studioId+'/draft-sku',{method:'POST',headers:studioHeaders,body:JSON.stringify({revision:studioProject.revision})});
  const firstImport=await (await importStudio()).json();assert.equal(firstImport.created,true);
  const retryImport=await (await importStudio()).json();assert.equal(retryImport.created,false);assert.equal(firstImport.productId,retryImport.productId);
  const importedRow=openDb.prepare('SELECT active,price_paise,stock FROM products WHERE id=?').get(firstImport.productId);
  assert.equal(importedRow.active,0);assert.equal(importedRow.price_paise,null);assert.equal(importedRow.stock,null);
  const publicAfterImport=await (await fetch(base+'/api/products')).json();
  assert(!publicAfterImport.products.some(p=>p.id===firstImport.productId),'unpublished Studio drafts never appear in the public catalogue');
  const designImage=base+'/api/products/'+firstImport.productId+'/image';
  assert.equal((await fetch(designImage)).status,401,'unpublished artwork is private');
  const privateImage=await fetch(designImage,{headers:{Cookie:cookie}});assert.equal(privateImage.status,200);assert.match(await privateImage.text(),/ASRYO TEST/);
  const pack=await fetch(base+'/api/admin/designs/'+studioId+'/techpack',{headers:{Cookie:cookie}});assert.equal(pack.status,200);assert.equal((await pack.json()).project.revision,studioProject.revision);
  const privateExport=await fetch(base+'/api/admin/designs/'+studioId+'/front.svg');assert.equal(privateExport.status,401,'SVG export requires admin');
  const authenticatedMetrics=await fetch(base+'/api/admin/cofounder/overview',{headers:{Cookie:cookie}});
  assert.equal(authenticatedMetrics.status,200,'authenticated admin can read Cofounder metrics');
  const metricsData=await authenticatedMetrics.json();
  assert.equal(typeof metricsData.metrics.totalOrders,'number','Cofounder returns actual order count');
  const finance=await fetch(base+'/api/admin/finance/products',{headers:{Cookie:cookie}});
  assert.equal(finance.status,200,'admin can read costing profile records');
  const financeProducts=(await finance.json()).products;
  assert(Array.isArray(financeProducts)&&financeProducts.length>0,'finance profile catalog loads');
  const financeTarget=financeProducts.find(p=>p.id===product.id);
  assert(financeTarget,'purchased product appears in costing studio');
  const proposed={fabric:20000,printing:7000,packaging:1500,inbound:900,shipping:6000,platform:0,payment:0,marketing:1000,returnHandling:3000,gstBps:500,returnBps:1000};
  const saveCost=await fetch(base+'/api/admin/finance/products/'+encodeURIComponent(product.id),{
    method:'PUT',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(proposed)
  });
  assert.equal(saveCost.status,200,'approved admin can save a cost scenario');
  const persistedCost=await fetch(base+'/api/admin/finance/products',{headers:{Cookie:cookie}});
  assert.equal((await persistedCost.json()).products.find(p=>p.id===product.id).profile.fabric,20000,'costs persist in private SQLite');

  const reviewedAnalysis=await fetch(base+'/api/admin/cofounder/automations/evaluate',{
    method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:'{}'
  });
  assert.equal(reviewedAnalysis.status,200,'admin can run manual read-only business analysis');
  const analysisData=await reviewedAnalysis.json();
  assert(analysisData.events.length>0,'the review engine creates recommendations');
  const analysisRetry=await fetch(base+'/api/admin/cofounder/automations/evaluate',{
    method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:'{}'
  });
  assert.equal(analysisRetry.status,200);
  assert.equal((await analysisRetry.json()).newRecommendations,0,'repeated analysis does not create duplicate recommendations');

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
  const nextOrder = await (await createOrder()).json();
  const updateStatus = status => fetch(`${base}/api/admin/orders/${nextOrder.orderId}`, {
    method:'PATCH', headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},
    body:JSON.stringify({status})
  });
  assert.equal((await updateStatus('shipped')).status,200,'processing order ships');
  assert.equal((await updateStatus('processing')).status,400,'shipped order cannot be reset');
  assert.equal((await updateStatus('cancelled')).status,400,'shipped order cannot restock through cancellation');
  assert.equal((await updateStatus('delivered')).status,200,'shipped order is delivered');
  for (const status of ['processing','shipped','cancelled','delivered']) {
    assert.equal((await updateStatus(status)).status,400,'delivered order is final');
  }
  const delivered = openDb.prepare('SELECT status,payment_status FROM orders WHERE id=?').get(nextOrder.orderId);
  assert.equal(delivered.payment_status,'collected','delivery records cash collection');
  assert.equal(openDb.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock,3,'rejected transitions do not restock');
  assert.equal((await fetch(base+'/api/admin/inventory')).status,401,'inventory is private');
  const createSize=async(size)=>{
    const response=await fetch(base+'/api/admin/inventory/skus',{method:'POST',headers:studioHeaders,body:JSON.stringify({parentProductId:firstImport.productId,sku:'SMOKE-'+size,size,colour:'BLACK',reorderPoint:2})});
    assert.equal(response.status,201);return (await response.json()).productId;
  };
  const mediumId=await createSize('M'),largeId=await createSize('L');
  const inventoryHeaders=studioHeaders;
  const skuMutation={productId:mediumId,expectedStock:null,delta:3,reason:'receipt',note:'Synthetic sample receipt',requestId:crypto.randomUUID()};
  const adjust=body=>fetch(base+'/api/admin/inventory/stock',{method:'POST',headers:inventoryHeaders,body:JSON.stringify(body)});
  assert.equal((await adjust(skuMutation)).status,200);
  assert.equal((await (await adjust(skuMutation)).json()).replayed,true,'stock receipt retry is idempotent');
  assert.equal((await adjust({...skuMutation,requestId:crypto.randomUUID()})).status,409,'stale stock rejected');
  assert.equal((await adjust({...skuMutation,productId:largeId,delta:5,requestId:crypto.randomUUID()})).status,200);
  const publish=async(id,stock,pricePaise)=>fetch(base+'/api/admin/products/'+id,{method:'PATCH',headers:studioHeaders,body:JSON.stringify({stock,pricePaise,active:true,description:'Synthetic SKU'})});
  assert.equal((await publish(firstImport.productId,0,200)).status,400,'parent with size SKUs cannot publish');
  assert.equal((await publish(mediumId,99,200)).status,409,'generic product edit cannot bypass stock ledger');
  assert.equal((await publish(mediumId,3,200)).status,200);
  assert.equal((await publish(largeId,5,300)).status,200);
  const publicSizes=(await (await fetch(base+'/api/products')).json()).products;
  assert(!publicSizes.some(p=>p.id===firstImport.productId),'parent design stays private');
  assert.equal(publicSizes.find(p=>p.id===mediumId).variant.size,'M');
  assert.equal(publicSizes.find(p=>p.id===mediumId).variant.reorderPoint,undefined,'private reorder threshold is not public');
  assert.equal((await fetch(base+'/api/products/'+mediumId+'/image',{headers:{Cookie:cookie}})).status,200,'SKU uses approved parent artwork');
  const sizeCheckout=items=>fetch(base+'/api/checkout/orders',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({...payload,items})});
  const sizeOrderResponse=await sizeCheckout([{id:mediumId,quantity:2},{id:largeId,quantity:1}]);
  assert.equal(sizeOrderResponse.status,201,'multiple sizes of one design can be purchased together');
  const sizeOrder=await sizeOrderResponse.json();assert.equal(sizeOrder.amountPaise,700);
  assert.equal(openDb.prepare('SELECT stock FROM products WHERE id=?').get(mediumId).stock,1);
  assert.equal(openDb.prepare('SELECT stock FROM products WHERE id=?').get(largeId).stock,4);
  assert.equal((await sizeCheckout([{id:mediumId,quantity:2}])).status,400,'size stock cannot borrow from another size');
  const sizeCancel=()=>fetch(base+'/api/admin/orders/'+sizeOrder.orderId,{method:'PATCH',headers:studioHeaders,body:JSON.stringify({status:'cancelled'})});
  assert.equal((await sizeCancel()).status,200);assert.equal((await sizeCancel()).status,400);
  assert.equal(openDb.prepare('SELECT stock FROM products WHERE id=?').get(mediumId).stock,3);
  assert.equal(openDb.prepare('SELECT stock FROM products WHERE id=?').get(largeId).stock,5);
  assert.equal(openDb.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE reason='order_reserved'").get().n,2);
  assert.equal(openDb.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE reason='order_cancelled'").get().n,2);
  openDb.close();
  openDb = null;

  const assistant = await fetch(`${base}/api/assistant`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'What can I browse?' }),
  });
  assert.equal(assistant.status, 200, 'preview shopping assistant works without an AI key');
  assert.equal((await assistant.json()).mode, 'preview');
  await stopServer();await startServer(true);
  const restoredStudio=await fetch(base+'/api/admin/designs/'+studioId,{headers:{Cookie:cookie}});
  assert.equal(restoredStudio.status,200,'saved project persists across process restart');
  assert.equal((await restoredStudio.json()).project.status,'approved');
  const restoredImport=await (await importStudio()).json();assert.equal(restoredImport.productId,firstImport.productId,'product linkage persists across restart');
  console.log('ASRYO checks passed: closed-by-default readiness, storefront, catalog, security headers, origin checks, admin protection, disabled online-payment routes, COD ordering without payment credentials, order tracking, stock reservation, oversell rejection, cancellation restock, and assistant preview.');
} finally {
  await stopServer();
  openDb?.close();
  await rm(dataDir, { recursive: true, force: true });
}

