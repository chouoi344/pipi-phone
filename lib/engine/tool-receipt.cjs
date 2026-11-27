// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const descriptions={
  send_redpacket:'已发出红包，卡片已显示。',send_transfer:'已发出转账，卡片已显示。',handle_payment:'已处理这笔款项。',
  pat_user:'已拍了拍对方。',reply_quote:'已发出引用回复。',recall_message:'已撤回消息。',
  post_moment:'已发表朋友圈。',like_moment:'已点赞。',comment_moment:'已发表评论。',search_stickers:'已查询表情。',
  send_sticker:'已发表情。',send_voice:'已发送语音。',send_selfie:'已发出照片。',generate_image:'图片已保存。',send_image:'已发送图片。',
  update_own_profile:'已修改展示资料。',future_task:'已处理提醒。',select_message_targets:'已查询聊天记录。',
  query_life_schedule:'已查阅日程。',recall_memory:'已查阅共同记忆。',memorize_memory:'已处理共同记忆。',forget_memory:'已处理共同记忆。'
};
function toolResultForModel(name,value){
  if(value?.error||value?.ok===false||value?.delivered==='failed'){
    const error=value.error||'动作结果尚未确认';
    return {ok:false,error,result:'用自然的话继续聊天，不提技术原因，不要声称成功。'};
  }
  const result=descriptions[name],receipt={ok:true,result};
  if(!result)return value;
  switch(name){
    case 'send_redpacket':case 'send_transfer':case 'handle_payment':
      return {...receipt,amountYuan:value?.amountYuan??(value?.amountCents===undefined?undefined:value.amountCents/100),note:value?.note};
    case 'post_moment':return {...receipt,momentId:value?.momentId};
    case 'generate_image':return {...receipt,mediaId:value?.mediaId,result:value?.sentToChat||value?.result==='图片已保存并发送。'?'图片已保存并发送。':result};
    case 'send_selfie':return {...receipt,mediaId:value?.mediaId,photoId:value?.photoId,count:value?.count};
    case 'search_stickers':case 'select_message_targets':return value;
    case 'query_life_schedule':{
      const brief={...value};
      for(const key of ['events','promises','userEvents'])if(Array.isArray(brief[key]))brief[key]=brief[key].map(({status,...item})=>({...item,progress:status}));
      return brief;
    }
    case 'recall_memory':return {count:value?.count||0,memories:(value?.memories||[]).map(({id,type,content})=>({id,type,content}))};
    case 'memorize_memory':return {saved:value?.saved,memoryId:value?.memoryId,message:value?.message,duplicate:value?.duplicate,archived:value?.archived};
    case 'forget_memory':return {forgotten:value?.forgotten,message:value?.message,locked:value?.locked};
    case 'future_task':{
      const task=({id,note,schedule,nextAt})=>({id,note,schedule,nextAt});
      if(Array.isArray(value))return {...receipt,tasks:value.map(task)};
      return value?.deleted?{...receipt,result:'已删除提醒。'}:{...receipt,...task(value||{})};
    }
    default:return receipt;
  }
}
function describe(name,value){
  const receipt=toolResultForModel(name,value);
  return receipt?.ok===false?'动作结果尚未确认。不要声称成功，也不要自动重复操作。':receipt?.result||descriptions[name]||'已完成先前的动作。';
}
module.exports={toolResultForModel,describe};
