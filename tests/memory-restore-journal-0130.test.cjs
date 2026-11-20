// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),S=require('../lib/state.cjs'),Memory=require('../lib/engine/memory-store.cjs');
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-restore-journal-')),filename=path.join(dir,'app.sqlite');
  let db=new DatabaseSync(filename);db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=50; CREATE TABLE app(json TEXT)');db.prepare('INSERT INTO app VALUES(?)').run('old-app');
  const state=S.initial();S.apply(state,'role.save',{name:'隔离好友'});const roleId=state.roles[0].id;
  const card=Memory.upsertCard(dir,state,roleId,{content:'旧记忆'});
  Memory.saveProfile(dir,state,roleId,{preferences:{饮食:['旧偏好']}});
  const snapshot=Memory.exportBackup(dir,state);snapshot.cards[0].content='新记忆';snapshot.profiles[0].preferences_json=JSON.stringify({饮食:['新偏好']});
  t.after(()=>{Memory.close(dir);db?.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('pipi-restore-journal-'));fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,filename,state,roleId,card,snapshot,get db(){return db;},closeDb(){db.close();db=null;}};
}
function mode(db,schema='main'){return db.prepare('PRAGMA '+schema+'.journal_mode').get().journal_mode;}
function attached(db){return db.prepare('PRAGMA database_list').all().some(row=>row.name==='memory_backup');}
function commit(f,{fail=false}={}){
  assert.equal(mode(f.db),'delete');assert.equal(mode(f.db,'memory_backup'),'delete');
  f.db.exec('BEGIN IMMEDIATE');
  try{
    Memory.restoreAttached(f.db,f.snapshot,f.state);f.db.prepare('UPDATE app SET json=?').run('new-app');
    if(fail)throw new Error('injected transaction failure');
    f.db.exec('COMMIT');return 'committed';
  }catch(error){f.db.exec('ROLLBACK');throw error;}
}

test('恢复关闭实际记忆缓存连接，以两库DELETE提交，随后恢复WAL并重新读取新资料',t=>{
  const f=fixture(t);
  assert.equal(Memory.withRestoreJournal(f.db,f.dir,()=>commit(f)),'committed');
  assert.equal(f.db.prepare('SELECT json FROM app').get().json,'new-app');assert.equal(mode(f.db),'wal');assert.equal(attached(f.db),false);
  assert.equal(Memory.getCard(f.dir,f.state,f.roleId,f.card.id).content,'新记忆');
  assert.deepEqual(Memory.getProfile(f.dir,f.state,f.roleId).preferences,{饮食:['新偏好']});
  const detach=Memory.attachBackup(f.db,f.dir);assert.equal(mode(f.db,'memory_backup'),'wal');detach();
});

test('恢复事务失败同时保留旧业务和旧记忆，清理后两库WAL仍能继续使用',t=>{
  const f=fixture(t);
  assert.throws(()=>Memory.withRestoreJournal(f.db,f.dir,()=>commit(f,{fail:true})),/injected transaction failure/);
  assert.equal(f.db.prepare('SELECT json FROM app').get().json,'old-app');assert.equal(mode(f.db),'wal');assert.equal(attached(f.db),false);
  assert.equal(Memory.getCard(f.dir,f.state,f.roleId,f.card.id).content,'旧记忆');assert.deepEqual(Memory.getProfile(f.dir,f.state,f.roleId).preferences,{饮食:['旧偏好']});
  assert.equal(Memory.withRestoreJournal(f.db,f.dir,()=>commit(f)),'committed');assert.equal(mode(f.db),'wal');
});

test('额外读连接阻止记忆库切换时不执行恢复，已切换的主库也恢复WAL',t=>{
  const f=fixture(t),reader=new DatabaseSync(path.join(f.dir,'livingmemory.sqlite'));let commits=0;
  reader.exec('BEGIN');reader.prepare('SELECT * FROM lm_memories').all();
  try{
    assert.throws(()=>Memory.withRestoreJournal(f.db,f.dir,()=>{commits++;}),/检查点|locked|busy|原子事务/);
    assert.equal(commits,0);assert.equal(f.db.prepare('SELECT json FROM app').get().json,'old-app');assert.equal(mode(f.db),'wal');assert.equal(mode(reader),'wal');assert.equal(attached(f.db),false);
  }finally{reader.exec('ROLLBACK');reader.close();}
  assert.equal(Memory.getCard(f.dir,f.state,f.roleId,f.card.id).content,'旧记忆');
});

test('提交后两库WAL复位与detach分别报本机错误，均不改变成功结果或已提交内容',t=>{
  const f=fixture(t),errors=[],prepare=f.db.prepare.bind(f.db),exec=f.db.exec.bind(f.db);
  t.mock.method(console,'error',(...args)=>errors.push(args));
  t.mock.method(f.db,'prepare',(sql,...args)=>{if(/journal_mode=WAL$/.test(sql))throw new Error('injected WAL cleanup failure');return prepare(sql,...args);});
  t.mock.method(f.db,'exec',sql=>{if(sql==='DETACH DATABASE memory_backup')throw new Error('injected detach cleanup failure');return exec(sql);});
  assert.equal(Memory.withRestoreJournal(f.db,f.dir,()=>commit(f)),'committed');
  assert.equal(f.db.prepare('SELECT json FROM app').get().json,'new-app');assert.equal(errors.length,3);
  assert.match(errors[0][0],/main/);assert.match(errors[1][0],/memory_backup/);assert.match(errors[2][0],/分离/);
  f.closeDb();Memory.close(f.dir);
  const reopened=new DatabaseSync(f.filename);
  try{reopened.exec('PRAGMA journal_mode=WAL');assert.equal(mode(reopened),'wal');assert.equal(reopened.prepare('SELECT json FROM app').get().json,'new-app');}
  finally{reopened.close();}
  assert.equal(Memory.getCard(f.dir,f.state,f.roleId,f.card.id).content,'新记忆');assert.deepEqual(Memory.getProfile(f.dir,f.state,f.roleId).preferences,{饮食:['新偏好']});
});
