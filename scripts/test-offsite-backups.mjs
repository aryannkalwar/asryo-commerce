import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {snapshot} from './database-snapshot.mjs';
import {offsiteConfig,archiveOffsite,recoverOffsite} from '../offsite-backups.mjs';
import {runBackup,newBackupState} from '../backups.mjs';

const env={DAILY_BACKUPS:'true',OFFSITE_BACKUPS:'true',BACKUP_S3_ENDPOINT:'https://storage.example.test',BACKUP_S3_BUCKET:'synthetic-backups',BACKUP_S3_REGION:'auto',BACKUP_S3_ACCESS_KEY_ID:'synthetic-key',BACKUP_S3_SECRET_ACCESS_KEY:'synthetic-secret',BACKUP_S3_URL_STYLE:'virtual-host',BACKUP_S3_PREFIX:'asryo-synthetic'};
function store(){
 const objects=new Map(),calls=[];let lengthAdjustment=0;
 const makeClient=config=>({send:async(command,options)=>{
  const input=command.input;calls.push({type:command.constructor.name,input});assert(options.abortSignal);assert.equal(config.forcePathStyle,false);
  if(command.constructor.name==='PutObjectCommand'){
   assert.equal(input.IfNoneMatch,'*');assert.equal(input.ACL,undefined);
   if(objects.has(input.Key))throw Object.assign(new Error('Synthetic duplicate'),{$metadata:{httpStatusCode:412}});
   objects.set(input.Key,Buffer.from(input.Body));return {};
  }
  assert.equal(command.constructor.name,'GetObjectCommand');const bytes=objects.get(input.Key);if(!bytes)throw Error('Synthetic missing object');
  return {ContentLength:bytes.length+lengthAdjustment,Body:Readable.from([bytes])};
 },destroy(){}});
 return {objects,calls,makeClient,setLengthAdjustment(value){lengthAdjustment=value;}};
}
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'asryo-offsite-test-'));
 const db=new DatabaseSync(join(directory,'asryo.sqlite'));
 db.exec("PRAGMA journal_mode=WAL; CREATE TABLE projects(id TEXT PRIMARY KEY, revision INTEGER); CREATE TABLE sessions(token TEXT); CREATE TABLE admin_sessions(token TEXT); CREATE TABLE ops_staff_sessions(token TEXT); INSERT INTO projects VALUES('synthetic',3); INSERT INTO sessions VALUES('old-customer'); INSERT INTO admin_sessions VALUES('old-owner'); INSERT INTO ops_staff_sessions VALUES('old-staff');");
 return {directory,db,async close(){db.close();await rm(directory,{recursive:true,force:true});}};
}
test('offsite configuration requires explicit enablement, complete credentials and HTTPS',()=>{
 assert.equal(offsiteConfig({}),null);
 for(const name of ['BACKUP_S3_BUCKET','BACKUP_S3_ACCESS_KEY_ID','BACKUP_S3_SECRET_ACCESS_KEY','BACKUP_S3_PREFIX'])assert.throws(()=>offsiteConfig({...env,[name]:''}),/incomplete/);
 assert.throws(()=>offsiteConfig({...env,BACKUP_S3_SECRET_ACCESS_KEY:'${{unresolved.KEY}}'}),/incomplete/);
 for(const endpoint of ['http://storage.example.test','https://user:password@storage.example.test','https://storage.example.test/?secret=value'])assert.throws(()=>offsiteConfig({...env,BACKUP_S3_ENDPOINT:endpoint}),/HTTPS/);
 assert.throws(()=>offsiteConfig({...env,BACKUP_S3_URL_STYLE:'unknown'}),/URL style/);
});
test('a downloaded object backup restores records, revokes all sessions and never changes live data',async()=>{
 const f=await fixture(),remote=store();
 try{
  const directory=join(f.directory,'snapshot');await snapshot(join(f.directory,'asryo.sqlite'),directory);
  f.db.exec("UPDATE projects SET revision=4");
  const result=await archiveOffsite(directory,env,remote.makeClient);assert.equal(result.restoreDrill,'verified');assert.equal(result.sessionsRevoked,true);assert.equal(remote.objects.size,2);
  assert.equal(remote.calls[0].input.Key.endsWith('/asryo.sqlite'),true);assert.equal(remote.calls[1].input.Key.endsWith('/manifest.json'),true);
  const recovered=join(f.directory,'recovered');await recoverOffsite(result.key,recovered,env,remote.makeClient);
  const db=new DatabaseSync(join(recovered,'asryo.sqlite'));
  try{assert.equal(db.prepare('SELECT revision FROM projects').get().revision,3);for(const table of ['sessions','admin_sessions','ops_staff_sessions'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);}finally{db.close();}
  assert.equal((await stat(join(recovered,'asryo.sqlite'))).mode&0o777,0o600);
  assert.equal(f.db.prepare('SELECT revision FROM projects').get().revision,4);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);
  await assert.rejects(recoverOffsite(result.key,f.directory,env,remote.makeClient),/must not exist/);
  await assert.rejects(recoverOffsite(result.key.replace('asryo-synthetic','asryo-other'),join(f.directory,'wrong'),env,remote.makeClient),/outside/);
 }finally{await f.close();}
});
test('immutable retries verify existing objects and detect corrupted or truncated remote data',async()=>{
 const f=await fixture(),remote=store();
 try{
  const directory=join(f.directory,'snapshot');await snapshot(join(f.directory,'asryo.sqlite'),directory);
  const first=await archiveOffsite(directory,env,remote.makeClient),original=Buffer.from(remote.objects.get(first.key+'/asryo.sqlite'));
  assert.equal((await archiveOffsite(directory,env,remote.makeClient)).key,first.key);assert.deepEqual(remote.objects.get(first.key+'/asryo.sqlite'),original);
  const corrupt=Buffer.from(original);corrupt[corrupt.length-1]^=1;remote.objects.set(first.key+'/asryo.sqlite',corrupt);
  await assert.rejects(archiveOffsite(directory,env,remote.makeClient),/checksum mismatch/);
  remote.objects.set(first.key+'/asryo.sqlite',original);remote.setLengthAdjustment(1);
  await assert.rejects(archiveOffsite(directory,env,remote.makeClient),/Incomplete|length/);
  remote.setLengthAdjustment(-1);await assert.rejects(archiveOffsite(directory,env,remote.makeClient),/exceeds/);
 }finally{await f.close();}
});
test('oversized or locally tampered snapshots fail before contacting object storage',async()=>{
 const f=await fixture(),remote=store();
 try{
  const directory=join(f.directory,'snapshot');await snapshot(join(f.directory,'asryo.sqlite'),directory);
  const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
  await writeFile(join(directory,'manifest.json'),JSON.stringify({...manifest,bytes:129*1024*1024}));
  await assert.rejects(archiveOffsite(directory,env,remote.makeClient),/Invalid backup manifest/);assert.equal(remote.calls.length,0);
  await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest));const bytes=await readFile(join(directory,'asryo.sqlite'));bytes[bytes.length-1]^=1;await writeFile(join(directory,'asryo.sqlite'),bytes);
  await assert.rejects(archiveOffsite(directory,env,remote.makeClient),/checksum mismatch/);assert.equal(remote.calls.length,0);
 }finally{await f.close();}
});
test('backup status never claims remote recovery after a failed upload and logs no provider secrets',async t=>{
 const f=await fixture(),remote=store(),state=newBackupState(),logs=[];
 t.mock.method(console,'log',(...parts)=>logs.push(parts));t.mock.method(console,'error',(...parts)=>logs.push(parts));
 try{
  await runBackup(f.directory,env,state,(dir,config)=>archiveOffsite(dir,config,remote.makeClient));assert.equal(state.offsiteVerified,true);
  await runBackup(f.directory,env,state,async()=>{throw Error('synthetic-secret must not be logged');});
  assert.equal(state.integrity,'ok');assert.equal(state.restoreDrill,'verified');assert.equal(state.offsiteVerified,false);assert.equal(state.offsiteError,'verification_failed');
  assert.equal(JSON.stringify(logs).includes('synthetic-secret'),false);assert(logs.some(x=>x[0]==='offsite_backup_failed'));
  await runBackup(f.directory,{...env,DAILY_BACKUPS:'false'},state);assert.equal(state.enabled,false);assert.equal(state.offsiteVerified,false);
 }finally{await f.close();}
});
