const form=document.getElementById('interest');
form.addEventListener('submit',async event=>{
 event.preventDefault();const message=document.getElementById('result'),submit=form.querySelector('button');
 const data=new FormData(form);submit.disabled=true;message.textContent='Saving your non-binding interest…';
 try{const response=await fetch('/api/early-access',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({email:data.get('email'),design:data.get('design'),size:data.get('size'),consent:data.get('consent')==='on'})});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Could not save your interest.');
 message.textContent=result.message||'Interest saved. No order or reservation was created.';
 if(result.cancelUrl){const link=document.createElement('a');link.href=result.cancelUrl;link.textContent=' Save your cancellation link';message.append(link);}
 }catch(error){message.textContent=error.message;}finally{submit.disabled=false;}
});
