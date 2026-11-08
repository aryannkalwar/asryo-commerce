const el=id=>document.getElementById(id);
const INR=n=>'₹'+(Number(n||0)/100).toLocaleString('en-IN',{maximumFractionDigits:2});
function status(id,label){el(id).textContent=label}
function showCommerce(data){
  const m=data.metrics||{};
  el('orders').textContent=Number.isFinite(m.totalOrders)?m.totalOrders:'—';
  el('revenue').textContent=Number.isFinite(m.collectedRevenuePaise)?INR(m.collectedRevenuePaise):'—';
  el('sellable').textContent=Number.isFinite(m.sellableProducts)?m.sellableProducts:'—';
  el('subscribers').textContent=Number.isFinite(m.subscribedCustomers)?m.subscribedCustomers:'—';
  el('readiness').textContent=m.storeReady?'Ordering enabled':'Not open for verified orders';
}
async function request(path){
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
  if(!response.ok)return {ok:false,status:response.status};
  const type=response.headers.get('content-type')||'';
  if(!type.includes('json'))return {ok:false,status:502};
  return {ok:true,data:await response.json()};
}
async function refresh(){
  const button=el('refresh');button.disabled=true;
  el('error').textContent='';
  status('commerce-status','Checking commerce admin session…');
  status('fashion-status','Checking Fashion OS owner session…');
  try{
    const [commerce,fashion]=await Promise.allSettled([
      request('/api/admin/cofounder/overview'),request('/api/ops')
    ]);
    if(commerce.status==='fulfilled'&&commerce.value.ok){
      showCommerce(commerce.value.data);status('commerce-status','Commerce authenticated — actual store records');
    }else{
      const code=commerce.status==='fulfilled'?commerce.value.status:0;
      status('commerce-status',code===401||code===403?'Commerce admin login required':'Commerce API not available');
    }
    if(fashion.status==='fulfilled'&&fashion.value.ok){
      status('fashion-status','Fashion OS session connected');
    }else{
      const code=fashion.status==='fulfilled'?fashion.value.status:0;
      status('fashion-status',code===401||code===403?'Fashion OS owner login required':'Fashion OS operations unavailable');
    }
  }catch(error){el('error').textContent='Connection check failed. Please refresh and sign in to each workspace.';}
  finally{button.disabled=false;}
}
el('refresh').addEventListener('click',refresh);
refresh();
