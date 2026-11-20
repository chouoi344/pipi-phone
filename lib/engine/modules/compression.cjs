// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
module.exports={id:'compression',name:'长对话整理',description:'总结较早聊天或按整轮裁剪，保留最近的原话。',settings:[
  {key:'strategy',label:'处理方式',type:'select',default:'summary',options:[{value:'summary',label:'总结较早聊天'},{value:'truncate',label:'按轮次裁剪'}]},
  {key:'triggerRatio',label:'触发比例',type:'number',default:0.7,min:0.1,max:1,step:0.01},
  {key:'keepRecentRatio',label:'保留最近原话比例',type:'number',default:0.15,min:0,max:0.3,step:0.01,hint:'按当前聊天的长度计算，按完整一轮保留。'},
  {key:'maxTurns',label:'最多保留轮数',type:'number',default:70,min:-1,max:100000,integer:true,hint:'-1 表示不限，其他值至少为 1。',advanced:true},
  {key:'dropTurns',label:'每次丢弃轮数',type:'number',default:1,min:1,max:1000,integer:true,advanced:true},
  {key:'prompt',label:'整理要求',type:'textarea',default:'',maxLength:16000,hint:'留空使用内置的陪伴聊天整理要求。',advanced:true}
],hooks:{},tools:[],jobs:[],data:'compression',page:null};
