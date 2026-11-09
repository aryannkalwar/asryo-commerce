import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compareDatabases} from './compare-databases.mjs';
test('comparison detects conflicts without changing snapshots or emitting private row data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'asryo-compare-'));
 try{
  const a=join(dir,'a.sqlite'),b=join(dir,'b.sqlite');
  for(const file of [a,b]){const db=new DatabaseSync(file);db.exec("CREATE TABLE customers(id TEXT PRIMARY KEY,email TEXT);CREATE TABLE sessions(token TEXT PRIMARY KEY);INSERT INTO customers VALUES('private-id','private@example.test');");db.close();}
  assert(compareDatabases(a,b).readyToReconcile);
  const db=new DatabaseSync(b);db.exec("UPDATE customers SET email='changed@example.test';INSERT INTO customers VALUES('new-id','new@example.test');INSERT INTO sessions VALUES('private-token');");db.close();
  const beforeA=readFileSync(a),beforeB=readFileSync(b);
  const report=compareDatabases(a,b);assert.equal(report.readyToReconcile,false);
  assert.equal(report.tables[0].conflicting,1);assert.equal(report.tables[0].rightOnly,1);
  assert.doesNotMatch(JSON.stringify(report),/@example|private-id|private-token|new-id/);
  assert.deepEqual(readFileSync(a),beforeA);assert.deepEqual(readFileSync(b),beforeB);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
