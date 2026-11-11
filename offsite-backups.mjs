import {S3Client,PutObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {restore} from './scripts/database-snapshot.mjs';

const maxBytes=128*1024*1024;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const configured=value=>typeof value==='string'&&value.trim()&&!value.includes('${{');

export function offsiteConfig(env=process.env){
 if(env.OFFSITE_BACKUPS!=='true')return null;
 for(const name of ['BACKUP_S3_ENDPOINT','BACKUP_S3_BUCKET','BACKUP_S3_REGION','BACKUP_S3_ACCESS_KEY_ID','BACKUP_S3_SECRET_ACCESS_KEY','BACKUP_S3_PREFIX'])
  if(!configured(env[name]))throw new Error('Offsite backup configuration is incomplete');
 const endpoint=new URL(env.BACKUP_S3_ENDPOINT);
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/')throw new Error('Backup storage requires an HTTPS origin');
 if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.BACKUP_S3_BUCKET)||!/^asryo-[a-z0-9-]{1,60}$/.test(env.BACKUP_S3_PREFIX))throw new Error('Invalid backup bucket or scope');
 if(!['path','virtual-host'].includes(env.BACKUP_S3_URL_STYLE))throw new Error('Confirm the backup bucket URL style');
 return {endpoint:endpoint.origin,region:env.BACKUP_S3_REGION,bucket:env.BACKUP_S3_BUCKET,prefix:env.BACKUP_S3_PREFIX,
  accessKeyId:env.BACKUP_S3_ACCESS_KEY_ID,secretAccessKey:env.BACKUP_S3_SECRET_ACCESS_KEY,forcePathStyle:env.BACKUP_S3_URL_STYLE==='path'};
}

function clientFor(config){
 return new S3Client({endpoint:config.endpoint,region:config.region,forcePathStyle:config.forcePathStyle,
  credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey},maxAttempts:2,
  requestHandler:{connectionTimeout:5000,requestTimeout:30000},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
}
function validateManifest(manifest){
 if(manifest?.format!==1||!Number.isSafeInteger(manifest.bytes)||manifest.bytes<1||manifest.bytes>maxBytes
  ||!/^[a-f0-9]{64}$/.test(manifest.sha256)||typeof manifest.createdAt!=='string'||!Number.isFinite(Date.parse(manifest.createdAt)))throw new Error('Invalid backup manifest');
 return manifest;
}
function validateKey(config,key){
 if(typeof key!=='string'||!key.startsWith(config.prefix+'/')||!/^asryo-[a-z0-9-]{1,60}\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{64}$/.test(key))throw new Error('Backup key is outside the configured scope');
}
async function uploadOnce(client,input){
 try{await client.send(new PutObjectCommand({...input,IfNoneMatch:'*'}),{abortSignal:AbortSignal.timeout(45000)});}
 catch(error){if(error?.$metadata?.httpStatusCode!==412&&error?.name!=='PreconditionFailed')throw error;}
}
async function download(client,config,key,limit){
 const response=await client.send(new GetObjectCommand({Bucket:config.bucket,Key:key}),{abortSignal:AbortSignal.timeout(45000)});
 if(!Number.isSafeInteger(response.ContentLength)||response.ContentLength<1||response.ContentLength>limit){response.Body?.destroy?.();throw new Error('Invalid backup object length');}
 const chunks=[];let bytes=0;
 try{
  for await(const chunk of response.Body){bytes+=chunk.length;if(bytes>limit||bytes>response.ContentLength)throw new Error('Backup object exceeds its declared size');chunks.push(Buffer.from(chunk));}
  if(bytes!==response.ContentLength)throw new Error('Incomplete backup object');
  return Buffer.concat(chunks,bytes);
 }catch(error){response.Body?.destroy?.();throw error;}
}
async function downloadSnapshot(client,config,key,directory,expected){
 validateKey(config,key);
 const manifestBytes=await download(client,config,key+'/manifest.json',64*1024);
 const manifest=validateManifest(JSON.parse(manifestBytes.toString('utf8')));
 if(key!==`${config.prefix}/${manifest.createdAt.slice(0,10)}/${manifest.sha256}`
  ||expected&&(manifest.sha256!==expected.sha256||manifest.bytes!==expected.bytes||manifest.createdAt!==expected.createdAt))throw new Error('Remote backup manifest does not match');
 const bytes=await download(client,config,key+'/asryo.sqlite',manifest.bytes);
 if(bytes.length!==manifest.bytes||digest(bytes)!==manifest.sha256)throw new Error('Remote backup checksum mismatch');
 await mkdir(directory,{mode:0o700});
 await writeFile(join(directory,'manifest.json'),manifestBytes,{flag:'wx',mode:0o600});
 await writeFile(join(directory,'asryo.sqlite'),bytes,{flag:'wx',mode:0o600});
 return manifest;
}

// Objects are private, immutable writes. No public URL, ACL or delete operation is used.
export async function archiveOffsite(directory,env=process.env,makeClient=clientFor){
 const config=offsiteConfig(env);if(!config)return null;
 const manifestBytes=await readFile(join(directory,'manifest.json'));
 const manifest=validateManifest(JSON.parse(manifestBytes.toString('utf8')));
 if((await stat(join(directory,'asryo.sqlite'))).size!==manifest.bytes)throw new Error('Local backup length mismatch');
 const bytes=await readFile(join(directory,'asryo.sqlite'));
 if(digest(bytes)!==manifest.sha256)throw new Error('Local backup checksum mismatch');
 const key=`${config.prefix}/${manifest.createdAt.slice(0,10)}/${manifest.sha256}`;
 const client=makeClient(config);
 try{
  await uploadOnce(client,{Bucket:config.bucket,Key:key+'/asryo.sqlite',Body:bytes,ContentType:'application/octet-stream',ContentLength:bytes.length});
  // Publish the manifest only after the complete database object exists.
  await uploadOnce(client,{Bucket:config.bucket,Key:key+'/manifest.json',Body:manifestBytes,ContentType:'application/json',ContentLength:manifestBytes.length});
  const temporary=await mkdtemp(join(tmpdir(),'asryo-object-recovery-'));
  try{
   await downloadSnapshot(client,config,key,join(temporary,'downloaded'),manifest);
   const result=await restore(join(temporary,'downloaded'),join(temporary,'restored'));
   return {key,createdAt:manifest.createdAt,verifiedAt:new Date().toISOString(),bytes:manifest.bytes,integrity:result.integrity,restoreDrill:'verified',sessionsRevoked:result.sessionsRevoked};
  }finally{await rm(temporary,{recursive:true,force:true});}
 }finally{client.destroy?.();}
}

// Recovery creates a NEW private directory. Existing/live database files cannot be replaced.
export async function recoverOffsite(key,destination,env=process.env,makeClient=clientFor){
 const config=offsiteConfig(env);if(!config)throw new Error('Offsite backups are disabled');
 validateKey(config,key);
 try{await stat(destination);throw new Error('Recovery destination must not exist');}catch(error){if(error.code!=='ENOENT')throw error;}
 const client=makeClient(config),temporary=await mkdtemp(join(tmpdir(),'asryo-object-download-'));
 try{
  const manifest=await downloadSnapshot(client,config,key,join(temporary,'downloaded'));
  return {...await restore(join(temporary,'downloaded'),destination),createdAt:manifest.createdAt};
 }finally{client.destroy?.();await rm(temporary,{recursive:true,force:true});}
}
