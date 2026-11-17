import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const target='cloudflare-preview-dist';
if(existsSync(target))throw new Error('Preview output already exists; use a clean checkout.');
mkdirSync(target);
const pages=['index.html','store.html','about.html','policies.html','preorders.html','speed-division.html','dream-future.html','shadowbound.html','raven-collection.html','design-archive.html','beyond-ordinary.html','concept-visuals.html','red-sun-002.html','celestial-001.html','track.html','offline.html'];
const staticFiles=['style.css','editorial.css','editorial.js','app.js','product-page.js','brand.css','store.css','store.js','policies.js','preorders.js','product.css','shadowbound-gallery.js','concept-visuals.js','track.js','luxury.css','speed.css','asryo-mark.svg','manifest.webmanifest'];
for(const file of pages){
  let html=readFileSync(join('public',file),'utf8');
  html=html.replace(/<body(?:\s[^>]*)?>/i,m=>m+'<div role="status" style="background:#f5dfae;color:#181818;text-align:center;padding:12px;font:600 14px Arial,sans-serif">ASRYO HOSTING PREVIEW — ordering, sign-in and data collection are disabled.</div>');
  writeFileSync(join(target,file),html);
}
for(const file of staticFiles)if(existsSync(join('public',file)))cpSync(join('public',file),join(target,file));
cpSync('public/assets',join(target,'assets'),{recursive:true});
writeFileSync(join(target,'_worker.js'),`
const pages=new Set(['/shop','/oversized-t-shirts','/hoodies','/tracksuits','/new-arrivals','/collections','/product','/size-guide','/cart','/checkout','/account','/my-orders','/wishlist','/contact','/shipping-policy','/returns','/privacy','/terms']);
const json=(x,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(!['GET','HEAD'].includes(request.method))return json({error:'Preview only. Orders, accounts and data collection are disabled.'},503);
 if(url.pathname==='/healthz')return json({ok:true,mode:'hosting-preview',orders:false});
 if(url.pathname==='/api/status')return json({storeReady:false,availableProducts:0,assistant:false,accountVerification:false,businessName:'ASRYO'});
 if(url.pathname==='/api/products')return json({products:[]});
 if(url.pathname==='/api/storefront')return json({ready:false,methods:[],products:[],paymentMode:'disabled',accountVerification:false,policiesApproved:false,businessName:'ASRYO'});
 if(url.pathname==='/api/early-access/status')return json({enabled:false,acceptingInterest:false,emailVerificationAvailable:false,doubleOptIn:true});
 if(url.pathname.startsWith('/api/'))return json({error:'Unavailable during hosting preview'},503);
 if(pages.has(url.pathname))url.pathname='/store';
 const response=await env.ASSETS.fetch(new Request(url,request));
 const headers=new Headers(response.headers);
 headers.set('X-Robots-Tag','noindex, nofollow');
 headers.set('X-Content-Type-Options','nosniff');
 headers.set('Referrer-Policy','strict-origin-when-cross-origin');
 return new Response(response.body,{status:response.status,headers});
}};
`);
console.log('ASRYO public-only hosting preview built; no backend or customer records included.');
