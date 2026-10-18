const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = paise => paise == null ? 'Price to be announced' : new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(paise/100);
const previewPrice = paise => paise == null ? 'Price to be announced' : `Preview price · ${money(paise)}`;
const paymentLabel = order => order.paymentMethod === 'cash_on_delivery' ? (order.paymentStatus === 'collected' ? 'Cash on delivery · collected' : 'Cash on delivery · due on delivery') : 'Payment details unavailable';
const labels = {clothing:'Clothing & Ethnic Wear',jewellery:'Jewellery',art:'Art & Paintings','home-lifestyle':'Home & Lifestyle'};
const state = { products:[], status:{storeReady:false,assistant:false}, cart:{}, activeDialog:null, offlinePreview:!navigator.onLine };

function readCart(){try{return JSON.parse(localStorage.getItem('asryo_cart')||'{}')}catch{return {}}}
function saveCart(){localStorage.setItem('asryo_cart',JSON.stringify(state.cart));renderCart()}
async function api(path, options={}){
  const response=await fetch(path,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})},credentials:'same-origin'});
  if(response.headers.get('X-ASRYO-Offline')==='1')state.offlinePreview=true;
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error||'Something went wrong. Please try again.');
  return data;
}
function setDialog(dialog){if(state.activeDialog&&state.activeDialog!==dialog)state.activeDialog.close();state.activeDialog=dialog;if(dialog&&!dialog.open)dialog.showModal()}
function openDrawer(id){$('#overlay').hidden=false;const drawer=$(`#${id}`);drawer.hidden=false;requestAnimationFrame(()=>drawer.classList.add('open'));}
function closeDrawers(){for(const drawer of $$('.drawer')){drawer.classList.remove('open');setTimeout(()=>drawer.hidden=true,180)}$('#overlay').hidden=true}

