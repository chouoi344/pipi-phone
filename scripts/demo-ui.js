// SPDX-License-Identifier: MIT
'use strict';
const form=document.querySelector('#mode-form'),select=document.querySelector('#mode'),result=document.querySelector('#result');
let initialized=false,modes={};
async function load(){
  try{
    const response=await fetch('/demo/state');if(!response.ok)throw new Error('无法读取演示服务状态');const state=await response.json();modes=state.modes;
    if(!initialized){for(const [value,label] of Object.entries(modes)){const option=new Option(label,value);select.add(option);}select.value=state.mode;document.querySelector('#app-link').href=state.appUrl;document.querySelector('#password').textContent=state.password;initialized=true;}
    const rows=document.querySelector('#requests');rows.replaceChildren();
    for(const request of [...state.requests].reverse()){
      const row=document.createElement('tr');for(const value of [request.id,request.path,modes[request.mode],request.status,((request.elapsedMs??Date.now()-request.startedAt)/1000).toFixed(1)+' 秒']){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}rows.append(row);
    }
    document.querySelector('#connection').textContent='当前场景：'+modes[state.mode]+' · 本地服务已连接';
  }catch(error){document.querySelector('#connection').textContent=error.message+'；请确认演示启动命令仍在运行。';}
}
form.addEventListener('submit',async event=>{
  event.preventDefault();const button=form.querySelector('button');button.disabled=true;
  try{const response=await fetch('/demo/mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:select.value})});const state=await response.json();if(!response.ok)throw new Error(state.error);result.textContent='已切换为「'+modes[state.mode]+'」，现在回到应用发起请求。';await load();}
  catch(error){result.textContent=error.message;}finally{button.disabled=false;}
});
document.querySelector('#prepare-samples').addEventListener('click',async event=>{
  const button=event.currentTarget;button.disabled=true;
  try{const response=await fetch('/demo/samples',{method:'POST'}),value=await response.json();if(!response.ok)throw new Error(value.error);document.querySelector('#sample-result').textContent=(value.alreadyPrepared?'示例已存在':'示例已准备')+'：刷新应用，打开「'+value.roleName+'」查看语音、图片和文字引用。';}
  catch(error){document.querySelector('#sample-result').textContent=error.message;}finally{button.disabled=false;}
});
load();setInterval(load,1000);
