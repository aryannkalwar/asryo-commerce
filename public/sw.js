// ASRYO offline support is strictly for PUBLIC product previews.
// Never store owner, manufacturing, orders, account details or private APIs in browser caches.
const CACHE_PREFIX='asryo-';
const SHELL_CACHE='asryo-public-shell-v10';
const DATA_CACHE='asryo-public-data-v4';
const ASSET_CACHE='asryo-public-assets-v10';
const PUBLIC_PAGES=new Set([
 '/','/index.html','/offline.html','/about.html','/policies.html',
 '/speed-division.html','/dream-future.html','/shadowbound.html',
 '/raven-collection.html','/design-archive.html','/beyond-ordinary.html',
 '/concept-visuals.html','/red-sun-002.html','/celestial-001.html'
]);
const PRIVATE_PATHS=new Set([
 '/admin.js','/admin.css','/inventory.js','/admin','/admin.html','/workspace','/workspace.html',
 '/fashion-os','/dashboard','/dashboard.html',
 '/design-studio','/design-studio.html','/design-studio.js','/design-studio.css','/studio-render.js','/studio','/operations','/operations.html',
 '/manufacturing','/team','/team.html',
 '/track.html','/unsubscribe.html','/early-access-confirmed.html'
]);
const PUBLIC_DATA=new Set(['/api/status','/api/products']);
const SHELL=[
 '/','/offline.html','/style.css','/editorial.css?v=asryo20-20261107','/editorial.js?v=asryo20-20261107',
 '/luxury.css?v=dream-future-20261018','/speed.css?v=image-fit-20261019',
 '/product.css?v=image-fit-20261019','/product-page.js?v=launch-readiness-2',
 '/app.js?v=editorial-20261107','/manifest.webmanifest',
 '/asryo-mark.svg','/brand.css?v=black-emblem-20261024',
 '/assets/asryo-black-monogram.webp','/assets/asryo-black-favicon.png',
 '/assets/asryo-metallic-wordmark.webp',
 '/speed-division.html','/dream-future.html','/shadowbound.html',
 '/assets/asryo-speed-division-front.webp','/assets/asryo-dream-front.webp',
 '/assets/shadowbound-front.webp'
];

const isPublicResponse=response=>response?.ok && response.type==='basic'
  && !/(private|no-store)/i.test(response.headers.get('cache-control')||'');

async function cacheOne(cache,path){
 try{
  const response=await fetch(path,{cache:'reload',credentials:'omit'});
  if(isPublicResponse(response))await cache.put(path,response.clone());
  return response;
 }catch{return null}
}
async function prime(){
 const shell=await caches.open(SHELL_CACHE);
 await Promise.allSettled(SHELL.map(path=>cacheOne(shell,path)));
 const data=await caches.open(DATA_CACHE);
 for(const path of PUBLIC_DATA){
  try{const response=await fetch(path,{cache:'reload',credentials:'omit'});if(response.ok)await data.put(path,response.clone())}catch{}
 }
}
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{await prime();await self.skipWaiting()})());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>name.startsWith(CACHE_PREFIX)
   && ![SHELL_CACHE,DATA_CACHE,ASSET_CACHE].includes(name))
   .map(name=>caches.delete(name)));
  await self.clients.claim();
 })());
});
async function networkFirstData(request){
 const cache=await caches.open(DATA_CACHE);
 try{
  const response=await fetch(request);
  if(response.ok)await cache.put(request,response.clone());
  return response;
 }catch{
  const stored=await cache.match(request);
  if(!stored)throw Error('Public preview data unavailable offline');
  const headers=new Headers(stored.headers);headers.set('X-ASRYO-Offline','1');
  return new Response(stored.body,{status:stored.status,statusText:stored.statusText,headers});
 }
}
async function networkFirstPage(request){
 try{
  const response=await fetch(request);
  if(isPublicResponse(response)){
   const cache=await caches.open(SHELL_CACHE);
   await cache.put(request,response.clone());
  }
  return response;
 }catch{return await caches.match(request)||await caches.match('/offline.html')}
}
async function cacheFirstAsset(request){
 const saved=await caches.match(request);if(saved)return saved;
 const response=await fetch(request);
 if(isPublicResponse(response)){
  const cache=await caches.open(ASSET_CACHE);
  await cache.put(request,response.clone());
 }
 return response;
}
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin)return;
 const path=url.pathname;

 // Do not intercept private apps, any non-public APIs, or personal-token URLs.
 if(PRIVATE_PATHS.has(path) || path.startsWith('/api/')&&!PUBLIC_DATA.has(path)
    || path.startsWith('/src-internal/') || url.searchParams.has('token'))return;

 if(PUBLIC_DATA.has(path) && !url.search){
  event.respondWith(networkFirstData(request));return;
 }
 if(request.mode==='navigate'){
  if(!PUBLIC_PAGES.has(path) || url.search)return;
  event.respondWith(networkFirstPage(request));return;
 }
 if(['image','style','script','font','manifest'].includes(request.destination)){
  if(!path.startsWith('/assets/')&&!/\.(css|js|webmanifest|svg|png|webp|avif|ico|jpg|jpeg|woff2?)$/i.test(path))return;
  event.respondWith(cacheFirstAsset(request).catch(()=>request.destination==='image'
    ?new Response('',{status:404,statusText:'Image unavailable offline'}):Response.error()));
 }
});
