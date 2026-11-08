// Verify an existing Fashion OS owner's session. Never trust client-supplied role claims.
// No credentials or session tokens are logged, persisted, or sent to third parties.
const origin='https://asryo-vercel-storefront.vercel.app';
export async function verifyFashionOwnerCookie(value, transport=fetch){
 const token=String(value||'');
 // Fashion OS uses a base64url payload and HMAC signature separated by a dot.
 if(!/^[A-Za-z0-9_-]{12,1024}\.[A-Za-z0-9_-]{20,256}$/.test(token))return false;
 try{
  const response=await transport(origin+'/api/control',{
   method:'GET',redirect:'manual',cache:'no-store',
   headers:{Cookie:'fashion_os_session='+token,Accept:'application/json'},
   signal:AbortSignal.timeout(8000)
  });
  if(response.status!==200||(response.headers?.get('content-type')||'').indexOf('application/json')<0)return false;
  const state=await response.json();
  if(!state||typeof state!=='object'||Array.isArray(state))return false;
  return state.initialized===true&&state.loggedIn===true&&(state.role===undefined||state.role==='owner');
 }catch{return false;}
}
