import {randomUUID} from 'node:crypto';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const at=()=>new Date().toISOString();
const str=(value,max=250)=>String(value??'').trim().slice(0,max);
const integer=(value,min=0,max=100000000)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const dateOK=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export const staffRoles=['manager','operator','designer','finance','viewer'];

export function staffCan(role,method,path){
 if(role==='owner')return true;
 const read=['GET','HEAD'].includes(method);
 if(path==='/api/admin/me'||path==='/api/admin/logout')return true;
 if(path.startsWith('/api/admin/operations/staff'))return false;
 if(path.endsWith('/refund')||path.endsWith('/reconcile'))return false;
 if(role==='manager'){
  if(path.startsWith('/api/admin/operations/expenses')||path.startsWith('/api/admin/operations/costs'))return read;
  return path.startsWith('/api/admin/')&&!path.startsWith('/api/admin/fashion-login');
 }
 if(role==='finance')return read&&(/^\/api\/admin\/(commerce(?:\/orders)?|orders|products|finance\/products|operations(?:\/reports(?:\.csv)?)?)$/.test(path))
  ||method==='POST'&&/^\/api\/admin\/operations\/expenses(?:\/[^/]+\/void)?$/.test(path)
  ||method==='PUT'&&path==='/api/admin/operations/costs';
 if(role==='designer')return path==='/api/admin/designs'||path.startsWith('/api/admin/designs/')&&!/\/(approve|draft-sku)$/.test(path);
 if(role==='operator')return read&&['/api/admin/products','/api/admin/inventory','/api/admin/orders','/api/admin/commerce/orders'].includes(path)
  ||method==='PATCH'&&/^\/api\/admin\/orders\/[^/]+$/.test(path);
 if(role==='viewer')return read&&['/api/admin/products','/api/admin/inventory'].includes(path);
 return false;
}

export function initOperations(db){
 db.exec(`CREATE TABLE IF NOT EXISTS ops_staff (
  id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,
  role TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS ops_staff_sessions (
  token_hash TEXT PRIMARY KEY,staff_id TEXT NOT NULL REFERENCES ops_staff(id),expires_at INTEGER NOT NULL,created_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS ops_suppliers (
  id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,address TEXT NOT NULL,
  notes TEXT NOT NULL,active INTEGER NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS ops_purchase_orders (
  id TEXT PRIMARY KEY,supplier_id TEXT NOT NULL REFERENCES ops_suppliers(id),snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL,reference TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL,
  total_paise INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS ops_expenses (
  id TEXT PRIMARY KEY,date TEXT NOT NULL,category TEXT NOT NULL,amount_paise INTEGER NOT NULL,
  included_gst_paise INTEGER NOT NULL,description TEXT NOT NULL,reference TEXT NOT NULL,
  voided_at TEXT,revision INTEGER NOT NULL,created_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS ops_unit_costs (
  product_id TEXT PRIMARY KEY REFERENCES products(id),unit_cost_paise INTEGER NOT NULL,
  reference TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS ops_coupons (
  code TEXT PRIMARY KEY,kind TEXT NOT NULL,value INTEGER NOT NULL,min_subtotal_paise INTEGER NOT NULL,
  max_discount_paise INTEGER NOT NULL,max_uses INTEGER NOT NULL,starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,
  active INTEGER NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS ops_coupon_redemptions (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),code TEXT NOT NULL REFERENCES ops_coupons(code),
  discount_paise INTEGER NOT NULL,released INTEGER NOT NULL DEFAULT 0
 );
 CREATE TABLE IF NOT EXISTS ops_audit (
  id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,
  detail_json TEXT NOT NULL,created_at TEXT NOT NULL
 );`);
}

