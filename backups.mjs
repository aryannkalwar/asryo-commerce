import {snapshot,restore} from './scripts/database-snapshot.mjs';
import {archiveOffsite} from './offsite-backups.mjs';
import {mkdir,mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';

export const newBackupState=()=>({enabled:false,lastBackupAt:null,integrity:null,restoreDrill:null,storage:'same-volume',offsiteConfigured:false,offsiteVerified:false,lastOffsiteBackupAt:null,lastOffsiteVerifiedAt:null,lastOffsiteKey:null,offsiteError:null});
export const backupState=newBackupState();
export async function runBackup(dataDir,env=process.env,state=backupState,offsite=archiveOffsite){
 state.enabled=env.DAILY_BACKUPS==='true';state.offsiteConfigured=env.OFFSITE_BACKUPS==='true';
 state.offsiteVerified=false;state.offsiteError=null;state.storage='same-volume';
 if(!state.enabled)return state;
 let directory,manifest;
 try{
  directory=join(dataDir,'backups',new Date().toISOString().slice(0,10));await mkdir(join(dataDir,'backups'),{recursive:true,mode:0o700});
  let existing=false;try{existing=(await stat(join(directory,'manifest.json'))).isFile();}catch{}
  if(!existing)await snapshot(join(dataDir,'asryo.sqlite'),directory);
  manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
  const bytes=await readFile(join(directory,'asryo.sqlite'));
  if(manifest.sha256!==createHash('sha256').update(bytes).digest('hex')||manifest.bytes!==bytes.length)throw Error('Backup checksum mismatch');
  const temporary=await mkdtemp(join(tmpdir(),'asryo-recovery-drill-'));
  try{await restore(directory,join(temporary,'restored'));}
  finally{await rm(temporary,{recursive:true,force:true});}
  state.lastBackupAt=manifest.createdAt;state.integrity='ok';state.restoreDrill='verified';
 }catch{
  state.integrity='failed';state.restoreDrill='failed';console.error('database_backup_failed');return state;
 }
 if(state.offsiteConfigured){
  try{
   const result=await offsite(directory,env);
   if(!result||result.integrity!=='ok'||result.restoreDrill!=='verified'||result.sessionsRevoked!==true)throw Error('Unverified backup');
   state.offsiteVerified=true;state.lastOffsiteBackupAt=result.createdAt;state.lastOffsiteVerifiedAt=result.verifiedAt;state.lastOffsiteKey=result.key;state.storage='same-volume+private-object-storage';
   console.log('offsite_backup_verified '+JSON.stringify({createdAt:result.createdAt,verifiedAt:result.verifiedAt,bytes:result.bytes,integrity:'ok',restoreDrill:'verified',sessionsRevoked:true}));
  }catch{
   state.offsiteError='verification_failed';console.error('offsite_backup_failed');
  }
 }
 console.log('database_backup_verified '+JSON.stringify({createdAt:manifest.createdAt,integrity:'ok',restoreDrill:'verified',storage:state.storage,offsiteVerified:state.offsiteVerified}));
 return state;
}
export function startBackups(dataDir,env=process.env){
 if(env.DAILY_BACKUPS!=='true')return;
 backupState.enabled=true;backupState.offsiteConfigured=env.OFFSITE_BACKUPS==='true';
 let running=false,completedDay=null;
 const run=async()=>{
  const day=new Date().toISOString().slice(0,10);if(running||completedDay===day)return;running=true;
  try{
   const result=await runBackup(dataDir,env);
   if(result.integrity==='ok'&&(!result.offsiteConfigured||result.offsiteVerified))completedDay=day;
  }finally{running=false;}
 };
 setTimeout(run,10000).unref();
 // Retry failures every thirty minutes; successful daily snapshots are never overwritten.
 setInterval(run,30*60*1000).unref();
}
