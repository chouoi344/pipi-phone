// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
module.exports={
  id:'waiting',
  name:'消息防抖',
  isolated:true,
  description:'感知你是否还在打字，并识别一句话是否说完，自动把连续发的消息合并后再一起回复。',
  settings:[
    {key:'enabled',label:'开启消息防抖与连发合并',type:'boolean',default:true},
    {key:'mode',label:'等待方式',type:'select',default:'cloud',options:[
      {value:'cloud',label:'智能识别（没说完就多等一会儿）'},
      {value:'timer',label:'固定停顿后直接回复'}
    ],hint:'智能识别使用「模型 → 判断」中选择的模型；未配置时按固定停顿等待。'},
    {key:'cancelOnNewMessage',label:'回复中途收到你的新消息时重新组织回答',type:'boolean',default:true},
    {key:'sendThreshold',label:'完整度判定阈值',type:'number',default:0.8,min:0.1,max:0.99,step:0.05,hint:'停顿缓冲结束后判断一次；判断慢或失败时，最迟到等待上限直接回复。',advanced:true},
    {key:'idleSeconds',label:'停顿缓冲（秒）',type:'number',default:2.5,min:0,max:8,step:0.5,hint:'从最近一条消息重新计时，期间有新消息就合并；结束后才调用判断模型。',advanced:true},
    {key:'draftHoldSeconds',label:'输入框留字停手自动解锁（秒）',type:'number',default:3.5,min:0,max:60,step:0.5,hint:'框里打了字但停手没发，超过此秒数自动解锁回复前文，避免干等卡住。',advanced:true},
    {key:'incompleteWaitSeconds',label:'半句话等待（秒）',type:'number',default:3,min:1,max:300,step:1,hint:'从最近一条已发出的消息算起，整轮仍受等待上限限制。',advanced:true},
    {key:'maxWaitSeconds',label:'最长等待上限（秒）',type:'number',default:8,min:1,max:8,hint:'从这一轮第一条消息算起；到点直接回复已发内容，并停止尚未完成的判断。',advanced:true}
  ],
  hooks:{},
  tools:[],
  jobs:[],
  data:'waiting',
  page:null
};
