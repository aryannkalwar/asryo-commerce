/* ASRYO Drop 001 scalable illustration gallery.
 * These are original vector interpretations, NOT production photos or approved print files.
 * Keep ordering closed; never use this to assert garment or stock availability.
 */
'use strict';
const designs = [
 {id:'essential',name:'Essential',shade:'Jet Black',cloth:'#161718',ink:'#f5f3ed'},
 {id:'minimal',name:'Minimal',shade:'Off White',cloth:'#e8e4db',ink:'#30302e'},
 {id:'vision',name:'Vision',shade:'Washed Charcoal',cloth:'#444747',ink:'#f4f2ed'},
 {id:'ascend',name:'Ascend',shade:'Beige',cloth:'#cbbca6',ink:'#292925'},
 {id:'midnight',name:'Midnight',shade:'Navy',cloth:'#1f2b3a',ink:'#dee7f0'},
 {id:'rebel',name:'Rebel',shade:'Washed Brown',cloth:'#615045',ink:'#f3eade'},
 {id:'static',name:'Static',shade:'Steel Grey',cloth:'#697173',ink:'#eff1ec'},
 {id:'eclipse',name:'Eclipse',shade:'Olive Green',cloth:'#5b6245',ink:'#f0ecdf'},
 {id:'after-hours',name:'After Hours',shade:'Burgundy',cloth:'#512633',ink:'#f6dee0'},
 {id:'origin-limited',name:'Origin Limited',shade:'Bone White',cloth:'#e4dfd3',ink:'#282625'}
];
const txt=(x,y,value,color,size=20,spacing=5)=>'<text x="'+x+'" y="'+y+'" font-size="'+size+'" font-weight="700" letter-spacing="'+spacing+'" text-anchor="middle" fill="'+color+'" font-family="Arial,sans-serif">'+value+'</text>';
const path=(d,color,width=3,opacity=1)=>'<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="'+width+'" opacity="'+opacity+'" stroke-linecap="round"/>';
const disk=(x,y,r,color,opacity=1)=>'<circle cx="'+x+'" cy="'+y+'" r="'+r+'" fill="'+color+'" opacity="'+opacity+'"/>';
function graphic(d,side){
 const {id,ink,cloth}=d;
 if(side==='front'){
   const front={
     essential:txt(600,579,'ASRYO',ink,28,12),
     minimal:disk(600,578,20,ink)+txt(600,585,'A',cloth,17,1),
     vision:txt(600,579,'VISION',ink,23,7),
     ascend:disk(600,558,20,ink,.6)+path('M566 610 L596 573 L623 604 L651 574',ink,2),
     midnight:txt(600,575,'✦',ink,34,0)+txt(600,609,'MIDNIGHT',ink,15,4),
     rebel:txt(600,575,'REBEL',ink,28,6)+path('M533 594 L669 561',ink,3),
     static:Array.from({length:5},(_,i)=>path('M535 '+(550+i*12)+' Q600 '+(515+i*13)+' 675 '+(550+i*12),ink,2,.8)).join(''),
     eclipse:disk(603,570,25,ink)+'<circle cx="615" cy="557" r="22" fill="'+cloth+'"/>',
     'after-hours':txt(600,575,'AFTER HOURS',ink,21,5),
     'origin-limited':txt(600,573,'ASRYO',ink,23,8)+txt(600,610,'ORIGIN 001',ink,15,5)
   };return front[id]||'';
 }
 const title=txt(600,493,'ASRYO',ink,19,6);
 const caption=txt(600,1090,id.replaceAll('-',' ').toUpperCase(),ink,18,5);
 let back='';
 switch(id){
  case 'essential':
    back=path('M600 638 L600 948 M454 794 L746 794',ink,7)+'<circle cx="600" cy="792" r="100" fill="none" stroke="'+ink+'" opacity=".5" stroke-width="2"/>';break;
  case 'minimal':
    back=path('M390 944 L522 721 L571 830 L649 677 L806 944',ink,3)+path('M470 943 L552 806 L617 890 L677 793 L743 944',ink,2)+path('M405 960 L804 960',ink,2);break;
  case 'vision':
    back=Array.from({length:19},(_,i)=>'<rect x="'+(430+i*18)+'" y="'+(930-(i*59%222))+'" width="9" height="'+(i*59%222)+'" opacity="'+(.2+(i%4)*.18)+'" fill="'+ink+'"/>').join('')+txt(600,1020,'THE FUTURE IS A VIEW',ink,17,4);break;
  case 'ascend':
    back=disk(659,692,77,ink,.25)+path('M405 937 L538 714 L619 826 L702 696 L803 937',ink,4)+path('M469 937 L561 803 L616 878 L692 790 L755 937',ink,2)+txt(600,996,'KEEP MOVING UP',ink,17,3);break;
  case 'midnight':
    back='<rect x="423" y="633" width="356" height="350" fill="'+ink+'" opacity=".12"/>'+disk(682,721,45,ink,.75)+Array.from({length:6},(_,i)=>path('M420 '+(835+i*30)+' Q500 '+(706+i*20)+' 598 '+(831+i*24)+' T787 '+(817+i*20),ink,2,.45)).join('');break;
  case 'rebel':
    back=Array.from({length:7},(_,i)=>path('M440 '+(853+i*18)+' Q'+(555+i*9)+' '+(654+i*9)+' 767 '+(687+i*29),ink,7-i*.5,.78)).join('')+txt(600,1016,'NO RULES / NO LIMITS',ink,18,3);break;
  case 'static':
    back=Array.from({length:13},(_,i)=>path('M407 '+(675+i*22)+' C505 '+(616+i*20)+' 668 '+(785+i*13)+' 804 '+(686+i*21),ink,2,.3+(i%4)*.15)).join('')+txt(600,1030,'STAY IN MOTION',ink,18,4);break;
  case 'eclipse':
    back=disk(610,795,122,ink,.85)+'<circle cx="655" cy="749" r="113" fill="'+cloth+'"/>'+path('M410 950 Q505 870 603 949 T793 945',ink,3)+txt(600,1014,'BEYOND THE LIGHT',ink,16,4);break;
  case 'after-hours':
    back=disk(706,691,41,ink,.6)+Array.from({length:18},(_,i)=>{const h=60+i*47%183;return '<rect x="'+(422+i*21)+'" y="'+(950-h)+'" width="16" height="'+h+'" fill="'+ink+'" opacity="'+(.26+(i%4)*.14)+'"/>';}).join('')+txt(600,1020,'CITY AFTER DARK',ink,18,3);break;
  case 'origin-limited':
    back=Array.from({length:8},(_,i)=>path('M430 '+(718+i*31)+' Q'+(575+i*9)+' '+(570+i*36)+' 777 '+(750+i*23),ink,3.3-i*.2,.8)).join('')+txt(600,1030,'THE FIRST CHAPTER',ink,18,4);break;
 }
 return title+back+caption;
}
function svgFor(d,side){
 const shape='M404 350 C447 332 486 325 528 323 Q600 390 672 323 C719 325 765 338 804 355 L972 436 L1050 665 Q979 706 875 727 L825 624 L846 1254 Q603 1310 355 1254 L376 624 L325 727 Q221 705 150 665 L229 436 Z';
 return '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="3000" viewBox="0 0 1200 1500" role="img">'+
 '<title>ASRYO '+d.name+' '+side+' vector concept</title><desc>Illustration only, not a manufactured product photo.</desc>'+
 '<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#f2f0ed"/><stop offset="1" stop-color="#dad7d1"/></linearGradient><linearGradient id="shading" x2="1"><stop stop-color="#fff" stop-opacity=".15"/><stop offset=".3" stop-color="#fff" stop-opacity=".02"/><stop offset="1" stop-color="#000" stop-opacity=".15"/></linearGradient><clipPath id="clip"><path d="'+shape+'"/></clipPath></defs>'+
 '<rect width="1200" height="1500" fill="url(#bg)"/><ellipse cx="600" cy="1321" rx="340" ry="25" fill="#000" opacity=".04"/>'+
 '<path d="'+shape+'" fill="'+d.cloth+'" stroke="#141414" stroke-opacity=".13" stroke-width="3"/>'+
 '<g clip-path="url(#clip)"><rect x="100" y="310" width="1000" height="1000" fill="url(#shading)"/><path d="M344 465 Q450 538 386 1244 M857 470 Q764 560 833 1250" stroke="#111" stroke-width="15" opacity=".1" fill="none"/></g>'+
 '<path d="M405 352 L378 621 L327 724 M795 350 L823 620 L873 724" stroke="#111" stroke-width="2" opacity=".15" fill="none"/>'+
 '<path d="M528 326 Q600 '+(side==='front'?404:362)+' 672 326" stroke="#111" stroke-width="10" stroke-opacity=".23" fill="none"/>'+
 '<g>'+graphic(d,side)+'</g>'+
 '<g font-family="Arial,sans-serif" fill="#252525"><text x="67" y="87" font-size="32" letter-spacing="12" font-weight="750">ASRYO</text>'+
 '<text x="70" y="119" font-size="14" letter-spacing="5">DESIGN STUDIO / DROP 001</text>'+
 '<text x="1130" y="85" font-size="18" text-anchor="end" letter-spacing="4">'+side.toUpperCase()+'</text>'+
 '<text x="68" y="1426" font-size="22" font-weight="700" letter-spacing="5">'+d.name.toUpperCase()+'</text>'+
 '<text x="68" y="1454" font-size="14" letter-spacing="3">'+d.shade.toUpperCase()+' / VECTOR CONCEPT</text>'+
 '<text x="1130" y="1453" font-size="11" text-anchor="end" letter-spacing="2">NOT A PRODUCT PHOTOGRAPH</text></g></svg>';
}
const gallery=document.querySelector('#gallery');
const dialog=document.querySelector('#imageDialog');
const large=document.querySelector('#enlargedImage');
const sources=new Map();
const fragment=document.createDocumentFragment();
designs.forEach((d,i)=>{
 const article=document.createElement('article');article.className='product';
 const views=document.createElement('div');views.className='views';
 for(const side of ['front','back']){
  const source='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svgFor(d,side));
  sources.set(d.id+'-'+side,source);
  const button=document.createElement('button');button.className='view';button.type='button';button.setAttribute('aria-label','Enlarge '+d.name+' '+side+' illustration');
  const img=document.createElement('img');img.src=source;img.loading='lazy';img.decoding='async';img.width=1200;img.height=1500;img.alt='ASRYO '+d.name+' '+side+' original vector concept illustration';
  button.append(img);button.addEventListener('click',()=>{large.src=source;large.alt=img.alt;dialog.showModal();});views.append(button);
 }
 const caption=document.createElement('div');caption.className='caption';
 const number=document.createElement('div');number.className='number';number.textContent=String(i+1).padStart(2,'0')+' / FRONT + BACK';
 const heading=document.createElement('h2');heading.textContent=d.name.toUpperCase();
 const note=document.createElement('p');note.textContent=d.shade+' · Illustrative concept · Not available to order';
 caption.append(number,heading,note);article.append(views,caption);fragment.append(article);
});
gallery.append(fragment);
document.querySelector('#closeDialog').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',(event)=>{if(event.target===dialog)dialog.close();});