function record(db,actor,action,type,id,details={}){
 db.prepare('INSERT INTO ops_audit VALUES(?,?,?,?,?,?,?)').run(randomUUID(),actor.email||actor.role,action,type,id,JSON.stringify(details),at());
}
const owner=actor=>{if(actor.role!=='owner')fail(403,'Only the ASRYO owner can approve this action.');};
function checkRevision(row,input){if((row?.revision||0)!==input.expectedRevision)fail(409,'This record changed. Refresh before saving.');}
function tx(db,fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}
export function supplierSave(db,input,actor){
 const id=input.id?str(input.id,100):randomUUID(),name=str(input.name,150),email=str(input.email,254).toLowerCase();
 if(name.length<2||(email&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)))fail(400,'Enter a supplier name and a valid email if provided.');
 return tx(db,()=>{const previous=db.prepare('SELECT * FROM ops_suppliers WHERE id=?').get(id);checkRevision(previous,input);
  db.prepare(`INSERT INTO ops_suppliers VALUES(?,?,?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,phone=excluded.phone,address=excluded.address,notes=excluded.notes,active=excluded.active,revision=ops_suppliers.revision+1,updated_at=excluded.updated_at`).run(id,name,email,str(input.phone,30),str(input.address,1000),str(input.notes,2500),input.active===false?0:1,at(),at());
  record(db,actor,previous?'updated':'created','supplier',id);return {id};});
}
export function purchaseCreate(db,input,actor){
 const supplier=db.prepare('SELECT id,name,email,phone,address FROM ops_suppliers WHERE id=? AND active=1').get(str(input.supplierId,100));
 if(!supplier||!Array.isArray(input.items)||!input.items.length||input.items.length>100)fail(400,'Select an active supplier and valid line items.');
 const items=input.items.map(x=>{if(!x||str(x.description).length<2||!integer(x.quantity,1,100000)||!integer(x.unitCostPaise,1))fail(400,'Enter each item description, quantity and supplier quote in paise.');return {description:str(x.description,500),quantity:x.quantity,unitCostPaise:x.unitCostPaise};});
 const totalPaise=items.reduce((n,x)=>n+x.quantity*x.unitCostPaise,0);if(!integer(totalPaise,1))fail(400,'Purchase total is too large.');
 const id=randomUUID();return tx(db,()=>{db.prepare("INSERT INTO ops_purchase_orders VALUES(?,?,?,'draft','',1,?,?,?)").run(id,supplier.id,JSON.stringify({supplier,items,note:str(input.note,2500),currency:'INR'}),totalPaise,at(),at());record(db,actor,'created','purchase_order',id,{status:'draft'});return {id};});
}
export function purchaseTransition(db,id,input,actor){
 return tx(db,()=>{const previous=db.prepare('SELECT * FROM ops_purchase_orders WHERE id=?').get(id);if(!previous)fail(404,'Purchase order not found.');checkRevision(previous,input);
  const allowed={draft:['approved','cancelled'],approved:['ordered','cancelled'],ordered:['received','cancelled'],received:[],cancelled:[]};
  if(!allowed[previous.status]?.includes(input.status))fail(400,'This purchase status change is not allowed.');
  if(['approved','ordered'].includes(input.status))owner(actor);
  const reference=str(input.reference,250);
  if(['ordered','received'].includes(input.status)&&(reference.length<3||input.confirmActual!==true))fail(400,'Record an actual supplier order or goods-receipt reference. No supplier order is sent by this app.');
  db.prepare('UPDATE ops_purchase_orders SET status=?,reference=?,revision=revision+1,updated_at=? WHERE id=?').run(input.status,reference,at(),id);
  record(db,actor,'status_changed','purchase_order',id,{from:previous.status,to:input.status,reference});return {ok:true};});
}
export function expenseCreate(db,input,actor){
 if(!['owner','finance'].includes(actor.role))fail(403,'Finance permission is required.');
 if(input.confirmActual!==true||!dateOK(input.date)||!['operating','shipping','marketing','rent','salary','utilities','inventory_purchase','other'].includes(input.category)||!integer(input.amountPaise,1)||!integer(input.includedGstPaise,0,input.amountPaise)||str(input.reference).length<3||str(input.description).length<3)fail(400,'Enter an actual dated expense, invoice/reference, amount and included GST.');
 const id=input.requestId||randomUUID();if(!/^[a-f0-9-]{36}$/.test(id))fail(400,'Use a valid expense request reference.');
 return tx(db,()=>{const previous=db.prepare('SELECT * FROM ops_expenses WHERE id=?').get(id);if(previous){if(previous.date!==input.date||previous.category!==input.category||previous.amount_paise!==input.amountPaise||previous.included_gst_paise!==input.includedGstPaise||previous.description!==str(input.description,1000)||previous.reference!==str(input.reference,250))fail(409,'This expense request reference belongs to different details.');return {id,replayed:true};}
  db.prepare('INSERT INTO ops_expenses VALUES(?,?,?,?,?,?,?,NULL,1,?)').run(id,input.date,input.category,input.amountPaise,input.includedGstPaise,str(input.description,1000),str(input.reference,250),at());record(db,actor,'created','expense',id);return {id,replayed:false};});
}
export function expenseVoid(db,id,input,actor){
 if(!['owner','finance'].includes(actor.role))fail(403,'Finance permission is required.');
 return tx(db,()=>{const row=db.prepare('SELECT * FROM ops_expenses WHERE id=?').get(id);if(!row)fail(404,'Expense not found.');checkRevision(row,input);if(row.voided_at||str(input.reason).length<5)fail(400,'An unvoided expense and correction reason are required.');db.prepare('UPDATE ops_expenses SET voided_at=?,revision=revision+1 WHERE id=?').run(at(),id);record(db,actor,'voided','expense',id,{reason:str(input.reason)});return {ok:true};});
}
export function costSave(db,input,actor){
 if(!['owner','finance'].includes(actor.role))fail(403,'Finance permission is required.');
 if(!db.prepare('SELECT 1 FROM products WHERE id=?').get(str(input.productId,100))||!integer(input.unitCostPaise,0)||input.confirmActual!==true||str(input.reference).length<3)fail(400,'Confirm an actual landed unit cost and its invoice/reference.');
 return tx(db,()=>{const previous=db.prepare('SELECT * FROM ops_unit_costs WHERE product_id=?').get(input.productId);checkRevision(previous,input);db.prepare(`INSERT INTO ops_unit_costs VALUES(?,?,?,1,?) ON CONFLICT(product_id) DO UPDATE SET unit_cost_paise=excluded.unit_cost_paise,reference=excluded.reference,revision=ops_unit_costs.revision+1,updated_at=excluded.updated_at`).run(input.productId,input.unitCostPaise,str(input.reference),at());record(db,actor,'cost_saved','product',input.productId,{unitCostPaise:input.unitCostPaise,reference:str(input.reference)});return {ok:true};});
}
export function confirmedUnitCost(db,id){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ops_unit_costs'").get())return null;
 return db.prepare('SELECT unit_cost_paise FROM ops_unit_costs WHERE product_id=?').get(id)?.unit_cost_paise??null;
}

