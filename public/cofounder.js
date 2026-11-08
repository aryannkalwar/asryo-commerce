const byId = id => document.getElementById(id);
const api = async (path, options = {}) => {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (res.status === 401 || res.status === 403) {
    byId('auth').style.display = 'block';
    throw new Error('Administrator sign-in is required.');
  }
  let data;
  try { data = await res.json(); } catch { throw new Error('Invalid server response.'); }
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
};
const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
};
const add = (parent, ...children) => { for (const child of children) parent.append(child); return parent; };
const money = paise => '₹' + (Number(paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const signal = text => { byId('message').textContent = text; };

function renderOverview(data) {
  const root = byId('stats');
  root.replaceChildren();
  const metrics = [
    ['Orders', data.metrics.totalOrders],
    ['Collected revenue', money(data.metrics.collectedRevenuePaise)],
    ['Live-ready SKUs', data.metrics.sellableProducts],
    ['Verified subscribers', data.metrics.subscribedCustomers]
  ];
  metrics.forEach(([label, value]) => {
    const tile = make('div', undefined, 'stat');
    add(tile, make('small', label), make('strong', value));
    root.append(tile);
  });
  const alerts = byId('alerts');
  alerts.replaceChildren();
  if (!data.alerts.length) alerts.append(make('p', 'No operational alerts.'));
  data.alerts.forEach(x => alerts.append(make('div', x.text, 'notice')));
  const integrations = byId('integrations');
  integrations.replaceChildren();
  data.integrations.forEach(x => {
    const item = make('div', undefined, 'module');
    add(item, make('strong', x.name), make('em', x.status), make('span', ' — ' + x.details));
    integrations.append(item);
  });
}

function renderAutomations(events) {
  const root=byId('automation');
  root.replaceChildren();
  if (!events.length) {
    root.append(make('p','No recommendations recorded yet. Run a business analysis.'));
    return;
  }
  for (const event of events) {
    const item=make('article',undefined,'draft');
    add(item,make('span',event.priority.toUpperCase(),'pill'),make('h3',event.title),
      make('p',event.detail),make('div',event.status.toUpperCase()+' · '+event.businessDay,'meta'));
    const buttons=make('div',undefined,'actions');
    if (event.status==='pending') {
      const reviewed=make('button','Mark reviewed');
      reviewed.type='button';
      reviewed.addEventListener('click',()=>changeAutomation(event.id,'reviewed'));
      const dismiss=make('button','Dismiss');
      dismiss.className='secondary';dismiss.type='button';
      dismiss.addEventListener('click',()=>changeAutomation(event.id,'dismissed'));
      add(buttons,reviewed,dismiss);
    }
    item.append(buttons);
    root.append(item);
  }
}
async function refreshAutomations() {
  const result=await api('/api/admin/cofounder/automations');
  renderAutomations(result.events);
}
async function changeAutomation(id,status) {
  try {
    const result=await api('/api/admin/cofounder/automations/'+encodeURIComponent(id),
      {method:'PATCH',body:JSON.stringify({status})});
    renderAutomations(result.events);
    signal(result.note);
  }catch(error){signal(error.message);}
}
byId('evaluate').addEventListener('click',async()=>{
  const button=byId('evaluate');button.disabled=true;
  try {
    const result=await api('/api/admin/cofounder/automations/evaluate',
      {method:'POST',body:'{}'});
    renderAutomations(result.events);
    signal('Analyzed '+result.evaluated+' conditions. Added '+result.newRecommendations+' review items.');
  }catch(error){signal(error.message);}
  finally{button.disabled=false;}
});
byId('check-fashion').addEventListener('click',async()=>{
  const target=byId('fashion-status');
  target.textContent='Checking existing Fashion OS session…';
  try {
    const res=await fetch('/api/ops',{credentials:'same-origin',cache:'no-store'});
    if(res.ok)target.textContent='Connected to Fashion OS operations through the private gateway.';
    else if(res.status===401||res.status===403)target.textContent='Fashion OS is available but needs its separate owner sign-in.';
    else target.textContent='Fashion OS connection could not be verified (HTTP '+res.status+').';
  }catch{target.textContent='Fashion OS is not reachable through this gateway.';}
});

function renderDrafts(drafts) {
  const root = byId('drafts');
  root.replaceChildren();
  if (!drafts.length) { root.append(make('p', 'No drafts yet. Create the first proposal.')); return; }
  drafts.forEach(draft => {
    const card = make('article', undefined, 'draft');
    const heading = make('div');
    add(heading, make('span', draft.kind, 'pill'), make('h3', draft.title));
    const meta = make('div', draft.status.toUpperCase() + ' · ' + new Date(draft.createdAt).toLocaleString('en-IN'), 'meta');
    const body = make('pre', draft.content);
    const buttons = make('div', undefined, 'actions');
    const copy = make('button', 'Copy');
    copy.type = 'button'; copy.className = 'secondary';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(draft.content); signal('Draft copied.'); }
      catch { signal('Copy unavailable. Select the text in the draft instead.'); }
    });
    buttons.append(copy);
    if (draft.status === 'draft') {
      const approve = make('button', 'Approve draft');
      approve.type = 'button';
      approve.addEventListener('click', () => updateDraft(draft.id, 'approved'));
      buttons.append(approve);
    }
    if (draft.status !== 'archived') {
      const archive = make('button', 'Archive');
      archive.type = 'button'; archive.className = 'secondary';
      archive.addEventListener('click', () => updateDraft(draft.id, 'archived'));
      buttons.append(archive);
    }
    add(card, heading, meta, body, buttons);
    root.append(card);
  });
}
async function updateDraft(id, status) {
  try {
    const result = await api('/api/admin/cofounder/drafts/' + encodeURIComponent(id), {
      method: 'PATCH', body: JSON.stringify({ status })
    });
    signal(result.note || 'Draft updated.');
    await refreshDrafts();
  } catch (error) { signal(error.message); }
}
async function refreshDrafts() {
  const result = await api('/api/admin/cofounder/drafts');
  renderDrafts(result.drafts);
}
async function initialize() {
  try {
    const [overview, products, drafts] = await Promise.all([
      api('/api/admin/cofounder/overview'),
      api('/api/admin/cofounder/products'),
      api('/api/admin/cofounder/drafts')
    ]);
    renderOverview(overview);
    const list = byId('product');
    products.products.forEach(p => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name + (p.active ? '' : ' (inactive)');
      list.append(option);
    });
    renderDrafts(drafts.drafts);
    await refreshAutomations();
  } catch (error) { signal(error.message); }
}
byId('draft-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = byId('create');
  button.disabled = true;
  try {
    const input = {
      kind: byId('kind').value,
      productId: byId('product').value,
      brief: byId('brief').value.trim()
    };
    const result = await api('/api/admin/cofounder/drafts', {
      method: 'POST', body: JSON.stringify(input)
    });
    signal('Created ' + result.draft.title + '. Review before use.');
    await refreshDrafts();
  } catch (error) { signal(error.message); }
  finally { button.disabled = false; }
});
initialize();
