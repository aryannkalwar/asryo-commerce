const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=()=>document.getElementById('adminInventory');
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Inventory request failed');return data;}
export async function renderInventory(){
 box().textContent='Loading confirmed inventory…';
 try{
  const data=await api('/api/admin/inventory');
  const parents=data.parents.filter(p=>!p.active&&!(p.stock>0));
  const pending=data.skus.filter(s=>s.alert==='unconfirmed').length;
  const low=data.skus.filter(s=>['low_stock','out_of_stock'].includes(s.alert)).length;
  box().innerHTML=`<p role="status">${data.skus.length} size SKUs · ${pending} awaiting a confirmed count · ${low} stock alerts</p>
  <details><summary>Create a size / colour SKU</summary><p>Choose an unpublished design with no stock. Each combination is a separate cart/order line. Price and stock remain unconfirmed; creating a SKU does not open checkout or publish it. Artwork uses the parent’s approved snapshot.</p>
  <form id="skuCreate" class="stack-form"><label>Parent design<select name="parentProductId" required><option value="">Select a design</option>${parents.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
  <label>Unique SKU<input name="sku" maxlength="48" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,47}" required></label>
  <label>Size<input name="size" maxlength="24" required placeholder="Enter confirmed size"></label><label>Colour<input name="colour" maxlength="40" required placeholder="Enter confirmed colour"></label>
  <label>Low-stock threshold (optional)<input name="reorderPoint" type="number" min="0" max="100000" step="1" placeholder="Not set"></label>
  <button type="submit" class="button button-outline">Create unpublished SKU</button><p class="form-message" role="status"></p></form></details>
  <div>${data.skus.map(s=>`<article class="admin-order"><h2>${esc(s.sku)}</h2><p>${esc(s.name)}</p><p>Stock: <strong>${s.stock===null?'Not confirmed':s.stock}</strong> · ${esc(s.alert.replaceAll('_',' '))} · ${s.active?'Published':'Unpublished'} · Threshold: ${s.reorderPoint??'Not set'}</p>
  <form data-stock="${esc(s.id)}" class="stack-form"><label>Adjustment (units to add or remove)<input name="delta" type="number" min="-100000" max="100000" step="1" required></label>
  <label>Reason<select name="reason"><option value="receipt">Received stock</option><option value="count_correction">Physical count correction</option><option value="damage">Damaged stock</option></select></label>
  <label>Receipt / count reference<input name="note" minlength="3" maxlength="250" required></label>
  <p>${s.stock===null?'First adjustment establishes a confirmed count; enter 0 with a physical count reference if none are available.':'Enter a change, not the final count. Refresh if another order or adjustment changed stock.'}</p>
  <button type="submit" class="button button-outline">Confirm stock adjustment</button><p class="form-message" role="status"></p></form></article>`).join('')||'<p>No size SKUs created yet.</p>'}</div>
  <details><summary>Latest 100 stock movements</summary>${data.movements.map(m=>`<article class="admin-empty"><strong>${esc(m.sku)} · ${m.delta>0?'+':''}${m.delta}</strong><p>${esc(m.reason.replaceAll('_',' '))} · ${esc(m.reference)}</p><p>Stock after: ${m.stockAfter??'Unknown'} · ${esc(m.createdAt)}</p></article>`).join('')||'<p>No stock movements recorded.</p>'}</details>`;
  document.getElementById('skuCreate').addEventListener('submit',async event=>{
   event.preventDefault();const form=event.currentTarget;const f=new FormData(form);const msg=form.querySelector('[role=status]');const button=form.querySelector('button');button.disabled=true;
   try{const result=await api('/api/admin/inventory/skus',{...Object.fromEntries(f),reorderPoint:f.get('reorderPoint')===''?null:Number(f.get('reorderPoint'))});await renderInventory();box().prepend(Object.assign(document.createElement('p'),{textContent:result.created?'SKU created unpublished. Set its confirmed price in Products; record stock here.':'This SKU already exists. No duplicate was created.'}));}
   catch(error){msg.textContent=error.message;button.disabled=false;}
  });
  for(const form of box().querySelectorAll('[data-stock]')){
   let pendingBody=null,pendingKey=null;
   form.addEventListener('submit',async event=>{
    event.preventDefault();const f=new FormData(form),sku=data.skus.find(s=>s.id===form.dataset.stock),msg=form.querySelector('[role=status]'),button=form.querySelector('button');
    const input={productId:sku.id,expectedStock:sku.stock,delta:Number(f.get('delta')),reason:f.get('reason'),note:f.get('note')};
    const key=JSON.stringify(input);if(key!==pendingKey){pendingBody={...input,requestId:crypto.randomUUID()};pendingKey=key;}
    button.disabled=true;try{await api('/api/admin/inventory/stock',pendingBody);await renderInventory();}catch(error){msg.textContent=error.message;button.disabled=false;}
   });
  }
 }catch(error){box().textContent=error.message;}
}
