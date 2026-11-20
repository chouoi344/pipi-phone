// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const block=512;
const zeros=Buffer.alloc(block);

function padded(size){return Math.ceil(size/block)*block;}
function lengthOf(entries){const length=entries.reduce((total,{size})=>total+block+padded(size),2*block);if(!Number.isSafeInteger(length))throw new Error('备份大小超出可处理范围');return length;}

function header({name,size}){
  if(!/^[a-zA-Z0-9._/-]{1,100}$/.test(name)||!Number.isSafeInteger(size)||size<0||size>0o77777777777)throw new Error('备份文件名称或大小超出格式范围');
  const out=Buffer.alloc(block);
  out.write(name,0,100,'ascii');
  out.write('0000600\0',100,'ascii');
  out.write('0000000\0',108,'ascii');
  out.write('0000000\0',116,'ascii');
  out.write(size.toString(8).padStart(11,'0')+'\0',124,'ascii');
  out.write('00000000000\0',136,'ascii');
  out.fill(32,148,156);
  out.write('0',156,'ascii');
  out.write('ustar\0',257,'ascii');
  out.write('00',263,'ascii');
  out.write(out.reduce((total,value)=>total+value,0).toString(8).padStart(6,'0')+'\0 ',148,'ascii');
  return out;
}

async function* pack(entries){
  for(const entry of entries){
    yield header(entry);
    let sent=0;
    for await(const chunk of entry.open()){
      sent+=chunk.length;
      if(sent>entry.size)throw new Error('备份时文件大小更改');
      yield chunk;
    }
    if(sent!==entry.size)throw new Error('备份时文件大小更改');
    const padding=padded(sent)-sent;
    if(padding)yield zeros.subarray(0,padding);
  }
  yield zeros;
  yield zeros;
}

function parseOctal(buffer,start,end){
  const field=buffer.toString('ascii',start,end).replace(/\0.*$/s,'').trim();
  if(!/^[0-7]+$/.test(field))throw new Error('备份文件大小或校验字段无效');
  return Number.parseInt(field,8);
}

async function unpack(read,receive){
  const iterator=read[Symbol.asyncIterator]();
  let pending=Buffer.alloc(0);
  async function* take(bytes){
    while(bytes){
      if(!pending.length){
        const next=await iterator.next();
        if(next.done)throw new Error('备份没有传输完整');
        pending=Buffer.isBuffer(next.value)?next.value:Buffer.from(next.value);
        continue;
      }
      const count=Math.min(bytes,pending.length),part=pending.subarray(0,count);
      pending=pending.subarray(count);
      bytes-=count;
      yield part;
    }
  }
  async function readBlock(){
    const chunks=[];
    for await(const chunk of take(block))chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  function nameAndSize(raw){
    const checksum=parseOctal(raw,148,156);
    const expected=raw.reduce((total,value,index)=>total+(index>=148&&index<156?32:value),0);
    if(checksum!==expected||raw[156]!==48||!raw.subarray(257,263).equals(Buffer.from('ustar\0'))||raw.subarray(157,257).some(byte=>byte!==0)||raw.subarray(345,500).some(byte=>byte!==0))throw new Error('备份文件头无效');
    const name=raw.toString('latin1',0,100).replace(/\0.*$/s,'');
    if(!/^[a-zA-Z0-9._/-]{1,100}$/.test(name)||name.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('备份包含无效文件路径');
    return {name,size:parseOctal(raw,124,136)};
  }
  while(true){
    const raw=await readBlock();
    if(raw.equals(zeros)){
      if(!(await readBlock()).equals(zeros)||pending.some(byte=>byte!==0))throw new Error('备份结束标记无效');
      let trailer=pending.length;
      for(let next=await iterator.next();!next.done;next=await iterator.next()){
        trailer+=next.value.length;
        if(trailer>10240||next.value.some(byte=>byte!==0))throw new Error('备份结束标记无效');
      }
      return;
    }
    const entry=nameAndSize(raw);
    let consumed=0;
    async function* contents(){
      for await(const part of take(entry.size)){
        consumed+=part.length;
        yield part;
      }
    }
    await receive(entry,contents());
    if(consumed!==entry.size)throw new Error('备份中的文件没有完整读取');
    const padding=padded(entry.size)-entry.size;
    for await(const chunk of take(padding)){
      if(chunk.some(byte=>byte!==0))throw new Error('备份文件分隔无效');
    }
  }
}
module.exports={header,pack,unpack,lengthOf};
