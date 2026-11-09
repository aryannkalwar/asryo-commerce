import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const source=readFileSync(fileURLToPath(new URL('../public/sw.js',import.meta.url)),'utf8');
const handlers={};
const cached={
  match:async()=>null,put:async()=>{}
};
const scope={
  URL,Headers,Response,Set,Promise,Error,console,
  fetch:async()=>new Response('ok',{status:200,headers:{'content-type':'text/html'}}),
  caches:{open:async()=>cached,match:async()=>null,keys:async()=>[],delete:async()=>true},
  self:{location:{origin:'https://asryo.com'},addEventListener:(name,handler)=>{handlers[name]=handler},skipWaiting:async()=>{},clients:{claim:async()=>{}}},
};
vm.runInNewContext(source,scope,{filename:'public/sw.js'});
assert.equal(typeof handlers.fetch,'function');
const pending=[];
function intercepted(path,mode='navigate',destination='document'){
  let received=false;
  const request={url:new URL(path,'https://asryo.com').href,method:'GET',mode,destination};
  handlers.fetch({request,respondWith(p){received=true;pending.push(Promise.resolve(p))}});
  return received;
}
for(const path of ['/design-studio','/design-studio.html','/api/admin/designs','/workspace','/studio','/fashion-os','/manufacturing','/admin',
 '/unsubscribe.html?token=private','/track.html','/api/control?action=state',
 '/api/team?action=status','/api/admin/orders','/api/checkout/orders',
 '/api/creative?action=art&id=secret','/src-internal/control.js'])
 assert.equal(intercepted(path),false,'Private request intercepted by worker: '+path);
assert.equal(intercepted('/api/status','cors',''),true,'Public store status remains available offline');
for(const path of ['/design-studio.js','/design-studio.css','/studio-render.js'])
 assert.equal(intercepted(path,'cors','script'),false,'Private editor assets stay current and network-only');
assert.equal(intercepted('/api/products','cors',''),true,'Public catalog remains available offline');
assert.equal(intercepted('/','navigate','document'),true,'Public homepage remains available offline');
assert.equal(intercepted('/assets/asryo-speed-division-front.webp','cors','image'),true,'Public design image may be cached');
assert.equal(intercepted('/policies.html','navigate','document'),true,'Public policy page may be cached');
assert.equal(intercepted('/non-public-page.html','navigate','document'),false,'Unknown pages are network-only');
await Promise.allSettled(pending);
console.log('ASRYO PWA cache: public preview resources cacheable; private routes and APIs bypassed.');
