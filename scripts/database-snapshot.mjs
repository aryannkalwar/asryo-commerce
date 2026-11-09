import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, readFile, writeFile, chmod, copyFile, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function inspect(file) {
  const db = new DatabaseSync(file, {readOnly:true});
  try {
    const check = db.prepare('PRAGMA integrity_check').all();
    if (check.length !== 1 || Object.values(check[0])[0] !== 'ok') throw new Error('Database integrity check failed');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database foreign key check failed');
    return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);
  } finally { db.close(); }
}

// Destination directory MUST be new. Never replace a live database or an old backup.
export async function snapshot(source, destination) {
  source = resolve(source); destination = resolve(destination);
  if (!(await stat(source)).isFile()) throw new Error('Source must be an existing database');
  await mkdir(destination, {mode:0o700});
  const file = join(destination, 'asryo.sqlite');
  const db = new DatabaseSync(source, {readOnly:true});
  try {
    await backup(db, file);
    await chmod(file, 0o600);
    const tables = inspect(file);
    const bytes = await readFile(file);
    const manifest = {format:1, createdAt:new Date().toISOString(), sha256:digest(bytes), bytes:bytes.length, tables};
    await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest,null,2)+'\n', {flag:'wx',mode:0o600});
    return {directory:destination, integrity:'ok', tables:tables.length};
  } catch(error) { await rm(destination, {recursive:true,force:true}); throw error; }
  finally { db.close(); }
}

export async function restore(snapshotDirectory, destination) {
  snapshotDirectory=resolve(snapshotDirectory); destination=resolve(destination);
  const manifest=JSON.parse(await readFile(join(snapshotDirectory,'manifest.json'),'utf8'));
  const bytes=await readFile(join(snapshotDirectory,'asryo.sqlite'));
  if (manifest.format!==1 || manifest.sha256!==digest(bytes) || manifest.bytes!==bytes.length) throw new Error('Snapshot checksum mismatch');
  inspect(join(snapshotDirectory,'asryo.sqlite'));
  await mkdir(destination,{mode:0o700});
  const file=join(destination,'asryo.sqlite');
  try {
    await copyFile(join(snapshotDirectory,'asryo.sqlite'),file,constants.COPYFILE_EXCL);
    await chmod(file,0o600);
    // Restoring business data must not resurrect old authenticated sessions.
    const db=new DatabaseSync(file);
    try {
      const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
      for (const table of ['sessions','admin_sessions']) if(tables.has(table)) db.exec(`DELETE FROM ${table}`);
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {db.close();}
    inspect(file);
    return {directory:destination,integrity:'ok',sessionsRevoked:true};
  } catch(error) {await rm(destination,{recursive:true,force:true});throw error;}
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [operation,source,destination]=process.argv.slice(2);
  if (!['backup','restore'].includes(operation)||!source||!destination) {
    console.error('Usage: node scripts/database-snapshot.mjs backup SOURCE_SQLITE NEW_PRIVATE_DIRECTORY\n       node scripts/database-snapshot.mjs restore SNAPSHOT_DIRECTORY NEW_DATA_DIRECTORY');
    process.exitCode=1;
  } else {
    try {console.log(JSON.stringify(await (operation==='backup'?snapshot:restore)(source,destination)));}
    catch(error){console.error(error.message);process.exitCode=1;}
  }
}
