// ASRYO editorial navigation. No third-party assets or tracking.
const toggle=document.getElementById('editorialMenuButton');
const menu=document.getElementById('editorialNav');

if(toggle&&menu){
  const setOpen=(open,returnFocus=false)=>{
    menu.classList.toggle('is-open',open);
    toggle.setAttribute('aria-expanded',String(open));
    toggle.setAttribute('aria-label',open?'Close navigation':'Open navigation');
    if(returnFocus)toggle.focus();
  };
  toggle.addEventListener('click',()=>{
    const opening=toggle.getAttribute('aria-expanded')!=='true';
    setOpen(opening);
    if(opening)menu.querySelector('a')?.focus();
  });
  menu.addEventListener('click',event=>{
    if(event.target.closest('a'))setOpen(false);
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&toggle.getAttribute('aria-expanded')==='true')setOpen(false,true);
  });
  document.addEventListener('click',event=>{
    if(toggle.getAttribute('aria-expanded')==='true'&&!menu.contains(event.target)&&!toggle.contains(event.target))setOpen(false);
  });
  window.addEventListener('resize',()=>{
    if(window.innerWidth>980&&toggle.getAttribute('aria-expanded')==='true')setOpen(false);
  });
}


// The commerce API is the source of truth; concept artwork is never treated as stock.
async function refreshApprovedEdit(){
  const section=document.getElementById('liveEdit');
  const grid=document.getElementById('liveEditGrid');
  const hero=document.getElementById('heroPrimary');
  const nav=document.getElementById('launchNav');
  if(!section||!grid||!hero||!nav)return;
  section.hidden=true;grid.replaceChildren();
  function setLink(link,label,href){
    link.href=href;link.replaceChildren(document.createTextNode(label+' '));
    const arrow=document.createElement('span');arrow.setAttribute('aria-hidden','true');arrow.textContent='↗';link.append(arrow);
  }
  setLink(hero,'Get early access','#early-access');setLink(nav,'Early access','#early-access');
  if(!navigator.onLine)return;
  try{
    const response=await fetch('/api/storefront',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)return;
    const store=await response.json();
    if(!store.ready||!Array.isArray(store.products)||!navigator.onLine)return;
    const seen=new Set();
    const products=store.products.filter(p=>{
      const group=p.variant?.parentProductId||p.id;
      const image=p.profile?.images?.[0];
      if(!p.purchasable||!p.id||!Number.isSafeInteger(p.pricePaise)||p.pricePaise<=0||typeof image!=='string'||!image.startsWith('/')||image.startsWith('//')||seen.has(group))return false;
      seen.add(group);return true;
    }).slice(0,6);
    if(!products.length)return;
    const currency=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:0,maximumFractionDigits:2});
    const el=(tag,cls,content)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(content!==undefined)node.textContent=content;return node;};
    for(const p of products){
      const href='/product?id='+encodeURIComponent(p.id);
      const card=el('article','editorial-product');
      const imageLink=el('a','editorial-product-image');imageLink.href=href;
      const image=el('img');image.src=p.profile.images[0];image.alt=p.name+' — approved product';image.loading='lazy';image.decoding='async';image.width=720;image.height=900;
      imageLink.append(image,el('span','editorial-product-badge',p.profile.mode==='preorder'?'PRE-ORDER':'READY STOCK'));
      const info=el('div','editorial-product-info'),details=el('div');
      details.append(el('span','',p.type||'ASRYO'),el('h3','',p.name),el('p','',currency.format(p.pricePaise/100)+' · incl. applicable GST'));
      const buy=el('a','','View product ↗');buy.href=href;info.append(details,buy);card.append(imageLink,info);grid.append(card);
    }
    section.hidden=false;
    setLink(hero,'Shop the drop','/shop');setLink(nav,'Shop now','/shop');
  }catch{/* Retain the honest pre-launch experience when the API is unavailable. */}
}
refreshApprovedEdit();
window.addEventListener('online',refreshApprovedEdit);
window.addEventListener('offline',refreshApprovedEdit);
