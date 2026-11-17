// Run only against a privately recovered snapshot, outside the public directory.
import { DatabaseSync } from 'node:sqlite';
import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
const input=process.argv[2];
if(!input)throw new Error('Usage: node scripts/cloudflare-migration-audit.mjs PRIVATE_SNAPSHOT.sqlite');
const path=realpathSync(resolve(input));
if(!statSync(path).isFile())throw new Error('A private SQLite snapshot file is required.');
const db=new DatabaseSync(path,{readOnly:true});
try{
  const integrity=db.prepare('PRAGMA integrity_check').all();
  if(integrity.length!==1||Object.values(integrity[0])[0]!=='ok')throw new Error('Snapshot integrity check failed.');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Snapshot has foreign-key violations.');
  const objects=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const tables=objects.filter(x=>x.type==='table').map(x=>{
    const identifier='"'+x.name.replaceAll('"','""')+'"';
    return {name:x.name,rows:db.prepare('SELECT count(*) AS rows FROM '+identifier).get().rows};
  });
  const required=['products','customers','orders'];
  if(required.some(name=>!tables.some(t=>t.name===name)))throw new Error('Not a recognized ASRYO commerce snapshot.');
  // Only aggregate counts and object names are emitted, never order details, hashes or credentials.
  console.log(JSON.stringify({integrity:'ok',foreignKeys:'ok',tables,
    schemaObjects:objects.map(x=>({type:x.type,name:x.name,table:x.tbl_name})),
    migrationNotes:['Review SQL compatibility before import.','Invalidate all session and verification tokens before cutover.','Keep this report private.']},null,2));
}finally{db.close();}
