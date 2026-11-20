// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const zlib=require('node:zlib'),{promisify}=require('node:util');
const gzip=promisify(zlib.gzip),brotli=promisify(zlib.brotliCompress);
function negotiate(value=''){
  const qualities=new Map();
  for(const part of String(value).split(',')){
    const [raw,...parameters]=part.trim().split(';'),name=raw.toLowerCase();if(!name)continue;
    let q=1;for(const parameter of parameters){const match=parameter.trim().match(/^q\s*=\s*(.*)$/i);if(match)q=/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(match[1])?Number(match[1]):0;}
    qualities.set(name,Math.max(qualities.get(name)??0,q));
  }
  const quality=name=>qualities.get(name)??qualities.get('*')??0;
  const choices=['br','gzip'].map(name=>({name,q:quality(name)})).filter(item=>item.q>0).sort((a,b)=>b.q-a.q);
  const best=choices[0],identity=qualities.get('identity');
  return {encoding:best&&!(identity!==undefined&&identity>best.q)?best.name:null,identityAllowed:identity!==0&&!(identity===undefined&&qualities.get('*')===0)};
}
function vary(value){const fields=String(value||'').split(',').map(item=>item.trim()).filter(Boolean);if(fields.includes('*'))return '*';if(!fields.some(item=>item.toLowerCase()==='accept-encoding'))fields.push('Accept-Encoding');return fields.join(', ');}
async function compress(bytes,encoding){return encoding==='br'?brotli(bytes,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:3}}):gzip(bytes,{level:3});}
module.exports={negotiate,vary,compress};