export function couponSave(db,input,actor){
 const code=str(input.code,32).toUpperCase();
 if(!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)||!['percent','fixed'].includes(input.kind)||!integer(input.value,1,input.kind==='percent'?10000:100000000)||!integer(input.minSubtotalPaise)||!integer(input.maxDiscountPaise,1)||!integer(input.maxUses,1,1000000)||!dateOK(input.startsAt)||!dateOK(input.endsAt)||input.endsAt<input.startsAt)fail(400,'Enter a valid code, discount, budget/use limits and date range. Percentage values use basis points (10% = 1000).');
 if(input.active===true)owner(actor);
 return tx(db,()=>{const previous=db.prepare('SELECT * FROM ops_coupons WHERE code=?').get(code);checkRevision(previous,input);if(previous?.active&&actor.role!=='owner')fail(403,'Only the owner can change an active promotion.');
  db.prepare(`INSERT INTO ops_coupons VALUES(?,?,?,?,?,?,?,?,?,1,?) ON CONFLICT(code) DO UPDATE SET kind=excluded.kind,value=excluded.value,min_subtotal_paise=excluded.min_subtotal_paise,max_discount_paise=excluded.max_discount_paise,max_uses=excluded.max_uses,starts_at=excluded.starts_at,ends_at=excluded.ends_at,active=excluded.active,revision=ops_coupons.revision+1,updated_at=excluded.updated_at`).run(code,input.kind,input.value,input.minSubtotalPaise,input.maxDiscountPaise,input.maxUses,input.startsAt,input.endsAt,input.active===true?1:0,at());record(db,actor,'saved','coupon',code,{active:input.active===true});return {ok:true};});
}
export function couponDiscount(db,code,subtotal,date=new Date()){
 if(!code)return {couponCode:null,discountPaise:0};
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ops_coupons'").get())fail(400,'This promotion is not available.');
 const row=db.prepare('SELECT * FROM ops_coupons WHERE code=? AND active=1').get(str(code,32).toUpperCase());
 const day=date.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
 if(!row||day<row.starts_at||day>row.ends_at||subtotal<row.min_subtotal_paise)fail(400,'This promotion is not eligible for your bag or date.');
 const used=db.prepare('SELECT COUNT(*) n FROM ops_coupon_redemptions WHERE code=? AND released=0').get(row.code).n;
 if(used>=row.max_uses)fail(400,'This promotion has reached its approved use limit.');
 const discount=Math.min(row.max_discount_paise,subtotal-1,row.kind==='percent'?Math.floor(subtotal*row.value/10000):row.value);
 return {couponCode:row.code,discountPaise:Math.max(0,discount)};
}

