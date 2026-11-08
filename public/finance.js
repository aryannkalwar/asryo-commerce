// Client-side ASRYO unit economics calculator; no customer data is handled.
const keys=['fabric','printing','packaging','inbound','shipping','platform','payment','marketing','returnHandling'];
const $=id=>document.getElementById(id);
const rate=key=>Math.round(Number($(key).value)*100);
const paise=key=>Math.round(Number($(key).value)*100);
const money=n=>'₹'+(n/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const state={products:[],authenticated:false};
function calculate(){
 try{
  const price=paise('price');const gst=rate('gstBps');const returns=rate('returnBps');
  const values=keys.map(k=>paise(k));
  if(![price,gst,returns,...values].every(Number.isSafeInteger)||[price,gst,returns,...values].some(n=>n<0)||gst>10000||returns>10000)throw Error('Use valid nonnegative amounts and rates from 0 to 100%.');
  const cogs=values.slice(0,4).reduce((a,b)=>a+b,0);
  const other=values.slice(4,8).reduce((a,b)=>a+b,0);
  const tax=Math.round(price*gst/(10000+gst));
  const handling=Math.round(values[8]*returns/10000);
  const success=price-tax-cogs-other;
  const outputs={
   'out-price':money(price),'out-tax':money(tax),'out-cogs':money(cogs),'out-other':money(other),
   'out-return':money(handling),'out-success':money(success),
   'out-total':money(success-handling),'out-margin':price?(100*success/price).toFixed(2)+'%':'—'
  };
  Object.entries(outputs).forEach(([id,value])=>$(id).textContent=value);
  $('status').textContent=state.authenticated?'Ready: calculations are local until you save.':'Scenario calculator works offline; sign in at /admin to save.';
 }catch(error){$('status').textContent=error.message;}
}
function profile(){
 return Object.fromEntries([...keys,'gstBps','returnBps'].map(k=>[k,k.endsWith('Bps')?rate(k):paise(k)]));
}
function apply(profile,price){
 for(const k of keys)$(k).value=((profile?.[k]??0)/100).toFixed(2);
 for(const k of ['gstBps','returnBps'])$(k).value=((profile?.[k]??0)/100).toFixed(2);
 if(Number.isInteger(price)&&price>=0)$('price').value=(price/100).toFixed(2);
 calculate();
}
async function load(){
 try{
  const r=await fetch('/api/admin/finance/products',{credentials:'same-origin',cache:'no-store'});
  if(!r.ok)throw Error(r.status===401||r.status===403?'Admin login required.':'Cost records unavailable.');
  const data=await r.json();state.products=data.products||[];state.authenticated=true;
  const sel=$('product');
  for(const p of state.products){const opt=document.createElement('option');opt.value=p.id;opt.textContent=p.name+(p.profile?' · costs saved':'');sel.append(opt);}
  $('status').textContent='Connected to your private ASRYO product records.';
  updateSave();
 }catch(error){state.authenticated=false;$('status').textContent=error.message+' Manual calculator is available.';}
}
function updateSave(){$('save').disabled=!(state.authenticated&&$('product').value);}
$('product').addEventListener('change',()=>{
 const p=state.products.find(x=>x.id===$('product').value);
 if(p){if(p.profile)apply(p.profile,p.pricePaise);else if(Number.isSafeInteger(p.pricePaise))$('price').value=(p.pricePaise/100).toFixed(2);}
 updateSave();calculate();
});
$('save').addEventListener('click',async()=>{
 if(!state.authenticated||!$('product').value)return;
 const button=$('save');button.disabled=true;
 try{
  const values=profile();
  const response=await fetch('/api/admin/finance/products/'+encodeURIComponent($('product').value),{
   method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Unable to save costs.');
  const existing=state.products.find(p=>p.id===$('product').value);if(existing)existing.profile=values;
  $('status').textContent='Saved assumptions for '+existing?.name+'. Store prices and stock were not altered.';
 }catch(error){$('status').textContent=error.message;}
 finally{updateSave();}
});
$('reset').addEventListener('click',()=>{for(const k of [...keys,'gstBps','returnBps'])$(k).value=0;calculate();});
for(const id of ['price',...keys,'gstBps','returnBps'])$(id).addEventListener('input',calculate);
calculate();load();
