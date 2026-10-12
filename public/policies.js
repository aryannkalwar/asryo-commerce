document.querySelector('#year').textContent=String(new Date().getFullYear());
fetch('/api/status',{cache:'no-store'}).then(r=>r.json()).then(s=>{if(s.supportEmail){document.querySelector('#supportLine').textContent=s.supportEmail;document.querySelector('#policyContact').textContent=`Contact ASRYO at ${s.supportEmail}.`}}).catch(()=>{});
