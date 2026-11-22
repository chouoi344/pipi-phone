// SPDX-License-Identifier: MIT
'use strict';
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
// Only a synthetic public key and a fixed signature are shipped. No test signer or private key.
const fixture=require('./waterdrop-activation.json');
function seedInstallation(dataDir,installationId=fixture.installationId){
  fs.mkdirSync(dataDir,{recursive:true});
  const db=new DatabaseSync(path.join(dataDir,'pipi.sqlite'));
  try{
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('installationId',installationId);
  }finally{db.close();}
}
module.exports={...fixture,seedInstallation};