export async function staffSave(db,input,actor,passwordHash){
 owner(actor);const email=str(input.email,254).toLowerCase(),name=str(input.name,150),id=input.id?str(input.id,100):randomUUID();
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)||name.length<2||!staffRoles.includes(input.role)||email===String(process.env.ADMIN_EMAIL||'').toLowerCase())fail(400,'Enter a staff name, distinct email and allowed role.');
 const previous=db.prepare('SELECT * FROM ops_staff WHERE id=?').get(id);checkRevision(previous,input);
 const password=String(input.password||'');if((!previous||password)&& (password.length<12||password.length>128))fail(400,'A staff password must contain 12–128 characters.');
 const encoded=password?await passwordHash(password):previous.password_hash;
 return tx(db,()=>{checkRevision(db.prepare('SELECT revision FROM ops_staff WHERE id=?').get(id),input);
  if(db.prepare('SELECT id FROM ops_staff WHERE email=? AND id<>?').get(email,id))fail(409,'That staff email is already registered.');
  db.prepare(`INSERT INTO ops_staff VALUES(?,?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,password_hash=excluded.password_hash,role=excluded.role,enabled=excluded.enabled,revision=ops_staff.revision+1,updated_at=excluded.updated_at`).run(id,email,name,encoded,input.role,input.enabled===false?0:1,at(),at());
  db.prepare('DELETE FROM ops_staff_sessions WHERE staff_id=?').run(id);
  record(db,actor,previous?'updated':'created','staff',id,{email,role:input.role,enabled:input.enabled!==false});return {id};});
}

