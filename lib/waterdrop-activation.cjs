// SPDX-License-Identifier: MIT
'use strict';
const crypto=require('node:crypto');
const PREFIX='PIPI-W1-';
function normalizeInstallationId(value){
  if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))return null;
  return value.toLowerCase();
}
function message(id){return Buffer.from('pipi-phone:waterdrop:v1:'+id);}
function signCode(installationId,privateKey){
  const id=normalizeInstallationId(installationId);
  if(!id)throw new Error('安装编号格式无效');
  return PREFIX+crypto.sign(null,message(id),privateKey).toString('base64url');
}
function verifyCode(installationId,code,publicKey){
  const id=normalizeInstallationId(installationId);
  if(!id||typeof code!=='string'||!/^PIPI-W1-[A-Za-z0-9_-]{86}$/.test(code))return false;
  const encoded=code.slice(PREFIX.length),signature=Buffer.from(encoded,'base64url');
  if(signature.length!==64||signature.toString('base64url')!==encoded)return false;
  return crypto.verify(null,message(id),publicKey,signature);
}
module.exports={normalizeInstallationId,signCode,verifyCode};
