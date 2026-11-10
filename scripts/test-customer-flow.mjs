import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {saveListing} from '../commerce.mjs';

// Every email and business fact in this test is synthetic and confined to an isolated database.
const temporary=await mkdtemp(join(tmpdir(),'asryo-customer-flow-'));
const capture=join(temporary,'mail.json'),preload=join(temporary,'mail-fixture.mjs');
await writeFile(preload,`import {writeFile} from 'node:fs/promises';
const network=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 if(String(url)==='https://api.resend.com/emails'){
  await writeFile(process.env.TEST_MAIL_CAPTURE,options.body,{mode:0o600});
  return Response.json({id:'synthetic-delivery'});
 }
 return network(url,options);
};`);
const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['--import',preload,'server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,NODE_ENV:'test',PORT:String(port),DATA_DIR:temporary,APP_ORIGIN:base,TEST_MAIL_CAPTURE:capture,STORE_READY:'true',HIDE_PUBLIC_PRODUCTS:'false',PUBLIC_BUSINESS_NAME:'Synthetic QA',PUBLIC_SUPPORT_EMAIL:'support@example.test',PUBLIC_SUPPORT_PHONE:'+919876543210',PUBLIC_RETURN_ADDRESS:'Synthetic address',FULFILMENT_APPROVED:'true',POLICIES_APPROVED:'true',NOTIFICATIONS_APPROVED:'true',RESEND_API_KEY:'synthetic-not-real',MAIL_FROM:'synthetic@example.test',COD_APPROVED:'true',COD_PINCODES:'302001',SHIPPING_FEE_PAISE:'0',SHIPPING_GST_BPS:'0',PAYMENTS_MODE:'disabled',ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:'synthetic-qa-password-more-than-24-characters'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
const request=async(path,body,cookie,extra={})=>fetch(base+path,{method:body?'POST':'GET',headers:{Origin:base,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
let db;
try{
 for(let i=0;i<80;i++){
  if(child.exitCode!==null)throw Error('Test server exited: '+logs);
  try{if((await fetch(base+'/healthz')).ok)break;}catch{}
  if(i===79)throw Error('Test server failed to start.');
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 db=new DatabaseSync(join(temporary,'asryo.sqlite'));
 db.prepare("INSERT INTO products VALUES('customer-test-shirt','SYNTHETIC TEST SHIRT','clothing','T-Shirt','asryo-speed-division-front.webp','Isolated test fixture',105000,2,1,'[]',?)").run(new Date().toISOString());
 saveListing(db,'customer-test-shirt',{mode:'ready_stock',cancellationTerms:'Synthetic cancellation terms',refundTerms:'Synthetic refund terms',approved:true,specificationsVerified:true,imagesVerified:true,stockVerified:true,taxConfirmed:true,fabric:'Synthetic fixture',gsm:240,fit:'Synthetic',sizeGuide:'Synthetic measurements',images:['/assets/asryo-speed-division-front.webp','/assets/asryo-speed-division-back.webp'],gstBps:500,deliveryMinDays:3,deliveryMaxDays:7,approvalReference:'SYNTHETIC TEST',expectedRevision:0});
 const password='synthetic-customer-password-123';
 async function verifiedAccount(email){
  const registration=await request('/api/auth/register',{email,password});assert.equal(registration.status,202,'registration reaches the mocked email provider');
  assert.equal((await request('/api/auth/login',{email,password})).status,403,'unverified customer cannot sign in');
  const message=JSON.parse(await readFile(capture,'utf8'));assert.deepEqual(message.to,[email]);
  const verification=message.html.match(/href="([^"]+)"/)[1];assert(verification.startsWith(base+'/api/auth/verify?token='));
  const verified=await fetch(verification,{redirect:'manual'});assert.equal(verified.status,303);assert.equal(verified.headers.get('location'),'/account?verified=1');
  const login=await request('/api/auth/login',{email,password});assert.equal(login.status,200);
  const setCookie=login.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Lax/);
  const stored=db.prepare('SELECT password_hash,verified_at FROM customers WHERE email=?').get(email);assert(stored.verified_at);assert.match(stored.password_hash,/^scrypt\$/);assert(!stored.password_hash.includes(password));
  return setCookie.split(';')[0];
 }
 const customer=await verifiedAccount('one@example.test');
 const unrelated=await verifiedAccount('two@example.test');
 assert.equal((await request('/api/admin/commerce',null,customer)).status,401,'customer session cannot become an admin');
 const input={email:'one@example.test',phone:'9876543210',address:{name:'Synthetic customer',line1:'1 Synthetic Road',city:'Jaipur',region:'Rajasthan',postalCode:'302001',country:'India'},items:[{id:'customer-test-shirt',quantity:1}],paymentMethod:'cash_on_delivery',termsAccepted:true};
 const idempotency=randomUUID();
 const placed=await request('/api/checkout/orders',input,customer,{'Idempotency-Key':idempotency});assert.equal(placed.status,201);const order=await placed.json();
 const repeat=await request('/api/checkout/orders',input,customer,{'Idempotency-Key':idempotency});assert.equal(repeat.status,200);assert.equal((await repeat.json()).orderId,order.orderId);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n,1);
 const own=await (await request('/api/account/orders',null,customer)).json();assert.equal(own.orders.length,1);assert.equal(own.orders[0].id,order.orderId);assert.equal(own.orders[0].summary.items[0].name,'SYNTHETIC TEST SHIRT');
 assert.equal((await (await request('/api/account/orders',null,unrelated)).json()).orders.length,0);
 assert.equal((await request('/api/storefront/orders?id='+order.orderId,null,unrelated)).status,404,'other customers cannot read this order');
 assert.equal((await request('/api/storefront/orders?id='+order.orderId,null,customer)).status,200,'owner account can track without a guest token');
 assert.equal((await request('/api/storefront/orders/action',{orderId:order.orderId,status:'cancelled'},unrelated)).status,404);
 assert.equal((await request('/api/storefront/orders/action',{orderId:order.orderId,status:'cancelled'},customer)).status,200);
 assert.equal(db.prepare("SELECT stock FROM products WHERE id='customer-test-shirt'").get().stock,2,'customer cancellation restores stock');
 const admin=await request('/api/admin/login',{email:'admin@example.test',password:'synthetic-qa-password-more-than-24-characters'});assert.equal(admin.status,200);const adminCookie=admin.headers.get('set-cookie').split(';')[0];
 const release=JSON.parse(db.prepare("SELECT profile_json FROM commerce_listings WHERE product_id='customer-test-shirt'").get().profile_json);
 db.prepare("INSERT INTO products VALUES('preorder-test','SYNTHETIC PREORDER','clothing','T-Shirt','test.webp','Isolated test fixture',NULL,NULL,0,'[]',?)").run(new Date().toISOString());
 saveListing(db,'preorder-test',{...release,mode:'preorder',expectedRevision:0,manufacturingConfirmed:true,capacity:2,dispatchDate:'2099-01-01',paymentTiming:'Full payment is collected immediately at checkout.'});
 const activatePreorder=await fetch(base+'/api/admin/products/preorder-test',{method:'PATCH',headers:{Origin:base,Cookie:adminCookie,'Content-Type':'application/json'},body:JSON.stringify({pricePaise:105000,stock:null,active:true,description:'Synthetic pre-order'})});
 assert.equal(activatePreorder.status,200,'pre-orders activate without fabricated physical stock');
 assert.equal(db.prepare("SELECT stock FROM products WHERE id='preorder-test'").get().stock,null);
 assert.equal((await request('/api/admin/commerce',null,adminCookie)).status,200,'admin can inspect commerce readiness and release profiles');
 assert.equal((await request('/api/admin/commerce/orders',null,adminCookie)).status,200);
 await request('/api/auth/logout',{},customer);assert.equal((await request('/api/auth/me',null,customer)).status,401,'logout revokes the stored session');
 console.log('Customer flow verified: mocked verification email → account activation → login → idempotent order → account-scoped history → cancellation → admin access. No real mail or payment was sent.');
}finally{
 db?.close();child.kill('SIGTERM');if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));await rm(temporary,{recursive:true,force:true});
}
