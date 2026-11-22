// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const S=require('./state.cjs');
const Time=require('./engine/time.cjs');
const lifetimeMs=60*60*1000;
const isIncoming=message=>message.status==='sent'&&(message.sender==='assistant'||message.sender==='system'&&message.meta?.kind==='pat'&&message.meta.author===message.roleId);

// A cursor also remembers IDs at its timestamp: two messages committed in the
// same millisecond must not disappear or be shown twice after reconnecting.
function view(state,encoded,now=Date.now()){
  let cursor;
  if(encoded!==null){
    if(encoded.length>65536||!/^[A-Za-z0-9_-]+$/.test(encoded))S.fail('通知游标无效');
    try{cursor=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));}
    catch{S.fail('通知游标无效');}
    if(!cursor||!Number.isSafeInteger(cursor.at)||cursor.at<0||!Array.isArray(cursor.ids)||cursor.ids.some(id=>typeof id!=='string'||id.length>100))S.fail('通知游标无效');
  }
  const outreach=state.settings.modules.outreach;
  const quiet=outreach?.quietHoursEnabled&&Time.quiet(outreach,now,state.settings.timezone||'UTC');
  const conversations=state.roles.map(role=>({id:role.id,name:role.remark||role.name,unread:role.unread,muted:Boolean(role.muted||role.permissions?.blocked||role.deleted||quiet)}));
  const roles=new Map(conversations.map(role=>[role.id,role]));
  const seen=new Set(cursor?.ids);
  const inbound=state.messages.filter(isIncoming);
  const messages=cursor?inbound.filter(message=>{
    const role=roles.get(message.roleId);
    return role&&!role.muted&&role.unread>0&&message.createdAt+ lifetimeMs>now&&message.createdAt<=now&&
      (message.createdAt>cursor.at||message.createdAt===cursor.at&&!seen.has(message.id));
  }).map(message=>({id:message.id,roleId:message.roleId,createdAt:message.createdAt,expiresAt:message.createdAt+lifetimeMs})):[];
  return {
    revision:state.revision,
    cursor:Buffer.from(JSON.stringify({at:now,ids:inbound.filter(message=>message.createdAt===now).map(message=>message.id)})).toString('base64url'),
    conversations,messages
  };
}
module.exports={view,lifetimeMs,isIncoming};
