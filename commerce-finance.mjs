// ASRYO unit economics. INR values are stored in paise.
// Illustrative model, not a GST assessment or tax filing.
const fields=['fabric','printing','packaging','inbound','shipping','platform','payment','marketing','returnHandling'];
const allowed=new Set([...fields,'gstBps','returnBps']);
export function validateProfile(input){
 if(!input||typeof input!=='object'||Array.isArray(input))return {error:'Invalid profile'};
 const p={};
 for(const key of allowed){
  const n=Number(input[key]);
  if(!Number.isSafeInteger(n)||n<0||n>(key.endsWith('Bps')?10000:100000000))return {error:'Invalid value for '+key};
  p[key]=n;
 }
 return {value:p};
}
export function unitEconomics(pricePaise,input){
 if(!Number.isSafeInteger(pricePaise)||pricePaise<0||pricePaise>100000000)throw Error('Invalid price');
 const parsed=validateProfile(input);if(parsed.error)throw Error(parsed.error);
 const c=parsed.value;
 const cogs=c.fabric+c.printing+c.packaging+c.inbound;
 const costs=c.shipping+c.platform+c.payment+c.marketing;
 const tax=Math.round(pricePaise*c.gstBps/(10000+c.gstBps));
 const contribution=pricePaise-tax-cogs-costs;
 const returnReserve=Math.round(c.returnHandling*c.returnBps/10000);
 return {
  cogsPaise:cogs,otherCostPaise:costs,illustrativeOutputGstPaise:tax,
  contributionOnSuccessfulSalePaise:contribution,
  expectedReturnHandlingPaise:returnReserve,
  contributionAfterHandlingReservePaise:contribution-returnReserve,
  marginPct:pricePaise?Math.round(contribution/pricePaise*10000)/100:null,
  note:'Illustrative retained-sale margin only. Does not model refunds, input tax credit, marketplace fee changes, GST filings or actual RTO losses.'
 };
}
export const emptyProfile=()=>Object.fromEntries([...fields,'gstBps','returnBps'].map(k=>[k,0]));
function init(db){
 db.exec(`CREATE TABLE IF NOT EXISTS asryo_cost_profiles(
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  assumptions_json TEXT NOT NULL,updated_at TEXT NOT NULL)`);
}
export async function handleFinance({db,req,res,path,json,jsonBody}){
 init(db);
 if(req.method==='GET'&&path==='/api/admin/finance/products'){
  const rows=db.prepare(`SELECT p.id,p.name,p.category,p.type,p.price_paise,p.active,p.stock,c.assumptions_json,c.updated_at
   FROM products p LEFT JOIN asryo_cost_profiles c ON c.product_id=p.id ORDER BY p.name LIMIT 500`).all();
  return json(res,200,{products:rows.map(p=>{
   const costs=p.assumptions_json?JSON.parse(p.assumptions_json):null;
   return {id:p.id,name:p.name,category:p.category,type:p.type,pricePaise:p.price_paise,
    stock:p.stock,active:!!p.active,profile:costs,
    economics:costs&&p.price_paise!=null?unitEconomics(p.price_paise,costs):null,
    updatedAt:p.updated_at};
  })});
 }
 const m=path.match(/^\/api\/admin\/finance\/products\/([a-zA-Z0-9._-]{1,100})$/);
 if(req.method==='PUT'&&m){
  if(!db.prepare('SELECT id FROM products WHERE id=?').get(m[1]))return json(res,404,{error:'Unknown product'});
  const parsed=validateProfile(await jsonBody(req,4096));
  if(parsed.error)return json(res,400,{error:parsed.error});
  db.prepare(`INSERT INTO asryo_cost_profiles(product_id,assumptions_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(product_id) DO UPDATE SET assumptions_json=excluded.assumptions_json,updated_at=excluded.updated_at`)
   .run(m[1],JSON.stringify(parsed.value),new Date().toISOString());
  return json(res,200,{ok:true,note:'Cost assumptions saved. No order, stock, price or tax information was modified.'});
 }
 return json(res,404,{error:'Finance resource not found'});
}
