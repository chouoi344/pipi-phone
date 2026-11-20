// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {sampleState}=require('../scripts/sample-data.cjs');
const {createApp}=require('../server.cjs');
const S=require('../lib/state.cjs');
const Media=require('../lib/media-store.cjs');

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBHoAAAAASUVORK5CYII=';

test('process exit during migration retains the old database and complete snapshot, then restarts safely',t=>{
  const temp=fs.realpathSync(os.tmpdir()),dataDir=fs.mkdtempSync(path.join(temp,'pipi-upgrade-interruption-'));
  let app;
  t.after(async()=>{if(app)await app.close();assert.equal(path.dirname(fs.realpathSync(dataDir)),temp);fs.rmSync(dataDir,{recursive:true,force:true});});
  const sqlite=path.join(dataDir,'pipi.sqlite'),old=sampleState();
  const message=S.message(old,old.roles[0],'user',png,'image');
  const raw=JSON.stringify(old);
  const db=new DatabaseSync(sqlite);
  db.exec('CREATE TABLE app (id INTEGER PRIMARY KEY, json TEXT NOT NULL)');
  db.prepare('INSERT INTO app(id,json) VALUES(1,?)').run(raw);
  db.close();

  const script=`
    const media=require(process.argv[2]),save=media.saveImage;
    media.saveImage=(...args)=>{save(...args);process.exit(78);};
    require(process.argv[1]).createApp({dataDir:process.argv[3]});
  `;
  const killed=spawnSync(process.execPath,['-e',script,require.resolve('../server.cjs'),require.resolve('../lib/media-store.cjs'),dataDir],{
    encoding:'utf8',timeout:15000,windowsHide:true
  });
  assert.equal(killed.status,78,killed.stderr);
  const reopened=new DatabaseSync(sqlite,{readOnly:true});
  assert.equal(reopened.prepare('SELECT json FROM app WHERE id=1').get().json,raw);
  reopened.close();
  const backups=path.join(dataDir,'backups'),[originalBackup]=fs.readdirSync(backups);
  assert.match(originalBackup,/^before-0\.13\.0-.+\.json$/);
  const storedBackup=JSON.parse(fs.readFileSync(path.join(backups,originalBackup)));
  assert.equal(storedBackup.state.messages.find(item=>item.id===message.id).content,png);

  app=createApp({dataDir});
  const after=JSON.parse(app.db.prepare('SELECT json FROM app WHERE id=1').get().json);
  const recovered=after.messages.find(item=>item.id===message.id);
  assert.equal(Media.toDataUrl(dataDir,recovered.content),png);
  assert.deepEqual(fs.readdirSync(backups),[originalBackup]);
});