function productCard(p){
  const available=p.active&&Number.isInteger(p.pricePaise)&&p.pricePaise>0&&Number.isInteger(p.stock)&&p.stock>0;
  return `<article class="product-card" data-product="${escapeHtml(p.id)}"><button class="product-visual" data-detail="${escapeHtml(p.id)}" aria-label="View ${escapeHtml(p.name)}"><img loading="lazy" src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}"><span class="preview-tag">${available?'AVAILABLE':'LAUNCH PREVIEW'}</span><span class="product-arrow">↗</span></button><div class="product-meta"><p>${escapeHtml(labels[p.category]||p.category)} <span>· ${escapeHtml(p.type)}</span></p><h3><button data-detail="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button></h3><div class="product-buy"><div class="price-stack">${p.pricePaise==null?'':`<span class="price-context">PREVIEW PRICE</span>`}<strong>${money(p.pricePaise)}</strong></div>${available?`<button class="add-button" data-add="${escapeHtml(p.id)}">Add to bag <span>+</span></button>`:'<span class="muted small">Coming soon</span>'}</div></div></article>`;
}
function renderProducts(){
  const term=$('#search').value.trim().toLowerCase();const category=$('#categoryFilter').value;
  const found=state.products.filter(p=>(category==='all'||p.category===category)&&(!term||`${p.name} ${p.category} ${p.type} ${p.description}`.toLowerCase().includes(term)));
  $('#resultCount').textContent=found.length ? `${found.length} ${found.length===1?'piece':'pieces'} in the edit` : '';
  $('#productGrid').innerHTML=found.length?found.map(productCard).join(''):`<div class="empty-state"><p class="kicker">THE NEXT CHAPTER</p><h3>New collection coming soon.</h3><p class="muted">We are refreshing ASRYO. Products are not available for browsing or ordering right now.</p></div>`;
}
function renderCart(){
  const items=state.products.filter(p=>state.cart[p.id]);const count=items.reduce((sum,p)=>sum+state.cart[p.id],0);$('#bagCount').textContent=String(count);
  if(!items.length){$('#cartItems').innerHTML='<div class="empty-state"><p class="kicker">A FRESH PAGE</p><h3>Your bag is empty.</h3><p class="muted">Browse the collection to find a piece that speaks to you.</p><a class="text-link" href="#collection">Explore the edit ↗</a></div>';$('#subtotal').textContent='₹0';$('#checkoutOpen').disabled=true;return}
  let total=0;$('#cartItems').innerHTML=items.map(p=>{const qty=state.cart[p.id];const unit=p.pricePaise||0;total+=unit*qty;return `<article class="cart-line"><img src="${escapeHtml(p.image)}" alt=""><div><h3>${escapeHtml(p.name)}</h3><p>${previewPrice(p.pricePaise)}</p><div class="quantity"><button data-qty="${escapeHtml(p.id)}" data-delta="-1" aria-label="Remove one ${escapeHtml(p.name)}">−</button><span>${qty}</span><button data-qty="${escapeHtml(p.id)}" data-delta="1" aria-label="Add one ${escapeHtml(p.name)}">+</button><button class="remove-item" data-remove="${escapeHtml(p.id)}">Remove</button></div></div></article>`}).join('');
  $('#subtotal').textContent=money(total);const ready=state.status.storeReady&&navigator.onLine&&!state.offlinePreview&&items.every(p=>p.active&&p.pricePaise&&p.stock>=state.cart[p.id]);$('#checkoutOpen').disabled=!ready;$('#cartStatus').textContent=state.offlinePreview?'Saved preview only. Reconnect to confirm availability and place an order.':ready?'Cash on delivery only. Shipping is calculated at checkout.':'Preview prices are for reference. Final prices and availability will be confirmed before orders open.';
}
function showDetails(id){const p=state.products.find(x=>x.id===id);if(!p)return;const available=p.active&&p.pricePaise>0&&p.stock>0;$('#productDetail').innerHTML=`<div class="detail-grid"><div class="detail-photo"><img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}"></div><div class="detail-copy"><p class="kicker">${escapeHtml(labels[p.category]||p.category)} / ${escapeHtml(p.type)}</p><h2>${escapeHtml(p.name)}</h2>${p.pricePaise==null?'':`<span class="price-context detail-price-context">PREVIEW PRICE · SUBJECT TO CONFIRMATION</span>`}<strong class="detail-price">${money(p.pricePaise)}</strong><p>${escapeHtml(p.description||'This piece is part of the ASRYO launch preview. Product specifications and availability are being confirmed.')}</p><p class="small muted">${available?`${p.stock} available`:'Prices and availability will be confirmed before orders open.'}</p>${available?`<button class="button button-dark" data-add="${escapeHtml(p.id)}" data-close-detail>Add to bag <span>+</span></button>`:'<span class="preview-note">LAUNCH PREVIEW</span>'}</div></div>`;setDialog($('#productDialog'))}

async function load(){
  $('#year').textContent=String(new Date().getFullYear());
  state.offlinePreview=!navigator.onLine;
  const results=await Promise.allSettled([api('/api/products'),api('/api/status')]);
  if(results[0].status==='fulfilled')state.products=results[0].value.products;
  if(results[1].status==='fulfilled')state.status=results[1].value;
  state.offlinePreview=state.offlinePreview||!navigator.onLine||results.some(result=>result.status==='rejected');
  state.cart=state.status.storeReady ? readCart() : {};
  const open=Boolean(state.status.storeReady && !state.offlinePreview);
  $('#announceStatus').textContent='New collection coming soon';
  $('#heroAvailability').textContent='Shopping is temporarily unavailable while we prepare the next collection.';
  $('#checkoutUnavailable').hidden=open;
  $('#checkoutForm').hidden=!open;
  if(open){$('#announceStatus').textContent='Cash on delivery only';$('#heroAvailability').textContent='Thoughtful finds, ready to be yours.';$('#catalogIntro').textContent='Explore the ASRYO collection across clothing, jewellery, art and home.';$('#cartStatus').textContent='Cash on delivery only. Shipping is calculated at checkout.';}
  else $('#catalogIntro').textContent='Our new ASRYO collection is coming soon. Products are temporarily unavailable.';
  const contacts=[];if(state.status.supportPhone)contacts.push(`Call ASRYO at ${state.status.supportPhone}`);if(state.status.supportEmail)contacts.push(`email ${state.status.supportEmail}`);if(contacts.length)$('#supportLine').textContent=`Questions? ${contacts.join(' or ')}.`;
  $('#aiDisclosure').textContent=state.status.assistant?'Your question is sent to OpenAI to prepare a shopping reply. Please do not include payment details or sensitive personal information.':'Your message stays on this site while the assistant is in preview mode.';
  renderProducts();renderCart();
}

