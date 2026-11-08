import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyFashionOwnerCookie} from '../fashion-owner-sso.mjs';
const validToken='a'.repeat(80)+'.'+'b'.repeat(43);
const transport=(code,body,content='application/json')=>async(url,options)=>{
 assert.equal(url,'https://asryo-vercel-storefront.vercel.app/api/control');
 assert.equal(options.headers.Cookie,'fashion_os_session='+validToken);
 assert.equal(options.method,'GET');
 assert.equal(options.redirect,'manual');
 return {status:code,headers:{get:()=>content},json:async()=>body};
};
test('refuses missing or forged-format owner cookies before any external request',async()=>{
 let invoked=false;
 assert.equal(await verifyFashionOwnerCookie('',async()=>{invoked=true;}),false);
 assert.equal(await verifyFashionOwnerCookie('attacker; Set-Cookie:admin=1',async()=>{invoked=true;}),false);
 assert.equal(invoked,false);
});
test('only server-confirmed, initialized Fashion OS owners pass',async()=>{
 assert.equal(await verifyFashionOwnerCookie(validToken,transport(200,{initialized:true,loggedIn:true,role:'owner'})),true);
 for(const data of [
  {initialized:true,loggedIn:false},
  {initialized:false,loggedIn:true},
  {initialized:true,loggedIn:true,role:'designer'},
  {initialized:true,loggedIn:'true'},
  {}
 ])assert.equal(await verifyFashionOwnerCookie(validToken,transport(200,data)),false);
 assert.equal(await verifyFashionOwnerCookie(validToken,transport(401,{initialized:true,loggedIn:true})),false);
 assert.equal(await verifyFashionOwnerCookie(validToken,transport(200,{initialized:true,loggedIn:true},'text/html')),false);
 assert.equal(await verifyFashionOwnerCookie(validToken,async()=>{throw Error('offline')}),false);
});
