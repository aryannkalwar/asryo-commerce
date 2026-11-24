const form = document.querySelector('#designVote');
const message = document.querySelector('#voteMessage');
const submit = document.querySelector('#saveVote');
const source = new URL(location.href).searchParams.get('utm_source') || 'direct';
form.addEventListener('submit', async event => {
  event.preventDefault(); submit.disabled = true; message.textContent = 'Saving your choice…';
  try {
    const response = await fetch('/api/design-vote', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({design:new FormData(form).get('design'),source,website:new FormData(form).get('website')})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Your vote could not be saved. Please try again.');
    message.textContent = 'Your choice is saved. Thank you for helping shape the first ASRYO drop. You can change your choice here.';
    document.querySelector('#withdrawVote').hidden = false;
  } catch(error) { message.textContent = error.message; }
  finally { submit.disabled = false; }
});
document.querySelector('#withdrawVote').addEventListener('click',async()=>{
  try { const r=await fetch('/api/design-vote',{method:'DELETE'}); if(!r.ok)throw Error('Could not withdraw your choice. Please try again.'); form.reset();message.textContent='Your saved choice has been removed.';document.querySelector('#withdrawVote').hidden=true; } catch(e){message.textContent=e.message;}
});
document.querySelector('#shareVote').addEventListener('click',async()=>{
  const data={title:'Choose the first ASRYO drop',text:'Which ASRYO streetwear concept would you wear? Design previews only.',url:'https://asryo.com/vote?utm_source=share&utm_medium=organic&utm_campaign=first_drop_vote'};
  try { if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(data.url);document.querySelector('#shareMessage').textContent='Link copied. Share it with someone interested in streetwear.';} }catch(e){if(e.name!=='AbortError')document.querySelector('#shareMessage').textContent='Share this link: '+data.url;}
});
fetch('/api/design-vote').then(r=>{if(!r.ok)throw Error();return r.json();}).then(r=>{if(r.design){const input=[...form.elements].find(i=>i.name==='design'&&i.value===r.design);if(input)input.checked=true;message.textContent='Your previous choice is selected. You can update or withdraw it.';document.querySelector('#withdrawVote').hidden=false;}}).catch(()=>{});
