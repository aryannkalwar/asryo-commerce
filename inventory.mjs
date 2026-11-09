import {randomUUID,createHash} from 'node:crypto';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const at=()=>new Date().toISOString();
const canonical=input=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
export function initInventory(db){
 db.exec(`CREATE TABLE IF NOT EXISTS inventory_skus (
  product_id TEXT PRIMARY KEY REFERENCES products(id), parent_id TEXT NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL UNIQUE, size TEXT NOT NULL, colour TEXT NOT NULL, reorder_point INTEGER,
  created_at TEXT NOT NULL, UNIQUE(parent_id,size,colour)
 );
 CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), delta INTEGER NOT NULL,
  reason TEXT NOT NULL, reference TEXT NOT NULL, payload_hash TEXT, stock_after INTEGER,
  created_at TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS inventory_movements_product ON inventory_movements(product_id,created_at);`);
}
export function skuMetadata(db,id){return db.prepare('SELECT parent_id AS parentProductId,sku,size,colour,reorder_point AS reorderPoint FROM inventory_skus WHERE product_id=?').get(id)||null;}
export function hasSkus(db,id){return Boolean(db.prepare('SELECT 1 FROM inventory_skus WHERE parent_id=? LIMIT 1').get(id));}
export function recordStockMovement(db,{id,productId,delta,reason,reference,payloadHash=null}){
 const row=db.prepare('SELECT stock FROM products WHERE id=?').get(productId);
 db.prepare('INSERT INTO inventory_movements(id,product_id,delta,reason,reference,payload_hash,stock_after,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,productId,delta,reason,reference,payloadHash,row.stock,at());
}
export function createSku(db,input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'Enter SKU details.');
 const parentId=String(input.parentProductId||'');
 const sku=String(input.sku||'').trim().toUpperCase();
 const size=String(input.size||'').trim().toUpperCase();
 const colour=String(input.colour||'').trim().toUpperCase();
 const reorderPoint=input.reorderPoint??null;
 if(!/^[A-Z0-9][A-Z0-9_-]{1,47}$/.test(sku)||!/^[A-Z0-9][A-Z0-9 .-]{0,23}$/.test(size)||!/^[A-Z0-9][A-Z0-9 .-]{0,39}$/.test(colour))fail(400,'Enter a valid SKU, size and colour.');
 if(reorderPoint!==null&&(!Number.isSafeInteger(reorderPoint)||reorderPoint<0||reorderPoint>100000))fail(400,'Reorder threshold must be a whole number or blank.');
 db.exec('BEGIN IMMEDIATE');
 try{
  const existing=db.prepare('SELECT * FROM inventory_skus WHERE sku=? OR (parent_id=? AND size=? AND colour=?)').get(sku,parentId,size,colour);
  if(existing){
   if(existing.sku!==sku||existing.parent_id!==parentId||existing.size!==size||existing.colour!==colour||existing.reorder_point!==reorderPoint)fail(409,'SKU or size/colour already exists with different details.');
   db.exec('COMMIT');return {productId:existing.product_id,created:false};
  }
  const parent=db.prepare('SELECT * FROM products WHERE id=?').get(parentId);
  if(!parent)fail(404,'Parent product not found.');
  if(skuMetadata(db,parentId))fail(400,'Choose a parent design, not another SKU.');
  if(parent.active||parent.stock>0)fail(409,'Create sizes only from an unpublished design with no stock. Existing stock must be reconciled first.');
  if(db.prepare('SELECT COUNT(*) n FROM inventory_skus WHERE parent_id=?').get(parentId).n>=100)fail(400,'A design can contain at most 100 size/colour combinations.');
  const id=randomUUID();
  db.prepare("INSERT INTO products(id,name,category,type,image,description,price_paise,stock,active,options_json,updated_at) VALUES(?,?,?,?,?,?,NULL,NULL,0,'[]',?)").run(id,`${parent.name} · ${size} · ${colour}`,parent.category,parent.type,parent.image,parent.description,at());
  db.prepare('INSERT INTO inventory_skus VALUES(?,?,?,?,?,?,?)').run(id,parentId,sku,size,colour,reorderPoint,at());
  db.exec('COMMIT');return {productId:id,created:true};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
export function adjustStock(db,input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'Enter stock adjustment details.');
 const {productId,expectedStock,delta,reason,requestId}=input;
 const note=String(input.note||'').trim();
 if(typeof productId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(String(requestId||'')))fail(400,'A product and unique request ID are required.');
 if(!Number.isSafeInteger(delta)||Math.abs(delta)>100000||!(expectedStock===null||(Number.isSafeInteger(expectedStock)&&expectedStock>=0)))fail(400,'Stock values must be whole numbers; refresh before retrying.');
 if(!['receipt','count_correction','damage'].includes(reason)||note.length<3||note.length>250)fail(400,'Select a reason and enter a reference of 3–250 characters.');
 if((reason==='receipt'&&delta<=0)||(reason==='damage'&&delta>=0))fail(400,'Receipts must add stock; damage must remove stock.');
 const payloadHash=canonical([productId,expectedStock,delta,reason,note]);
 db.exec('BEGIN IMMEDIATE');
 try{
  const previous=db.prepare('SELECT payload_hash FROM inventory_movements WHERE id=?').get(requestId);
  if(previous){if(previous.payload_hash!==payloadHash)fail(409,'Request ID was already used for a different adjustment.');db.exec('COMMIT');return {replayed:true};}
  if(!skuMetadata(db,productId))fail(404,'SKU not found.');
  const row=db.prepare('SELECT stock FROM products WHERE id=?').get(productId);
  if(row.stock!==expectedStock)fail(409,'Stock changed. Refresh and reconcile the count before submitting again.');
  const next=(row.stock??0)+delta;
  if(!Number.isSafeInteger(next)||next<0||next>1000000)fail(400,'Adjustment would create an invalid stock count.');
  db.prepare('UPDATE products SET stock=?,updated_at=? WHERE id=?').run(next,at(),productId);
  recordStockMovement(db,{id:requestId,productId,delta,reason,reference:note,payloadHash});
  db.exec('COMMIT');return {replayed:false,stock:next};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
export function inventoryOverview(db){
 const skus=db.prepare(`SELECT p.id,p.name,p.price_paise AS pricePaise,p.stock,p.active,s.parent_id AS parentProductId,s.sku,s.size,s.colour,s.reorder_point AS reorderPoint FROM inventory_skus s JOIN products p ON p.id=s.product_id ORDER BY s.sku`).all();
 return {skus:skus.map(x=>({...x,alert:x.stock===null?'unconfirmed':x.stock===0?'out_of_stock':x.reorderPoint!==null&&x.stock<=x.reorderPoint?'low_stock':'ok'})),parents:db.prepare('SELECT id,name,stock,active FROM products WHERE id NOT IN (SELECT product_id FROM inventory_skus) ORDER BY name').all(),movements:db.prepare('SELECT m.id,s.sku,m.delta,m.reason,m.reference,m.stock_after AS stockAfter,m.created_at AS createdAt FROM inventory_movements m JOIN inventory_skus s ON m.product_id=s.product_id ORDER BY m.rowid DESC LIMIT 100').all()};
}
export async function handleInventory({db,req,res,path,json,jsonBody}){
 if(req.method==='GET'&&path==='/api/admin/inventory')return json(res,200,inventoryOverview(db));
 if(req.method==='POST'&&path==='/api/admin/inventory/skus'){const result=createSku(db,await jsonBody(req,8192));return json(res,result.created?201:200,result);}
 if(req.method==='POST'&&path==='/api/admin/inventory/stock')return json(res,200,adjustStock(db,await jsonBody(req,8192)));
 return json(res,404,{error:'Inventory route not found.'});
}
