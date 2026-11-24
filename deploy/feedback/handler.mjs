const cookieName = '__Host-asryo-design-vote';
const ids = new Set(['speed-division','dream-future','shadowbound']);
const security = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'};
const json=(data,status=200,extra={})=>Response.json(data,{status,headers:{...security,'X-Robots-Tag':'noindex, nofollow',...extra}});
function visitor(req){const match=(req.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-asryo-design-vote=([0-9a-f-]{36})(?:;|$)/);return match&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(match[1])?match[1]:null;}
async function readInput(req){
  const reader=req.body?.getReader(); if(!reader)throw Error('Empty request');let bytes=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>1024){await reader.cancel();throw Error('Request too large');}chunks.push(value);}
  const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(body));
}
async function vote(req,env){
  const id=visitor(req), now=Math.floor(Date.now()/1000), cutoff=now-7776000;
  if(req.method==='GET'){
    const row=id?await env.FEEDBACK.prepare('SELECT design FROM design_preferences WHERE visitor_id = ? AND updated_at >= ?').bind(id,cutoff).first():null;
    return json({design:row?.design||null});
  }
  if(!['POST','DELETE'].includes(req.method))return json({error:'Method not allowed'},405,{'Allow':'GET, POST, DELETE'});
  if(req.headers.get('Origin')!=='https://asryo.com')return json({error:'Please submit from asryo.com.'},403);
  if(req.method==='DELETE'){
    if(id)await env.FEEDBACK.prepare('DELETE FROM design_preferences WHERE visitor_id = ?').bind(id).run();
    return json({ok:true},200,{'Set-Cookie':cookieName+'=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'});
  }
  if(!req.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return json({error:'Use JSON'},415);
  let body;try{body=await readInput(req);}catch{return json({error:'Invalid or oversized request'},400);}
  if(!body||!ids.has(body.design)||body.website)return json({error:'Choose one of the three concepts.'},400);
  const source=['linkedin','instagram','whatsapp','share','direct'].includes(body.source)?body.source:'other';
  const key=id||crypto.randomUUID();
  const results=await env.FEEDBACK.batch([
    env.FEEDBACK.prepare('DELETE FROM design_preferences WHERE updated_at < ?').bind(cutoff),
    env.FEEDBACK.prepare('INSERT INTO design_preferences (visitor_id, design, source, updated_at) SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM design_preferences) < 10000 OR EXISTS (SELECT 1 FROM design_preferences WHERE visitor_id = ?) ON CONFLICT(visitor_id) DO UPDATE SET design = excluded.design, source = excluded.source, updated_at = excluded.updated_at').bind(key,body.design,source,now,key)
  ]);
  if(!results[1].meta.changes)return json({error:'Feedback collection is currently full. Please try later.'},503);
  return json({ok:true,design:body.design},200,{'Set-Cookie':cookieName+'='+key+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=7776000'});
}
const invitation='<section class="editorial-section" id="design-vote" aria-labelledby="designVoteTitle"><p class="editorial-eyebrow">HELP SHAPE DROP 001</p><h2 id="designVoteTitle">Which design would you wear?</h2><p>Explore Speed Division, Dream Future and Shadowbound, then save your favourite. Design previews only; orders are not open.</p><a class="editorial-button editorial-button-light" href="/vote">Choose our first drop</a></section>';
export default {async fetch(req,env,ctx){
  const url=new URL(req.url),p=url.pathname;
  if(url.hostname!=='asryo.com')return storefront.fetch(req,env,ctx);
  try{
    if(Object.hasOwn(assets,p)&&['GET','HEAD'].includes(req.method))return new Response(req.method==='HEAD'?null:Uint8Array.from(atob(assets[p]),c=>c.charCodeAt(0)),{headers:{...security,'Content-Type':'image/webp','Cache-Control':'public, max-age=86400'}});
    if(p==='/api/design-vote')return await vote(req,env);
    if(Object.hasOwn(pages,p)){
      if(!['GET','HEAD'].includes(req.method))return new Response('Method not allowed',{status:405,headers:{...security,Allow:'GET, HEAD'}});
      return new Response(req.method==='HEAD'?null:pages[p],{headers:{...security,'Content-Type':p.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8','X-Robots-Tag':p.endsWith('.js')?'noindex':'index, follow, max-image-preview:large'}});
    }
    if(p==='/sitemap.xml'&&['GET','HEAD'].includes(req.method))return new Response(req.method==='HEAD'?null:'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://asryo.com/</loc></url><url><loc>https://asryo.com/about.html</loc></url><url><loc>https://asryo.com/vote</loc></url></urlset>',{headers:{...security,'Content-Type':'application/xml; charset=utf-8'}});
    const response=await storefront.fetch(req,env,ctx);
    if(p==='/'&&req.method==='GET'&&response.ok){
      return new HTMLRewriter()
        .on('#featured',{element(e){e.before(invitation,{html:true});}})
        .on('#early-access',{element(e){e.setInnerContent('<div class="editorial-early-copy"><p class="editorial-eyebrow">YOUR POINT OF VIEW</p><h2>Help shape the first drop.</h2><p>Save a design preference without providing your email. This is informal research, not an order or newsletter signup.</p><a class="editorial-button editorial-button-light" href="/vote">Choose your favourite</a></div>',{html:true});}})
        .on('a[href="#early-access"]',{element(e){e.setAttribute('href','/vote');e.setInnerContent('Choose the first drop');}})
        .transform(response);
    }
    return response;
  }catch(error){console.error(JSON.stringify({event:'feedback_failure',path:p,name:error.name}));return json({error:'Feedback is temporarily unavailable. Please try again later.'},503);}
}};
