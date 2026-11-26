// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Unit tests of the extracted production handler, not browser or DOM acceptance.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const start=source.indexOf('    let retryUntil=0;'),end=source.indexOf('    if(setup)window.PipiFirstUseNotice',start);
assert.ok(start>=0&&end>start,'Production auth countdown handler must be present');
function fixture(){
  let now=0,rejection=Object.assign(new Error('请求过多'),{retryAfter:59}),calls=0;
  const timers=[],button={disabled:false,textContent:''},error={textContent:''};
  const form={isConnected:true,querySelector:selector=>{if(selector==='[type=submit]')return button;if(selector==='.auth-error')return error;throw Error('Unexpected fixture selector: '+selector);}};
  const scope=vm.createContext({form,setup:false,Date:{now:()=>now},setTimeout:callback=>timers.push(callback),formValues:()=>({password:'Synthetic-only-password'}),api:async()=>{calls++;throw rejection;}});
  vm.runInContext(source.slice(start,end),scope);
  return {form,button,error,timers,submit:()=>form.onsubmit({preventDefault(){}}),tick(at){now=at;assert.ok(timers.length,'Expected a scheduled countdown callback');timers.shift()();},rejectWith(value){rejection=value;},get calls(){return calls;}};
}
test('auth countdown runs from 59 to 1 to 0, prevents another submit while waiting and restores the button',async()=>{
  const f=fixture();await f.submit();assert.equal(f.button.textContent,'59 秒后重试');assert.equal(f.button.disabled,true);
  await f.submit();assert.equal(f.calls,1);
  f.tick(58001);assert.equal(f.button.textContent,'1 秒后重试');assert.equal(f.button.disabled,true);
  f.tick(59000);assert.equal(f.button.textContent,'进入小手机');assert.equal(f.button.disabled,false);assert.equal(f.error.textContent,'现在可以重新输入密码');assert.equal(f.timers.length,0);
});
test('the next wrong-password response keeps its own error after the countdown expires',async()=>{
  const f=fixture();await f.submit();f.tick(59000);f.rejectWith(new Error('密码错误'));await f.submit();
  assert.equal(f.error.textContent,'密码错误');assert.equal(f.button.textContent,'进入小手机');assert.equal(f.button.disabled,false);assert.equal(f.calls,2);assert.equal(f.timers.length,0);
});
test('a disconnected auth form stops its pending countdown without scheduling another callback',async()=>{
  const f=fixture();await f.submit();assert.equal(f.timers.length,1);f.form.isConnected=false;f.tick(1000);
  assert.equal(f.timers.length,0);assert.equal(f.calls,1);
});
