import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {initializeStudio,validateDesign,validateArtwork,importApprovedProject,renderImportedProduct,handleStudio} from '../fashion-studio.mjs';
import {renderDesign} from '../public/studio-render.js';
const tinyPNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z7cAAAAASUVORK5CYII=';

export function sampleProject(){
 const layer=()=>({text:'ASRYO',ink:'#d4c4a8',artwork:'',x:300,y:290,width:160,rotation:0});
 return {name:'Sample graphic tee',design:{garment:'tshirt',color:'#202124',fabric:'',gsm:null,printMethod:'',notes:'Verify on a physical sample.',measurements:{chest:null,length:null,printWidth:null},sides:{front:layer(),back:layer()}}};
}
function database(){
 const db=new DatabaseSync(':memory:');
 db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,category TEXT,type TEXT,image TEXT,description TEXT,price_paise INTEGER,stock INTEGER,active INTEGER,options_json TEXT,updated_at TEXT);`);
 initializeStudio(db);return db;
}
async function request(db,path,method,input){
 let result,status;
 await handleStudio({db,req:{method},res:{},path:'/api/admin/designs'+path,json:(_,code,value)=>{status=code;result=value;},jsonBody:async()=>input});
 return {status,...result};
}
test('untrusted artwork and invalid positions are rejected; unknown fabric remains unknown',()=>{
 const parsed=validateDesign(sampleProject());assert.equal(parsed.design.gsm,null);assert.equal(parsed.design.fabric,'');
 assert.equal(validateArtwork(tinyPNG),tinyPNG,'valid embedded raster is accepted');
 for(const artwork of ['https://attacker.test/art.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,PHNjcmlwdD4=','data:image/png;base64,'+'A'.repeat(1400001)])assert.throws(()=>validateArtwork(artwork));
 const invalid=sampleProject();invalid.design.sides.front.x=Infinity;assert.throws(()=>validateDesign(invalid));
 assert.throws(()=>validateDesign({...sampleProject(),name:''}));
 const malicious=sampleProject();malicious.design.sides.front.text='<script>alert(1)</script>';
 const svg=renderDesign(validateDesign(malicious),'front');assert(!svg.includes('<script>'));assert(svg.includes('&lt;script&gt;'));
});
test('revision conflicts preserve saved design; edits return approvals to draft',async()=>{
 const db=database();try{
  const original=sampleProject();original.design.sides.front.artwork=tinyPNG;
  let p=(await request(db,'','POST',original)).project;
  const audit=db.prepare('SELECT snapshot_json FROM studio_history WHERE project_id=?').get(p.id).snapshot_json;
  assert(!audit.includes('base64,'),'audit history does not duplicate image payloads');
  assert.match(audit,/artworkSha256/,'audit retains an artwork fingerprint');
  await assert.rejects(()=>request(db,'/'+p.id,'PUT',{...p,revision:0}),e=>e.status===409);
  assert.equal((await request(db,'/'+p.id,'GET')).project.revision,1);
  await assert.rejects(()=>request(db,'/'+p.id+'/approve','POST',{revision:1}),e=>e.status===409);
  p=(await request(db,'/'+p.id+'/review','POST',{revision:p.revision})).project;
  p=(await request(db,'/'+p.id+'/approve','POST',{revision:p.revision})).project;
  assert.equal(p.status,'approved');
  p=(await request(db,'/'+p.id,'PUT',{...p,name:'Changed concept'})).project;
  assert.equal(p.status,'draft');
  const events=(await request(db,'/'+p.id+'/history','GET')).history;
  assert.deepEqual(events.map(x=>x.event),['saved','approved','submitted_for_review','created']);
 }finally{db.close();}
});
test('approved imports are idempotent, unpriced, unstocked, inactive and immutable',async()=>{
 const db=database();try{
  let p=(await request(db,'','POST',sampleProject())).project;
  assert.throws(()=>importApprovedProject(db,p.id,p.revision),e=>e.status===409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,0);
  p=(await request(db,'/'+p.id+'/review','POST',{revision:p.revision})).project;
  p=(await request(db,'/'+p.id+'/approve','POST',{revision:p.revision})).project;
  assert.throws(()=>importApprovedProject(db,p.id,p.revision-1),e=>e.status===409);
  const first=importApprovedProject(db,p.id,p.revision);assert.equal(first.created,true);
  const second=importApprovedProject(db,p.id,p.revision);assert.equal(second.created,false);assert.equal(second.productId,first.productId);
  const product=db.prepare('SELECT * FROM products').get();assert.equal(product.active,0);assert.equal(product.price_paise,null);assert.equal(product.stock,null);
  const original=renderImportedProduct(db,product.id);
  p.design.color='#ffffff';await request(db,'/'+p.id,'PUT',p);
  assert.equal(renderImportedProduct(db,product.id),original,'existing commerce artwork uses approved snapshot');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,1);
 }finally{db.close();}
});
