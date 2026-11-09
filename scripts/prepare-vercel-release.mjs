// Prepare a reviewable deployment payload. No network, credentials or deployment side effects.
import {readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(new URL('..',import.meta.url).pathname);
const snapshot=JSON.parse(await readFile(join(root,'deploy/snapshots/vercel-storefront-source.json'),'utf8'));
const files=new Map(snapshot.files.map(f=>[f.file,f]));
for(const file of await readdir(join(root,'public'))){
 if(file==='vercel.json'||!(await stat(join(root,'public',file))).isFile())continue;
 files.set(file,{file,data:await readFile(join(root,'public',file),'utf8'),encoding:'utf-8'});
}
const output=process.argv[2];
if(!output)throw new Error('Provide a scratch output JSON filename, outside public/.');
const target=resolve(output);
if(target.startsWith(join(root,'public')+'/'))throw new Error('Deployment payload must not be publicly served');
await writeFile(target,JSON.stringify({name:'asryo-vercel-storefront',project:snapshot.projectId,target:'staging',files:[...files.values()],projectSettings:{framework:null}},null,2),{flag:'wx',mode:0o600});
console.log(`Prepared ${files.size} files; preserved legacy functions/config by SHA. Preview only; production promotion is separate.`);