document.addEventListener('click',async event=>{
  const detail=event.target.closest('[data-detail]');if(detail){showDetails(detail.dataset.detail);return}
  const add=event.target.closest('[data-add]');if(add){const p=state.products.find(x=>x.id===add.dataset.add);if(p&&p.active&&p.pricePaise>0&&p.stock>0){state.cart[p.id]=Math.min(10,(state.cart[p.id]||0)+1);saveCart();if(add.hasAttribute('data-close-detail'))$('#productDialog').close();openDrawer('cartDrawer')}return}
  const qty=event.target.closest('[data-qty]');if(qty){const id=qty.dataset.qty;const next=(state.cart[id]||0)+Number(qty.dataset.delta);if(next<=0)delete state.cart[id];else state.cart[id]=Math.min(10,next);saveCart();return}
  const remove=event.target.closest('[data-remove]');if(remove){delete state.cart[remove.dataset.remove];saveCart();return}
  if(event.target.closest('.cart-open')){openDrawer('cartDrawer');return}
  if(event.target.closest('.account-open')){await showAccount();return}
  if(event.target.closest('[data-close]')){if(event.target.closest('dialog'))event.target.closest('dialog').close();else closeDrawers();return}
  if(event.target.id==='overlay'){closeDrawers();return}
  const category=event.target.closest('[data-category-link]');if(category){$('#categoryFilter').value=category.dataset.categoryLink;renderProducts();return}
  if(event.target.id==='clearSearch'){$('#search').value='';$('#categoryFilter').value='all';renderProducts()}
});
if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{});
window.addEventListener('offline',()=>{state.offlinePreview=true;$('#announceStatus').textContent='Offline preview · reconnect to confirm current details';$('#checkoutUnavailable').hidden=false;$('#checkoutForm').hidden=true;renderCart()});
window.addEventListener('online',()=>load());
$('#search').addEventListener('input',renderProducts);$('#categoryFilter').addEventListener('change',renderProducts);
$('#checkoutOpen').addEventListener('click',()=>setDialog($('#checkoutDialog')));
$('#assistantOpen').addEventListener('click',()=>openDrawer('assistantDrawer'));

$('#checkoutForm').addEventListener('submit',async event=>{
  event.preventDefault();const submit=event.currentTarget.querySelector('button[type="submit"]');const form=new FormData(event.currentTarget);const message=$('#checkoutMessage');message.textContent='Placing your cash-on-delivery order…';submit.disabled=true;
  const payload={email:form.get('email'),phone:form.get('phone'),address:{name:form.get('name'),line1:form.get('line1'),city:form.get('city'),region:form.get('region'),postalCode:form.get('postalCode'),country:form.get('country')},items:Object.entries(state.cart).map(([id,quantity])=>({id,quantity}))};
  try{const order=await api('/api/checkout/orders',{method:'POST',body:JSON.stringify(payload)});if(order.paymentMethod!=='cash_on_delivery')throw new Error('This store accepts cash on delivery only.');state.cart={};saveCart();message.textContent=`Order placed. Pay ${money(order.amountPaise)} in cash when it is delivered. Save this private tracking link: `;const link=document.createElement('a');link.href=`/track.html?id=${encodeURIComponent(order.orderId)}&token=${encodeURIComponent(order.trackingToken)}`;link.textContent='Track order';message.append(link);}
  catch(error){message.textContent=error.message;submit.disabled=false}
});