export function managementReport(db,from='0000-01-01',to='9999-12-31'){
 if((from!=='0000-01-01'&&!dateOK(from))||(to!=='9999-12-31'&&!dateOK(to))||from>to)fail(400,'Choose a valid reporting period.');
 const orders=db.prepare("SELECT o.*,date(o.created_at,'+5 hours','+30 minutes') AS india_date,c.snapshot_json FROM orders o LEFT JOIN commerce_checkouts c ON c.order_id=o.id WHERE date(o.created_at,'+5 hours','+30 minutes')>=? AND date(o.created_at,'+5 hours','+30 minutes')<=? ORDER BY o.created_at").all(from,to);
 const expenses=db.prepare('SELECT * FROM ops_expenses WHERE date>=? AND date<=? AND voided_at IS NULL ORDER BY date').all(from,to);
 let recognizedSalesPaise=0,includedOutputGstPaise=0,knownCogsPaise=0,unknownCostOrders=0,missingSnapshotOrders=0;
 const sales=[];
 for(const order of orders){
  if(order.status!=='delivered'||!['paid','collected'].includes(order.payment_status))continue;
  const snapshot=order.snapshot_json?JSON.parse(order.snapshot_json):null;
  if(!snapshot){unknownCostOrders++;missingSnapshotOrders++;continue;}
  recognizedSalesPaise+=order.total_paise-snapshot.taxPaise;includedOutputGstPaise+=snapshot.taxPaise;
  const known=snapshot.items.every(x=>Number.isSafeInteger(x.unitCostPaise));
  const cogs=known?snapshot.items.reduce((n,x)=>n+x.unitCostPaise*x.quantity,0):null;
  if(cogs===null)unknownCostOrders++;else knownCogsPaise+=cogs;
  sales.push({orderId:order.id,date:order.india_date,totalPaise:order.total_paise,includedGstPaise:snapshot.taxPaise,cogsPaise:cogs,discountPaise:snapshot.discountPaise||0});
 }
 const operatingExpensesPaise=expenses.filter(x=>x.category!=='inventory_purchase').reduce((n,x)=>n+x.amount_paise,0);
 const inventoryPurchasesPaise=expenses.filter(x=>x.category==='inventory_purchase').reduce((n,x)=>n+x.amount_paise,0);
 return {from,to,timeZone:'Asia/Kolkata',recognizedSalesPaise:missingSnapshotOrders?null:recognizedSalesPaise,includedOutputGstPaise:missingSnapshotOrders?null:includedOutputGstPaise,knownCogsPaise,unknownCostOrders,missingSnapshotOrders,operatingExpensesPaise,inventoryPurchasesPaise,
  managementProfitPaise:unknownCostOrders?null:recognizedSalesPaise-knownCogsPaise-operatingExpensesPaise,
  sales,expenses,note:'Management view of delivered, paid/collected orders and recorded gross operating expenses. Inventory purchases are separate from COGS. Missing confirmed order-time costs keep profit unknown. GST totals are not a filing or tax invoice.',
  gstFilingReady:false,gstFilingBlocker:'GSTIN, business state, place of supply, invoice review and input-tax-credit treatment must be confirmed.'};
}
export function reportCSV(report){
 const cell=value=>{let text=String(value??'');if(typeof value!=='number'&&/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
 const rows=[['record_type','reference','date','amount_paise','included_gst_paise','confirmed_cogs_paise'],...report.sales.map(s=>['delivered_sale',s.orderId,s.date,s.totalPaise,s.includedGstPaise,s.cogsPaise]),...report.expenses.map(e=>['expense_'+e.category,e.reference,e.date,e.amount_paise,e.included_gst_paise,''])];
 return rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}

export async function handleOperations({db,req,res,path,url,actor,json,jsonBody,passwordHash}){
 if(req.method==='GET'&&path==='/api/admin/operations'){
  const report=managementReport(db,url.searchParams.get('from')||undefined,url.searchParams.get('to')||undefined);
  return json(res,200,{actor,report,suppliers:db.prepare('SELECT * FROM ops_suppliers ORDER BY name').all(),purchaseOrders:db.prepare('SELECT * FROM ops_purchase_orders ORDER BY created_at DESC LIMIT 200').all().map(x=>({...x,snapshot:JSON.parse(x.snapshot_json),snapshot_json:undefined})),coupons:db.prepare('SELECT * FROM ops_coupons ORDER BY code').all(),costs:db.prepare('SELECT * FROM ops_unit_costs').all(),products:db.prepare('SELECT id,name FROM products ORDER BY name').all(),staff:actor.role==='owner'?db.prepare('SELECT id,email,name,role,enabled,revision FROM ops_staff ORDER BY name').all():[],audit:db.prepare('SELECT actor,action,entity_type,entity_id,created_at FROM ops_audit ORDER BY rowid DESC LIMIT 100').all()});
 }
 if(req.method==='GET'&&path==='/api/admin/operations/reports')return json(res,200,managementReport(db,url.searchParams.get('from')||undefined,url.searchParams.get('to')||undefined));
 if(req.method==='GET'&&path==='/api/admin/operations/reports.csv'){const report=managementReport(db,url.searchParams.get('from')||undefined,url.searchParams.get('to')||undefined);res.statusCode=200;res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Disposition','attachment; filename="asryo-management-records.csv"');return res.end(reportCSV(report));}
 if(req.method==='POST'&&path==='/api/admin/operations/suppliers')return json(res,200,supplierSave(db,await jsonBody(req,8192),actor));
 if(req.method==='POST'&&path==='/api/admin/operations/purchase-orders')return json(res,201,purchaseCreate(db,await jsonBody(req,32*1024),actor));
 const purchase=path.match(/^\/api\/admin\/operations\/purchase-orders\/([a-f0-9-]{36})$/);if(req.method==='PATCH'&&purchase)return json(res,200,purchaseTransition(db,purchase[1],await jsonBody(req,8192),actor));
 if(req.method==='POST'&&path==='/api/admin/operations/expenses')return json(res,201,expenseCreate(db,await jsonBody(req,8192),actor));
 const expense=path.match(/^\/api\/admin\/operations\/expenses\/([a-f0-9-]{36})\/void$/);if(req.method==='POST'&&expense)return json(res,200,expenseVoid(db,expense[1],await jsonBody(req,8192),actor));
 if(req.method==='PUT'&&path==='/api/admin/operations/costs')return json(res,200,costSave(db,await jsonBody(req,8192),actor));
 if(req.method==='PUT'&&path==='/api/admin/operations/coupons')return json(res,200,couponSave(db,await jsonBody(req,8192),actor));
 if(req.method==='POST'&&path==='/api/admin/operations/staff')return json(res,200,await staffSave(db,await jsonBody(req,8192),actor,passwordHash));
 return json(res,404,{error:'Operations route not found.'});
}
