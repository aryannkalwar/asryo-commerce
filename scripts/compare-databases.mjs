import {DatabaseSync} from 'node:sqlite';
import {statSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const ignored=new Set(['sessions','admin_sessions']);
function tables(db){return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name).filter(x=>!ignored.has(x));}
function read(db,name){
 const columns=db.prepare('PRAGMA table_info('+quote(name)+')').all();
 const keys=columns.filter(x=>x.pk).sort((a,b)=>a.pk-b.pk).map(x=>x.name);
 return {columns:columns.map(x=>x.name).sort(),keys,rows:db.prepare('SELECT * FROM '+quote(name)).all()};
}
export function compareDatabases(leftPath,rightPath){
 for(const p of [leftPath,rightPath])if(!statSync(p).isFile())throw new Error('Use existing SQLite snapshot files');
 const left=new DatabaseSync(leftPath,{readOnly:true});let right;
 try{
  right=new DatabaseSync(rightPath,{readOnly:true});
  for(const db of [left,right]){const checks=db.prepare('PRAGMA quick_check').all();if(checks.length!==1||Object.values(checks[0])[0]!=='ok')throw new Error('Snapshot integrity check failed');}
  const lt=new Set(tables(left)),rt=new Set(tables(right));
  const results=[...new Set([...lt,...rt])].sort().map(name=>{
   if(!lt.has(name)||!rt.has(name))return {table:name,status:'missing_table',leftRows:lt.has(name)?read(left,name).rows.length:0,rightRows:rt.has(name)?read(right,name).rows.length:0};
   const a=read(left,name),b=read(right,name);
   if(JSON.stringify(a.columns)!==JSON.stringify(b.columns)||JSON.stringify(a.keys)!==JSON.stringify(b.keys)||!a.keys.length)return {table:name,status:'schema_review_required',leftRows:a.rows.length,rightRows:b.rows.length};
   const key=row=>JSON.stringify(a.keys.map(k=>row[k]));
   const value=row=>JSON.stringify(a.columns.map(k=>row[k]));
   const leftMap=new Map(a.rows.map(row=>[key(row),value(row)])),rightMap=new Map(b.rows.map(row=>[key(row),value(row)]));
   let identical=0,conflicting=0,leftOnly=0,rightOnly=0;
   for(const [k,v]of leftMap){if(!rightMap.has(k))leftOnly++;else if(rightMap.get(k)===v)identical++;else conflicting++;}
   for(const k of rightMap.keys())if(!leftMap.has(k))rightOnly++;
   return {table:name,status:conflicting||leftOnly||rightOnly?'review_required':'matching',leftRows:a.rows.length,rightRows:b.rows.length,identical,conflicting,leftOnly,rightOnly};
  });
  return {readOnly:true,automaticMerge:false,excludedTables:[...ignored],tables:results,readyToReconcile:results.every(x=>x.status==='matching'),note:'Counts only: no record values, IDs, passwords, tokens or customer details are emitted. Matching snapshots do not approve a DNS cutover. Sessions must not be migrated. This does not compare private Blob storage.'};
 }finally{left.close();right?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [left,right]=process.argv.slice(2);
 if(!left||!right){console.error('Usage: node scripts/compare-databases.mjs LEFT_SNAPSHOT_SQLITE RIGHT_SNAPSHOT_SQLITE');process.exitCode=1;}
 else{try{const report=compareDatabases(left,right);console.log(JSON.stringify(report,null,2));process.exitCode=report.readyToReconcile?0:2;}catch(error){console.error(error.message);process.exitCode=1;}}
}
