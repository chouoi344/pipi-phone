// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function apply({requested,dataDir,getMeta,setMeta,db,transaction}){
  const latch='resetPasswordConsumed',pending='passwordResetPending';
  if(!requested){if(getMeta(latch))db.prepare('DELETE FROM meta WHERE key=?').run(latch);return;}
  if(getMeta(latch)==='1')return;
  const token=crypto.randomBytes(24).toString('hex');
  const target=path.join(dataDir,'setup-token.txt'),temporary=path.join(dataDir,'.setup-token-reset-'+crypto.randomBytes(12).toString('hex')+'.tmp');
  const previous=fs.existsSync(target)?fs.readFileSync(target):null;let replaced=false;
  try{
    fs.writeFileSync(temporary,token+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temporary,target);replaced=true;
    transaction(()=>{
      db.prepare("DELETE FROM meta WHERE key='password'").run();db.exec('DELETE FROM sessions');setMeta('setupToken',token);setMeta(pending,'1');setMeta(latch,'1');
    });
  }catch(error){
    try{
      if(fs.existsSync(temporary))fs.unlinkSync(temporary);
      if(replaced){if(previous===null)fs.unlinkSync(target);else fs.writeFileSync(target,previous,{mode:0o600});}
    }catch(cleanup){throw new AggregateError([error,cleanup],'密码重置失败，设置令牌文件未还原');}
    throw error;
  }
  console.log('访问密码已重置，原资料已保留。请使用一次性设置令牌设置新密码：'+token);
}
module.exports={apply};
