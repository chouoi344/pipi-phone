// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
module.exports={id:'caption',name:'图片转述',description:'聊天模型无法识图时，先把图片转述成文字。图片转述模型在“模型”里选择。',settings:[
  {key:'prompt',label:'转述要求',type:'textarea',default:'Please describe the image using Chinese.',maxLength:8000,advanced:true}
],hooks:{},tools:[],jobs:[],data:'caption',page:null};
