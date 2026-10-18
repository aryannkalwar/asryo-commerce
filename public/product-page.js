const el=s=>document.querySelector(s);
const page=el('[data-product-page]');
if(page){
  const mainImg=el('#largePhoto'), largeLink=el('#largePhotoLink');
  for(const btn of document.querySelectorAll('[data-photo]')){
    btn.addEventListener('click',()=>{
      mainImg.src=btn.dataset.photo;
      mainImg.alt=btn.dataset.alt;
      largeLink.href=btn.dataset.photo;
      document.querySelectorAll('[data-photo]').forEach(x=>x.setAttribute('aria-pressed',String(x===btn)));
    });
  }
}
async function initWaitlist(){
  for(const form of document.querySelectorAll('[data-early-access-form]')){
    const submit=form.querySelector('button[type="submit"]');
    const status=form.querySelector('[role="status"]');
    const input=form.querySelector('input[type="email"]');
    try{
      const r=await fetch('/api/early-access/status',{cache:'no-store'});
      const data=await r.json();
      if(!r.ok||!data.enabled){
        submit.disabled=true;
        status.textContent='Email early access will open once our confirmation-email service is ready. No signups are being accepted yet.';
        continue;
      }
      submit.disabled=false;
      status.textContent='We will send one email to verify your address before adding you to launch updates.';
    }catch{
      submit.disabled=true;
      status.textContent='Signup is temporarily unavailable. Please try again later.';
      continue;
    }
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      status.textContent='Submitting…';
      submit.disabled=true;
      try{
        const res=await fetch('/api/early-access',{
          method:'POST',credentials:'same-origin',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({email:input.value,consent:form.querySelector('[name="consent"]').checked,website:form.querySelector('[name="website"]').value})
        });
        const payload=await res.json();
        if(!res.ok)throw new Error(payload.error||'Signup is unavailable.');
        status.textContent=payload.message||'Please check your email.';
        form.reset();
      }catch(err){status.textContent=err.message||'Please try later.'}
      finally{submit.disabled=false}
    });
  }
}
initWaitlist();
const unsubscribeForm=el('#unsubscribeForm');
if(unsubscribeForm){
  const token=new URLSearchParams(location.search).get('token')||'';
  const message=el('#unsubscribeStatus');
  if(!/^[a-f0-9]{64}$/.test(token)){unsubscribeForm.hidden=true;message.textContent='This unsubscribe link is invalid.'}
  unsubscribeForm.addEventListener('submit',async event=>{
    event.preventDefault();
    unsubscribeForm.querySelector('button').disabled=true;
    try{
      const res=await fetch('/api/early-access/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
      const p=await res.json();
      if(!res.ok)throw new Error(p.error||'Unable to unsubscribe.');
      message.textContent=p.message;unsubscribeForm.hidden=true;
    }catch(err){message.textContent=err.message;unsubscribeForm.querySelector('button').disabled=false}
  });
}
