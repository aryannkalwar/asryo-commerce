import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {snapshot,restore} from './database-snapshot.mjs';

test('online WAL snapshot restores records, revokes sessions and refuses overwrite/tampering',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'asryo-backup-test-'));
 const source=join(dir,'source.sqlite');
 const db=new DatabaseSync(source);
 try {
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE projects(id TEXT PRIMARY KEY, revision INTEGER); CREATE TABLE sessions(token TEXT); CREATE TABLE admin_sessions(token TEXT); INSERT INTO projects VALUES('test-project',3); INSERT INTO sessions VALUES('expired-test'); INSERT INTO admin_sessions VALUES('expired-test');");
  const snap=join(dir,'snapshot');
  assert.equal((await snapshot(source,snap)).integrity,'ok');
  assert.equal((await stat(join(snap,'asryo.sqlite'))).mode & 0o777,0o600);
  db.exec("UPDATE projects SET revision=4");
  const restored=join(dir,'restored');
  assert.equal((await restore(snap,restored)).sessionsRevoked,true);
  const check=new DatabaseSync(join(restored,'asryo.sqlite'));
  assert.equal(check.prepare('SELECT revision FROM projects').get().revision,3);
  assert.equal(check.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
  assert.equal(check.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n,0);
  check.close();
  await assert.rejects(snapshot(source,snap),/EEXIST/);
  await assert.rejects(restore(snap,restored),/EEXIST/);
  const bytes=await readFile(join(snap,'asryo.sqlite')); bytes[bytes.length-1]^=1;
  await writeFile(join(snap,'asryo.sqlite'),bytes);
  await assert.rejects(restore(snap,join(dir,'bad')),/checksum mismatch/);
  assert.equal(db.prepare('SELECT revision FROM projects').get().revision,4);
 } finally {db.close();await rm(dir,{recursive:true,force:true});}
});