async function showAccount(){const box=$('#accountContent');box.innerHTML='<p class="muted">Loading your account…</p>';setDialog($('#accountDialog'));try{const user=await api('/api/auth/me');await renderAccount(user)}catch{renderSignIn()}}
function renderSignIn(){
  $('#accountContent').innerHTML=`<div class="account-notice"><p>Create an account to keep your order details together. We verify your email before sign-in.</p></div><form id="loginForm" class="stack-form"><h3>Sign in</h3><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="button button-dark full">Sign in <span>↗</span></button><p class="form-message" role="status"></p></form><details class="register-details"><summary>Create an account</summary><form id="registerForm" class="stack-form"><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password (12+ characters)<input name="password" type="password" minlength="12" autocomplete="new-password" required></label><button class="button button-outline full">Create account</button><p class="form-message" role="status"></p></form></details>`;
  $('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const form=new FormData(e.currentTarget);const msg=$('.form-message',e.currentTarget);try{await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:form.get('email'),password:form.get('password')})});await renderAccount(await api('/api/auth/me'))}catch(error){msg.textContent=error.message}});
  $('#registerForm').addEventListener('submit',async e=>{e.preventDefault();const form=new FormData(e.currentTarget);const msg=$('.form-message',e.currentTarget);try{const result=await api('/api/auth/register',{method:'POST',body:JSON.stringify({email:form.get('email'),password:form.get('password')})});msg.textContent=result.message}catch(error){msg.textContent=error.message}});
}
async function renderAccount(user){
  const {orders=[]}=await api('/api/account/orders');$('#accountContent').innerHTML=`<div class="account-user"><p class="kicker">SIGNED IN</p><p>${escapeHtml(user.email)}</p><button id="logoutButton" class="text-link" type="button">Sign out ↗</button></div><div class="account-orders"><h3>Your orders</h3>${orders.length?orders.map(o=>`<article class="order-card"><div><strong>${escapeHtml(o.id.slice(0,8).toUpperCase())}</strong><span>${escapeHtml(o.status.replaceAll('_',' '))}</span></div><p>${money(o.totalPaise)} · ${new Date(o.createdAt).toLocaleDateString('en-IN')}</p><p>${escapeHtml(paymentLabel(o))}</p></article>`).join(''):'<p class="muted">Your orders will appear here.</p>'}</div>`;
  $('#logoutButton').addEventListener('click',async()=>{await api('/api/auth/logout',{method:'POST',body:'{}'});renderSignIn()});
}

$('#assistantForm').addEventListener('submit',async event=>{
  event.preventDefault();const input=$('#assistantQuestion');const text=input.value.trim();if(!text)return;const messages=$('#assistantMessages');messages.insertAdjacentHTML('beforeend',`<div class="user-bubble">${escapeHtml(text)}</div>`);input.value='';const waiting=document.createElement('div');waiting.className='assistant-bubble';waiting.textContent='One moment…';messages.append(waiting);messages.scrollTop=messages.scrollHeight;
  try{const result=await api('/api/assistant',{method:'POST',body:JSON.stringify({question:text})});waiting.textContent=result.answer+(result.suggestions?.length?` ${result.suggestions.join(' · ')}`:'')}catch(error){waiting.textContent=error.message}messages.scrollTop=messages.scrollHeight;
});

$('#trackingForm').addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const result=$('#trackingResult');result.textContent='Looking up your order…';try{const data=await api(`/api/orders/track?id=${encodeURIComponent(form.get('id'))}&token=${encodeURIComponent(form.get('token'))}`);result.innerHTML=`<div class="tracking-card"><p class="kicker">${escapeHtml(data.order.id.slice(0,8).toUpperCase())}</p><h3>${escapeHtml(data.order.status.replaceAll('_',' '))}</h3><p>${escapeHtml(paymentLabel(data.order))}</p><p>${data.items.map(x=>`${escapeHtml(x.name)} × ${x.quantity}`).join('<br>')}</p></div>`}catch(error){result.textContent=error.message}});

// Verify links may return visitors from the confirmation email to this dialog.
if(new URLSearchParams(location.search).get('verified')==='1')showAccount();
load();

