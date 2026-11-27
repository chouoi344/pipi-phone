// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
module.exports={id:'actions',name:'工具调用',description:'控制好友在聊天中能用哪些工具。对话模型需启用「工具使用」。音色、参考图和个人表情在好友的角色配置里设置。',legacySettings:[{key:'allowVoice',label:'发送语音',type:'boolean'}],settings:[
  ...[
    ['allowImages','生成和发送图片','选好生图模型后可以生成新图。拍生活照还需启用「生图与自拍」。'],
    ['allowStickers','发送表情','角色根据对话，从已分配且识别完成的表情里挑选。'],
    ['allowQuote','引用回复','角色可引用你发来的某条消息再回复。'],
    ['allowRecall','撤回消息','角色可撤回自己在两分钟内发出的消息。'],
    ['allowPat','拍一拍','角色可以在聊天里拍一拍你。'],
    ['allowMoments','朋友圈互动','角色可发动态，也可以点赞和评论可见动态。'],
    ['allowProfile','修改自己的资料','角色可更新自己的名字、头像、签名、拍一拍和封面。'],
    ['allowPayments','红包和转账','角色可使用小手机内的虚拟零钱。'],
    ['allowReminders','安排提醒','角色可创建、查看、修改和删除与你约好的提醒。']
  ].map(([key,label,hint])=>({key,label,hint,type:'boolean',default:true})),
  {key:'maxSteps',label:'连续调用轮数上限',hint:'模型可以在一轮里调用多个工具，每次回复合计最多调用 8 次。',type:'number',default:5,min:1,max:20,integer:true},
  {key:'initialBalanceCents',label:'好友初始零钱（元）',hint:'新好友首次开通虚拟零钱时发放。',type:'number',unit:'yuan',default:100000,min:0,max:100000000,integer:true},
  {key:'redpacketMaxCents',label:'单个红包上限（元）',hint:'你和好友发红包时都适用。',type:'number',unit:'yuan',default:20000,min:1,max:100000000,integer:true},
  {key:'dailyRedpacketLimit',label:'好友每日发红包上限',hint:'按好友计算，填 0 关闭好友发红包。',type:'number',default:5,min:0,max:1000,integer:true},
  {key:'dailyTransferLimit',label:'好友每日发转账上限',hint:'按好友计算，填 0 关闭好友发转账。',type:'number',default:5,min:0,max:1000,integer:true},
  {key:'refundHours',label:'超时自动退还（小时）',hint:'收款方超时未处理时，零钱退回发送方。',type:'number',default:24,min:1,max:720,advanced:true}
],hooks:{},tools:[{
  definitions:(state,role,config,catalog)=>require('../actions.cjs').definitions(state,role,catalog),
  execute:(name,args,ctx)=>require('../actions.cjs').execute(name,args,{...ctx,settings:require('../registry.cjs').values(ctx.getState(),'actions'),scheduler:require('../scheduler.cjs')})
}],jobs:[{id:'payment-expiry',run({getState,mutate,now}){
  const state=getState(),refundMs=require('../registry.cjs').values(state,'actions').refundHours*3600000;
  if(state.wallet.transactions.some(t=>t.status==='pending'&&now-t.createdAt>=refundMs))mutate(s=>require('../actions.cjs').expirePayments(s,now));
}}],data:'actions',page:null};
