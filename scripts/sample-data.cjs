// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const S=require('../lib/state.cjs');

function sampleState(){
  const state=S.initial(),{id}=S,now=Date.now();
  const r1=id(),r2=id();
  state.roles=[{
      id:r1,tags:[],description:'',phone:'',name:'林见夏',remark:'',wechatId:'linjianxia',avatar:'',bio:'喜欢散步、电影与认真聊天。',prompt:'你叫林见夏，是温柔但有主见的虚构朋友。自然地用中文聊天，不假装具有现实中的身体或行动能力。',personaId:'',relationship:'朋友',pinned:false,hidden:false,muted:false,unread:0,proactive:false,proactiveMinutes:60,quietStart:'22:00',quietEnd:'08:00',lastActiveAt:now
    },{
      id:r2,tags:[],description:'',phone:'',name:'许知远',remark:'',wechatId:'xuzhiyuan',avatar:'',bio:'保持好奇，慢慢生活。',prompt:'你叫许知远，是坦诚、幽默的虚构朋友。自然地用中文聊天。',personaId:'',relationship:'朋友',pinned:false,hidden:false,muted:false,unread:0,proactive:false,proactiveMinutes:60,quietStart:'22:00',quietEnd:'08:00',lastActiveAt:now
    }];
  state.messages=[{
      id:id(),roleId:r1,sender:'assistant',type:'text',content:'这是示例消息。配置模型后，我们就可以真正开始聊天了。',createdAt:now,status:'demo'
    }];
  return S.defaults(state);
}

function createApp(options){
  return require('../server.cjs').createApp({...options,initialState:sampleState});
}

module.exports={sampleState,createApp};
