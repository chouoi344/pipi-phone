// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
module.exports={id:'segments',name:'分段回复',description:'按选定规则拆开短回复，每条发出前等待一小会儿。',settings:[
  {key:'enabled',label:'开启分段回复',type:'boolean',default:true},
  {key:'intervalMode',label:'发送间隔',type:'select',default:'random',options:[{value:'random',label:'随机间隔'},{value:'length',label:'按文字长度'}]},
  {key:'minSeconds',label:'随机间隔最短（秒）',type:'number',default:1.5,min:0,max:60,showWhen:{key:'intervalMode',value:'random'}},
  {key:'maxSeconds',label:'随机间隔最长（秒）',type:'number',default:3.5,min:0,max:60,showWhen:{key:'intervalMode',value:'random'}},
  {key:'noSplitAbove',label:'分段字数上限',type:'number',default:150,min:1,max:60000,integer:true,hint:'超过这个字数的文字整条发出。'},
  {key:'splitMode',label:'分段方式',type:'select',default:'regex',options:[{value:'regex',label:'断句规则'},{value:'words',label:'分段词'}]},
  {key:'onlyLlmResult',label:'仅对模型回复分段',type:'boolean',default:true,advanced:true},
  {key:'logBase',label:'文字长度间隔的对数底数',type:'number',default:2.6,min:1.01,max:10,showWhen:{key:'intervalMode',value:'length'},advanced:true},
  {key:'sentencePattern',label:'断句正则表达式',type:'text',default:'.*?[。？！~…]+|.+$',maxLength:512,regex:true,showWhen:{key:'splitMode',value:'regex'},advanced:true},
  {key:'splitWords',label:'分段词列表',type:'textarea',default:'。\n？\n！\n~\n…',maxLength:512,hint:'每行填一个词或标点。分段时移除匹配到的分段词。',showWhen:{key:'splitMode',value:'words'},advanced:true},
  {key:'cleanupPattern',label:'内容清理规则',type:'text',default:'',maxLength:512,regex:true,hint:'用正则表达式指定要去掉的内容。留空时保留原文。',advanced:true}
],hooks:{},tools:[],jobs:[],data:'segments',page:null};
