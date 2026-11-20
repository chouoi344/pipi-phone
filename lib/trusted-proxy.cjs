// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const net=require('node:net');
function address(value){
  if(typeof value!=='string')return null;
  let ip=value.trim();if(ip.startsWith('"')&&ip.endsWith('"'))ip=ip.slice(1,-1).replace(/\\(.)/g,'$1');
  if(!net.isIP(ip)){
    const bracket=ip.match(/^\[([^\]]+)\](?::\d+)?$/),port=ip.match(/^(\d+\.\d+\.\d+\.\d+):\d+$/);ip=bracket?.[1]||port?.[1]||'';
  }
  const type=net.isIP(ip);if(!type||ip.includes('%'))return null;
  if(type===4)return ip;
  ip=new URL('http://['+ip+']').hostname.slice(1,-1);
  const mapped=ip.match(/^::ffff:([a-f\d]{1,4}):([a-f\d]{1,4})$/i);
  if(mapped){const high=parseInt(mapped[1],16),low=parseInt(mapped[2],16);return [high>>8,high&255,low>>8,low&255].join('.');}
  return ip;
}
function create(value=''){
  if(typeof value!=='string')throw new Error('TRUST_PROXY 必须是 loopback、IP 或逗号分隔的网段');
  const enabled=Boolean(value.trim()),rules=new net.BlockList();
  if(enabled){
    const entries=value.split(',').map(item=>item.trim()).filter(Boolean);if(!entries.length)throw new Error('TRUST_PROXY 没有有效的地址');
    for(const entry of entries){
      if(entry==='loopback'){rules.addSubnet('127.0.0.0',8,'ipv4');rules.addAddress('::1','ipv6');continue;}
      const parts=entry.split('/'),ip=address(parts[0]),kind=ip&&net.isIP(ip);
      if(!ip||parts.length>2||parts.length===2&&(!/^\d+$/.test(parts[1])||Number(parts[1])>(kind===4?32:128)))throw new Error('TRUST_PROXY 包含无效的 IP 或网段：'+entry);
      if(parts.length===2)rules.addSubnet(ip,Number(parts[1]),kind===4?'ipv4':'ipv6');else rules.addAddress(ip,kind===4?'ipv4':'ipv6');
    }
  }
  const trusted=ip=>Boolean(ip)&&rules.check(ip,net.isIP(ip)===4?'ipv4':'ipv6');
  function context(req){
    const peer=address(req.socket.remoteAddress),peerTrusted=enabled&&trusted(peer);let client=peer;
    if(peerTrusted){
      let chain;
      if(req.headers['x-forwarded-for']!==undefined)chain=String(req.headers['x-forwarded-for']).split(',');
      else{
        const elements=String(req.headers.forwarded||'').match(/(?:"(?:\\.|[^"\\])*"|[^,])+/g)||[];
        chain=elements.map(element=>{const match=element.match(/(?:^|;)\s*for=("(?:\\.|[^"\\])*"|[^;\s]+)/i);return match?.[1]||'';});
      }
      for(let i=chain.length-1;i>=0&&trusted(client);i--){const next=address(chain[i]);if(!next)break;client=next;}
    }
    const proto=peerTrusted&&String(req.headers['x-forwarded-proto']||'').split(',').at(-1).trim().toLowerCase();
    return {client:client||req.socket.remoteAddress,secure:Boolean(req.socket.encrypted)||proto==='https'};
  }
  return {enabled,context};
}
module.exports={create,address};
