// SPDX-License-Identifier: MIT
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createReader}=require('../lib/client-sync.cjs');
test('revision reads follow local and external commits and rollbacks',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-revision-')),file=path.join(dir,'state.sqlite');
  const db=new DatabaseSync(file),other=new DatabaseSync(file);
  t.after(()=>{other.close();db.close();fs.rmSync(dir,{recursive:true,force:true});});
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE app (id INTEGER PRIMARY KEY,json TEXT NOT NULL); INSERT INTO app VALUES (1,'{"revision":7,"messages":[]}')`);
  const read=createReader({db}).currentRevision;
  const set=(connection,n)=>connection.prepare("UPDATE app SET json=json_set(json,'$.revision',?) WHERE id=1").run(n);
  assert.equal(read(),7);
  set(db,8);assert.equal(read(),8);
  db.exec('BEGIN IMMEDIATE');set(db,9);assert.equal(read(),9);db.exec('ROLLBACK');assert.equal(read(),8);
  other.exec('BEGIN IMMEDIATE');set(other,10);assert.equal(read(),8);other.exec('COMMIT');assert.equal(read(),10);
  other.exec('BEGIN IMMEDIATE');set(other,11);other.exec('ROLLBACK');assert.equal(read(),10);
  db.exec('BEGIN');assert.equal(read(),10);set(other,12);assert.equal(read(),10);db.exec('COMMIT');assert.equal(read(),12);
});
