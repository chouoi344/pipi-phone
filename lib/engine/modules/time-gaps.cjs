// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Retired feature: preserve its old backup schema without a settings page.
module.exports={id:'timeGaps',name:'时间间隔提示',description:'已停用，仅保留旧备份格式。',settings:[
  {key:'enabled',label:'提示时间间隔',type:'boolean',default:true},
  {key:'thresholdHours',label:'超过多久提示（小时）',type:'number',default:6,min:0,max:8760,step:0.5}
],hooks:{},tools:[],jobs:[],data:'timeGaps',page:null};
