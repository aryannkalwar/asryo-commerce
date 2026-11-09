import {snapshot,restore} from './scripts/database-snapshot.mjs';
import {mkdir,mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';

export const backupState={enabled:false,lastBackupAt:null,integrity:null,restoreDrill:null,storage:'same-volume',offsiteVerified:false};
export function startBackups(dataDir,env=process.env){
 if(env.DAILY_BACKUPS!=='true')return;
 backupState.enabled=true;
 let running=false;
 const run=async()=>{
  if(running)return;running=true;
  try{
   const directory=join(dataDir,'backups');await mkdir(directory,{recursive:true,mode:0o700});
   const target=join(directory,new Date().toISOString().slice(0,10));
   let existing=false;try{existing=(await stat(join(target,'manifest.json'))).isFile();}catch{}
   if(!existing)await snapshot(join(dataDir,'asryo.sqlite'),target);
   const manifest=JSON.parse(await readFile(join(target,'manifest.json'),'utf8'));
   const bytes=await readFile(join(target,'asryo.sqlite'));
   if(manifest.sha256!==createHash('sha256').update(bytes).digest('hex')||manifest.bytes!==bytes.length)throw Error('Backup checksum mismatch');
   backupState.lastBackupAt=manifest.createdAt;backupState.integrity='ok';
   // A drill restores only to a NEW temporary directory; the live volume is never overwritten.
   const temporary=await mkdtemp(join(tmpdir(),'asryo-recovery-drill-'));
   try{await restore(target,join(temporary,'restored'));backupState.restoreDrill='verified';}
   finally{await rm(temporary,{recursive:true,force:true});}
   console.log('database_backup_verified',{createdAt:manifest.createdAt,integrity:'ok',restoreDrill:'verified',storage:'same-volume',offsiteVerified:false});
  }catch(error){backupState.integrity='failed';console.error('database_backup_failed',{type:error.name});}
  finally{running=false;}
 };
 setTimeout(run,10000).unref();
 setInterval(run,24*60*60*1000).unref();
}
