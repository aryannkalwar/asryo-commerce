import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {initInventory} from '../inventory.mjs';
import {initCommerce,saveListing,quote,createCheckout,updateOrder,orderDetail} from '../commerce.mjs';
import {initOperations,staffCan,supplierSave,purchaseCreate,purchaseTransition,expenseCreate,expenseVoid,costSave,couponSave,staffSave,managementReport,reportCSV} from '../operations.mjs';
const owner={role:'owner',email:'owner@example.test'},manager={role:'manager',email:'manager@example.test'},finance={role:'finance',email:'finance@example.test'};
const env={NODE_ENV:'test',STORE_READY:'true',HIDE_PUBLIC_PRODUCTS:'false',PUBLIC_BUSINESS_NAME:'Synthetic store',PUBLIC_SUPPORT_EMAIL:'support@example.test',PUBLIC_SUPPORT_PHONE:'9876543210',PUBLIC_RETURN_ADDRESS:'Synthetic address',FULFILMENT_APPROVED:'true',POLICIES_APPROVED:'true',NOTIFICATIONS_APPROVED:'true',RESEND_API_KEY:'synthetic-not-real',MAIL_FROM:'test@example.test',APP_ORIGIN:'https://example.test',COD_APPROVED:'true',COD_PINCODES:'302001',SHIPPING_FEE_PAISE:'0',SHIPPING_GST_BPS:'0'};
const orderInput={email:'one@example.test',phone:'9876543210',address:{name:'Synthetic customer',line1:'1 Synthetic Road',city:'Jaipur',region:'Rajasthan',postalCode:'302001',country:'India'},items:[{id:'shirt',quantity:1}],paymentMethod:'cash_on_delivery',termsAccepted:true};
const coupon={code:'TEST10',kind:'percent',value:1000,minSubtotalPaise:100000,maxDiscountPaise:20000,maxUses:1,startsAt:'2020-01-01',endsAt:'2099-12-31',active:true,expectedRevision:0};
function fixture(){const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,category TEXT,type TEXT,image TEXT,description TEXT,price_paise INTEGER,stock INTEGER,active INTEGER,options_json TEXT,updated_at TEXT);
 CREATE TABLE admin_sessions(token_hash TEXT PRIMARY KEY,expires_at INTEGER,created_at TEXT);
 CREATE TABLE orders(id TEXT PRIMARY KEY,customer_id TEXT,public_token_hash TEXT,status TEXT,payment_status TEXT,payment_method TEXT,total_paise INTEGER,shipping_paise INTEGER,currency TEXT,shipping_json TEXT,created_at TEXT,updated_at TEXT);
 CREATE TABLE order_items(order_id TEXT NOT NULL REFERENCES orders(id),product_id TEXT,product_name TEXT,quantity INTEGER,unit_price_paise INTEGER,PRIMARY KEY(order_id,product_id));
 INSERT INTO products VALUES('shirt','Synthetic shirt','clothing','T-Shirt','test.webp','Synthetic only',105000,4,1,'[]','2026-01-01');`);initInventory(db);initCommerce(db);initOperations(db);saveListing(db,'shirt',{mode:'ready_stock',approved:true,specificationsVerified:true,imagesVerified:true,stockVerified:true,taxConfirmed:true,fabric:'Synthetic',gsm:240,fit:'Synthetic',sizeGuide:'Synthetic size guide',images:['/assets/test-front.webp','/assets/test-back.webp'],gstBps:500,deliveryMinDays:3,deliveryMaxDays:7,cancellationTerms:'Synthetic cancellation',refundTerms:'Synthetic refunds',approvalReference:'SYNTHETIC TEST',expectedRevision:0});return db;}

test('staff roles enforce least privilege across business records, refunds, drafts and owner access',()=>{
 for(const role of ['manager','operator','designer','finance','viewer']){assert.equal(staffCan(role,'POST','/api/admin/operations/staff'),false);assert.equal(staffCan(role,'POST','/api/admin/commerce/orders/id/refund'),false);}
 assert.equal(staffCan('viewer','GET','/api/admin/products'),true);assert.equal(staffCan('viewer','PATCH','/api/admin/products/id'),false);assert.equal(staffCan('viewer','GET','/api/admin/orders'),false);
 assert.equal(staffCan('operator','PATCH','/api/admin/orders/id'),true);assert.equal(staffCan('operator','PUT','/api/admin/commerce/listings/id'),false);
 assert.equal(staffCan('designer','POST','/api/admin/designs/id/review'),true);assert.equal(staffCan('designer','POST','/api/admin/designs/id/approve'),false);assert.equal(staffCan('designer','POST','/api/admin/designs/id/draft-sku'),false);
 assert.equal(staffCan('finance','POST','/api/admin/operations/expenses'),true);assert.equal(staffCan('finance','PATCH','/api/admin/products/id'),false);
 assert.equal(staffCan('manager','POST','/api/admin/operations/expenses'),false);assert.equal(staffCan('owner','POST','/api/admin/operations/staff'),true);
});
test('supplier revisions and purchase approval keep records immutable and cannot manufacture inventory',()=>{
 const db=fixture(),supplier=supplierSave(db,{name:'Synthetic supplier',email:'supplier@example.test',active:true,expectedRevision:0},manager);
 const purchase=purchaseCreate(db,{supplierId:supplier.id,items:[{description:'Synthetic blanks',quantity:10,unitCostPaise:30000}]},manager);
 supplierSave(db,{id:supplier.id,name:'Renamed supplier',email:'changed@example.test',active:true,expectedRevision:1},manager);
 const saved=JSON.parse(db.prepare('SELECT snapshot_json FROM ops_purchase_orders').get().snapshot_json);assert.equal(saved.supplier.name,'Synthetic supplier');
 assert.throws(()=>supplierSave(db,{id:supplier.id,name:'Stale edit',expectedRevision:1},manager),e=>e.status===409);
 assert.throws(()=>purchaseTransition(db,purchase.id,{status:'approved',expectedRevision:1},manager),e=>e.status===403);
 purchaseTransition(db,purchase.id,{status:'approved',expectedRevision:1},owner);
 assert.throws(()=>purchaseTransition(db,purchase.id,{status:'ordered',expectedRevision:2},owner),/reference/);
 purchaseTransition(db,purchase.id,{status:'ordered',expectedRevision:2,reference:'Synthetic supplier order',confirmActual:true},owner);
 purchaseTransition(db,purchase.id,{status:'received',expectedRevision:3,reference:'Synthetic physical receipt',confirmActual:true},manager);
 assert.equal(db.prepare("SELECT stock FROM products WHERE id='shirt'").get().stock,4);assert.equal(db.prepare('SELECT total_paise FROM ops_purchase_orders').get().total_paise,300000);db.close();
});
test('actual expense records require finance approval, valid amounts and auditable correction without deletion',()=>{
 const db=fixture(),input={date:'2026-11-11',category:'shipping',amountPaise:10000,includedGstPaise:1000,description:'Synthetic shipment',reference:'SYNTHETIC-INVOICE',confirmActual:true};
 assert.throws(()=>expenseCreate(db,input,manager),e=>e.status===403);assert.throws(()=>expenseCreate(db,{...input,confirmActual:false},finance),/actual/);assert.throws(()=>expenseCreate(db,{...input,includedGstPaise:20000},finance),/amount/);
 const requestId=randomUUID();const expense=expenseCreate(db,{...input,requestId},finance);assert.equal(expenseCreate(db,{...input,requestId},finance).replayed,true);assert.throws(()=>expenseCreate(db,{...input,amountPaise:10001,requestId},finance),e=>e.status===409);expenseVoid(db,expense.id,{expectedRevision:1,reason:'Synthetic test correction'},finance);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM ops_expenses').get().n,1);assert(db.prepare('SELECT voided_at FROM ops_expenses').get().voided_at);assert.throws(()=>expenseVoid(db,expense.id,{expectedRevision:1,reason:'Duplicate correction'},finance),e=>e.status===409);db.close();
});
test('only owner activation can make a promotion eligible and price/expiry rules remain server-side',()=>{
 const db=fixture();assert.throws(()=>couponSave(db,coupon,manager),e=>e.status===403);couponSave(db,{...coupon,active:false},manager);assert.throws(()=>quote(db,{...orderInput,couponCode:'TEST10'},env),/eligible/);
 couponSave(db,{...coupon,expectedRevision:1},owner);const result=quote(db,{...orderInput,couponCode:'test10',discountPaise:999999999},env);assert.equal(result.discountPaise,10500);assert.equal(result.taxPaise,4500);assert.equal(result.totalPaise,94500);
 couponSave(db,{...coupon,expectedRevision:2,endsAt:'2020-01-02'},owner);assert.throws(()=>quote(db,{...orderInput,couponCode:'TEST10'},env),/eligible/);db.close();
});
test('transactional promotion use limits survive duplicate requests and release once on cancellation',async()=>{
 const db=fixture();couponSave(db,coupon,owner);const input={...orderInput,couponCode:'TEST10'},key=randomUUID();const first=await createCheckout(db,input,key,null,env);assert.equal((await createCheckout(db,input,key,null,env)).orderId,first.orderId);
 await assert.rejects(createCheckout(db,input,randomUUID(),null,env),/use limit/);assert.equal(db.prepare('SELECT COUNT(*) n FROM ops_coupon_redemptions').get().n,1);
 updateOrder(db,first.orderId,{status:'cancelled'});await createCheckout(db,input,randomUUID(),null,env);assert.equal(db.prepare('SELECT COUNT(*) n FROM ops_coupon_redemptions WHERE released=0').get().n,1);db.close();
});
test('management reports use immutable confirmed order costs and keep inventory purchases separate',async()=>{
 const db=fixture();costSave(db,{productId:'shirt',unitCostPaise:50000,reference:'SYNTHETIC-COST',confirmActual:true,expectedRevision:0},finance);couponSave(db,coupon,owner);
 const order=await createCheckout(db,{...orderInput,couponCode:'TEST10'},randomUUID(),null,env);costSave(db,{productId:'shirt',unitCostPaise:60000,reference:'LATER-SYNTHETIC-COST',confirmActual:true,expectedRevision:1},finance);
 assert.equal(quote(db,orderInput,env).items[0].unitCostPaise,undefined,'customer quotes cannot expose private manufacturing costs');
 assert.equal(orderDetail(db,db.prepare('SELECT * FROM orders WHERE id=?').get(order.orderId)).summary.items[0].unitCostPaise,undefined,'customer order history cannot expose manufacturing costs');
 for(const status of ['processing','packed','shipped','out_for_delivery','delivered'])updateOrder(db,order.orderId,{status,carrier:'Synthetic courier',trackingNumber:'SYNTHETIC-1'});
 expenseCreate(db,{date:new Date().toISOString().slice(0,10),category:'operating',amountPaise:10000,includedGstPaise:0,description:'Synthetic operating expense',reference:'SYNTHETIC-EXPENSE',confirmActual:true},finance);
 expenseCreate(db,{date:new Date().toISOString().slice(0,10),category:'inventory_purchase',amountPaise:100000,includedGstPaise:0,description:'Synthetic purchase',reference:'SYNTHETIC-PURCHASE',confirmActual:true},finance);
 const r=managementReport(db);assert.equal(r.recognizedSalesPaise,90000);assert.equal(r.knownCogsPaise,50000);assert.equal(r.operatingExpensesPaise,10000);assert.equal(r.inventoryPurchasesPaise,100000);assert.equal(r.managementProfitPaise,30000);assert.equal(r.gstFilingReady,false);db.close();
});
test('missing confirmed order costs keep management profit unknown',async()=>{
 const db=fixture(),order=await createCheckout(db,orderInput,randomUUID(),null,env);for(const status of ['processing','packed','shipped','out_for_delivery','delivered'])updateOrder(db,order.orderId,{status,carrier:'Synthetic courier',trackingNumber:'TEST'});const r=managementReport(db);assert.equal(r.managementProfitPaise,null);assert.equal(r.unknownCostOrders,1);db.close();
});
test('reporting periods and CSV dates use Indian midnight rather than UTC midnight',async()=>{
 const db=fixture(),orders=[];
 for(const createdAt of ['2026-11-10T18:29:59Z','2026-11-10T18:30:00Z']){
  const order=await createCheckout(db,orderInput,randomUUID(),null,env);orders.push(order.orderId);
  db.prepare('UPDATE orders SET created_at=? WHERE id=?').run(createdAt,order.orderId);
  for(const status of ['processing','packed','shipped','out_for_delivery','delivered'])updateOrder(db,order.orderId,{status,carrier:'Synthetic courier',trackingNumber:'SYNTHETIC-IST'});
 }
 const previous=managementReport(db,'2026-11-10','2026-11-10'),today=managementReport(db,'2026-11-11','2026-11-11');
 assert.deepEqual(previous.sales.map(x=>x.orderId),[orders[0]]);assert.deepEqual(today.sales.map(x=>x.orderId),[orders[1]]);
 assert.equal(today.timeZone,'Asia/Kolkata');assert.equal(today.sales[0].date,'2026-11-11');assert.match(reportCSV(today),/2026-11-11/);db.close();
});
test('CSV export escapes spreadsheet formula injection in supplier and expense references',()=>{
 const db=fixture();expenseCreate(db,{date:'2026-11-11',category:'other',amountPaise:10000,includedGstPaise:0,description:'Synthetic CSV safety',reference:'=HYPERLINK("https://example.test")',confirmActual:true},finance);assert.match(reportCSV(managementReport(db)),/"'=HYPERLINK/);db.close();
});
test('staff access changes revoke only staff sessions and never create owner-compatible tokens',async()=>{
 const db=fixture(),input={email:'staff@example.test',name:'Synthetic staff',role:'viewer',password:'synthetic-password',enabled:true,expectedRevision:0};
 await assert.rejects(staffSave(db,input,manager,async()=>''),e=>e.status===403);await assert.rejects(staffSave(db,{...input,role:'owner'},owner,async()=>''),/allowed role/);
 const staff=await staffSave(db,input,owner,async()=> 'synthetic-hash');db.prepare('INSERT INTO ops_staff_sessions VALUES(?,?,?,?)').run('staff-token-hash',staff.id,Date.now()+10000,new Date().toISOString());db.prepare('INSERT INTO admin_sessions VALUES(?,?,?)').run('owner-token-hash',Date.now()+10000,new Date().toISOString());
 await staffSave(db,{...input,id:staff.id,password:'',enabled:false,expectedRevision:1},owner,async()=> 'not-used');assert.equal(db.prepare('SELECT COUNT(*) n FROM ops_staff_sessions').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n,1);assert.equal(db.prepare('SELECT password_hash FROM ops_staff').get().password_hash,'synthetic-hash');db.close();
});
