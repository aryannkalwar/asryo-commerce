import {renderDesign,escapeXML} from './studio-render.js';
const $=id=>document.getElementById(id);
const makeLayer=()=>({text:'',ink:'#d4c4a8',artwork:'',x:300,y:290,width:160,rotation:0});
const blank=()=>({id:null,name:'Untitled ASRYO design',status:'draft',revision:0,design:{garment:'tshirt',color:'#202124',fabric:'',gsm:null,printMethod:'',notes:'',measurements:{chest:null,length:null,printWidth:null},sides:{front:{...makeLayer(),text:'ASRYO'},back:makeLayer()}}});
const state={project:blank(),side:'front',authenticated:false,role:null,busy:false,dirty:false,undo:[],redo:[],projects:[]};
const clone=value=>structuredClone(value);
const layer=()=>state.project.design.sides[state.side];
function message(value){$('message').textContent=value;}
async function api(path,options={}){
 const response=await fetch('/api/admin/designs'+path,{...options,credentials:'same-origin',cache:'no-store',headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok){if(response.status===401){state.authenticated=false;controls();}throw Error(data.error||'Studio request failed. Your unsaved design remains in this window.');}
 return data;
}
function controls(){
 const enabled=state.authenticated&&!state.busy;
 $('details').disabled=$('artwork-controls').disabled=!enabled;
 $('new-project').disabled=$('projects').disabled=!enabled;
 $('save').disabled=!enabled||!state.dirty;
 $('undo').disabled=!enabled||!state.undo.length;$('redo').disabled=!enabled||!state.redo.length;
 const saved=enabled&&state.project.id&&!state.dirty;
 $('review').disabled=!saved||state.project.status!=='draft';
 $('approve').disabled=!saved||!['owner','manager'].includes(state.role)||state.project.status!=='in_review';
 $('draft-sku').disabled=!saved||!['owner','manager'].includes(state.role)||state.project.status!=='approved';
 for(const id of ['export-front','export-back','export-pack','print-pack'])$(id).disabled=!saved;
 $('login-panel').hidden=state.authenticated;
 $('session').textContent=state.authenticated?(state.role||'Authorized staff')+' session verified':'Sign-in required · no project data loaded';
 $('project-status').textContent=state.dirty?'UNSAVED DRAFT':state.project.status.replaceAll('_',' ').toUpperCase();
 $('save-state').textContent=!state.authenticated?'Sign in to begin':state.busy?'Working…':state.dirty?'Unsaved changes':state.project.id?'Saved · revision '+state.project.revision:'New project';
 $('revision').textContent=state.project.id?'Revision '+state.project.revision+' · '+(state.project.updatedAt?new Date(state.project.updatedAt).toLocaleString('en-IN'):''):'New design · not saved';
}
function draw(){
 $('stage').innerHTML=renderDesign(state.project,state.side,true);
 for(const side of ['front','back']){$(side).classList.toggle('selected',side===state.side);$(side).setAttribute('aria-pressed',String(side===state.side));}
 for(const key of ['x','y','width','rotation'])$(key+'-value').textContent=layer()[key]+(key==='rotation'?'°':'');
 controls();
}
function populate(){
 const p=state.project,d=p.design,l=layer();
 $('name').value=p.name;
 for(const key of ['garment','color','fabric','gsm','printMethod','notes'])$(key).value=d[key]??'';
 for(const key of ['chest','length','printWidth'])$(key).value=d.measurements[key]??'';
 $('graphic-text').value=l.text;$('ink').value=l.ink;
 for(const key of ['x','y','width','rotation'])$(key).value=l[key];
 $('upload').value='';draw();
}
function checkpoint(){state.undo.push(clone(state.project));if(state.undo.length>15)state.undo.shift();state.redo=[];}
function edit(work){if(!state.authenticated||state.busy)return;checkpoint();work();state.dirty=true;draw();}
async function busy(work){
 if(state.busy)return;
 state.busy=true;controls();
 try{await work();}catch(error){message(error.message);}finally{state.busy=false;controls();}
}
async function refreshList(){
 const result=await api('');state.projects=result.projects;
 $('projects').replaceChildren(new Option('Choose a saved project',''),...result.projects.map(p=>new Option(p.name+' · '+p.status.replaceAll('_',' '),p.id)));
 $('projects').value=state.project.id||'';
 const match=state.projects.find(p=>p.id===state.project.id);
 $('sku-status').textContent=match?.productId?'Commerce draft linked: '+match.productId+'. Its approved artwork snapshot stays unchanged when this design is edited.':'Approved designs become unpublished commerce drafts. Confirm sizes, price and stock in Commerce before sale.';
}
async function showHistory(){
 $('history').replaceChildren();
 if(!state.project.id){const li=document.createElement('li');li.textContent='Save your first revision to begin.';$('history').append(li);return;}
 const result=await api('/'+state.project.id+'/history');
 for(const event of result.history){const li=document.createElement('li');li.textContent='r'+event.revision+' · '+event.event.replaceAll('_',' ')+' · '+new Date(event.at).toLocaleString('en-IN');$('history').append(li);}
}
function allowDiscard(){return !state.dirty||confirm('Discard the unsaved changes in this window?');}
$('new-project').addEventListener('click',()=>{if(!allowDiscard())return;state.project=blank();state.side='front';state.dirty=true;state.undo=[];state.redo=[];$('projects').value='';$('history').textContent='Save your first revision to begin.';message('New design. Add your artwork and save your first revision.');populate();});
$('projects').addEventListener('change',()=>{
 const id=$('projects').value;if(!id)return;
 if(!allowDiscard()){$('projects').value=state.project.id||'';return;}
 busy(async()=>{state.project=(await api('/'+id)).project;state.dirty=false;state.undo=[];state.redo=[];populate();await showHistory();await refreshList();message('Saved project loaded.');});
});
$('save').addEventListener('click',()=>busy(async()=>{
 const p=state.project;
 const result=await api(p.id?'/'+p.id:'',{method:p.id?'PUT':'POST',body:JSON.stringify(p)});
 state.project=result.project;state.dirty=false;state.undo=[];state.redo=[];populate();await refreshList();await showHistory();message('Revision '+state.project.revision+' saved. Editing an approved design returns it to draft for a new review.');
}));
for(const side of ['front','back'])$(side).addEventListener('click',()=>{state.side=side;populate();});
for(const key of ['name','garment','color','fabric','gsm','printMethod','notes'])$(key).addEventListener('input',()=>edit(()=>{
 if(key==='name')state.project.name=$(key).value;
 else state.project.design[key]=key==='gsm'?($(key).value===''?null:Number($(key).value)):$(key).value;
}));
for(const key of ['chest','length','printWidth'])$(key).addEventListener('input',()=>edit(()=>{state.project.design.measurements[key]=$(key).value===''?null:Number($(key).value);}));
for(const key of ['x','y','width','rotation'])$(key).addEventListener('input',()=>edit(()=>{layer()[key]=Number($(key).value);}));
$('graphic-text').addEventListener('input',()=>edit(()=>{layer().text=$('graphic-text').value;}));
$('ink').addEventListener('input',()=>edit(()=>{layer().ink=$('ink').value;}));
$('remove-art').addEventListener('click',()=>edit(()=>{layer().artwork='';}));
$('upload').addEventListener('change',()=>{
 const file=$('upload').files[0];if(!file)return;
 if(file.size>1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type)){message('Choose a PNG, JPEG or WebP image up to 1 MB.');$('upload').value='';return;}
 const target=state.side,project=state.project;
 const reader=new FileReader();reader.onload=async()=>{
  try{const image=new Image();image.src=reader.result;await image.decode();
   if(state.project!==project||!state.authenticated)return;
   edit(()=>{state.project.design.sides[target].artwork=reader.result;});message('Artwork added to '+target+'. Check its resolution before manufacturing.');
  }catch{message('This image could not be decoded. Choose another file.');}
 };reader.onerror=()=>message('The image could not be read.');reader.readAsDataURL(file);
});
for(const direction of ['undo','redo'])$(direction).addEventListener('click',()=>{
 const source=state[direction];if(!source.length)return;
 const target=state[direction==='undo'?'redo':'undo'];target.push(clone(state.project));
 // Undo changes the design, never rolls back server revision or approval state.
 const previous=source.pop();state.project={...state.project,name:previous.name,design:previous.design};state.dirty=true;populate();
});
let dragging=false;
$('stage').addEventListener('pointerdown',event=>{if(!state.authenticated||state.busy)return;checkpoint();dragging=true;$('stage').setPointerCapture(event.pointerId);});
function move(event){
 if(!dragging)return;
 const svg=$('stage').querySelector('svg');const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
 layer().x=Math.max(200,Math.min(400,Math.round(point.x)));layer().y=Math.max(180,Math.min(540,Math.round(point.y)));state.dirty=true;
 $('x').value=layer().x;$('y').value=layer().y;draw();
}
$('stage').addEventListener('pointermove',move);
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('stage').addEventListener(event,()=>{dragging=false;});
for(const action of ['review','approve','draft-sku'])$(action).addEventListener('click',()=>busy(async()=>{
 const result=await api('/'+state.project.id+'/'+action,{method:'POST',body:JSON.stringify({revision:state.project.revision})});
 if(result.project){state.project=result.project;populate();await showHistory();}
 await refreshList();message(action==='draft-sku'?(result.created?'Commerce draft created.':'Existing commerce draft found. No duplicate was created.')+' Confirm sample specifications, price and stock in Commerce.':action==='approve'?'This design revision is approved. You can now create its commerce draft.':'Saved design submitted for review. Inspect both views and sample notes before approving.');
}));
function download(path){const a=document.createElement('a');a.href='/api/admin/designs/'+state.project.id+'/'+path;a.download='';document.body.append(a);a.click();a.remove();}
for(const [button,path] of [['export-front','front.svg'],['export-back','back.svg'],['export-pack','techpack']])$(button).addEventListener('click',()=>download(path));
$('print-pack').addEventListener('click',()=>{
 const p=state.project,d=p.design;
 const rows=[['Project',p.name],['Revision / status',p.revision+' / '+p.status],['Garment',d.garment==='hoodie'?'Hoodie':'T-shirt'],['Fabric target',d.fabric||'Pending sample confirmation'],['Target GSM',d.gsm??'Pending'],['Print method',d.printMethod||'Pending test'],['Chest flat (cm)',d.measurements.chest??'Pending'],['Body length (cm)',d.measurements.length??'Pending'],['Print width (cm)',d.measurements.printWidth??'Pending']];
 $('print-sheet').innerHTML='<h1>ASRYO / SAMPLE WORKSHEET</h1><p>Design study, not a production-approved garment or CAD pattern. Verify actual fabric, sizing, artwork resolution, colour and wash performance on a physical sample.</p><div class="sketches">'+renderDesign(p,'front')+renderDesign(p,'back')+'</div><table>'+rows.map(([a,b])=>'<tr><th>'+escapeXML(a)+'</th><td>'+escapeXML(b)+'</td></tr>').join('')+'</table><p>'+escapeXML(d.notes||'No sampling notes recorded.')+'</p>';
 $('print-sheet').hidden=false;window.print();
});
window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
async function connect(){
 await busy(async()=>{await refreshList();const identity=await fetch('/api/admin/me',{credentials:'same-origin',cache:'no-store'});if(!identity.ok)throw Error('Staff session could not be verified.');state.role=(await identity.json()).role;state.authenticated=true;state.dirty=!state.project.id;populate();message('Workspace connected. Save a new project or load an existing design.');});
 fetch('/api/control',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json()).then(d=>{$('ai-status').textContent=d.aiConnected===true?'Fashion AI connected':'AI not configured · manual editor ready';}).catch(()=>{$('ai-status').textContent='AI status unavailable · manual editor ready';});
}
$('retry').addEventListener('click',connect);
populate();connect();
