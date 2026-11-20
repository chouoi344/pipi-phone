// SPDX-License-Identifier: MIT
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/features.js'),'utf8');
const PNG='data:image/png;base64,aGVsbG8=',GIF='data:image/gif;base64,d29ybGQ=';
// A small DOM adapter mounts the product's own markup and dispatches its actual
// listeners. Native keyboard appearance and layout are checked in the browser.
class UIEvent{
  constructor(type,options={}){Object.assign(this,{type,bubbles:false,defaultPrevented:false,...options});}
  preventDefault(){this.defaultPrevented=true;}stopPropagation(){this.stopped=true;}
}
class Element{
  constructor(tag,attributes={},env){this.tagName=tag.toUpperCase();this.attributes={...attributes};this.env=env;this.children=[];this.parentElement=null;this.listeners=new Map();this.dataset={};this.value=attributes.value||'';this.hidden=Object.hasOwn(attributes,'hidden');this.disabled=Object.hasOwn(attributes,'disabled');this.maxLength=Number(attributes.maxlength)||-1;this.connected=true;this.classes=new Set((attributes.class||'').split(/\s+/).filter(Boolean));this.classList={contains:name=>this.classes.has(name),toggle:(name,on)=>{on??=!this.classes.has(name);if(on)this.classes.add(name);else this.classes.delete(name);return on;},add:name=>this.classes.add(name)};for(const [key,value]of Object.entries(attributes))if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;}
  get isConnected(){return this.connected&&(!this.parentElement||this.parentElement.isConnected);}
  get elements(){return Object.fromEntries(this.querySelectorAll('input[name]').map(input=>[input.attributes.name,input]));}
  set innerHTML(html){this.html=html;this.children=[];mount(html,this);}get innerHTML(){return this.html||'';}
  insertAdjacentHTML(_position,html){mount(html,this);}
  setAttribute(key,value){this.attributes[key]=String(value);}hasAttribute(key){return Object.hasOwn(this.attributes,key);}
  matches(selector){return selector.split(',').some(part=>{const s=part.trim(),tag=/^[a-z][\w-]*/i.exec(s);if(tag&&this.tagName!==tag[0].toUpperCase())return false;const id=/#([\w-]+)/.exec(s);if(id&&this.attributes.id!==id[1])return false;for(const [,name]of s.matchAll(/\.([\w-]+)/g))if(!this.classes.has(name))return false;for(const [,name,value]of s.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g))if(!this.hasAttribute(name)||value!==undefined&&this.attributes[name]!==value)return false;return true;});}
  closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
  querySelectorAll(selector){const found=[];const walk=node=>{for(const child of node.children){if(child.matches(selector))found.push(child);walk(child);}};walk(this);return found;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(handler);}
  dispatchEvent(event){event.target??=this;for(let node=this;node;node=event.bubbles&&!event.stopped?node.parentElement:null){event.currentTarget=node;for(const handler of node.listeners.get(event.type)||[]){const result=handler(event);if(result?.then)this.env.pending.push(result);}}return !event.defaultPrevented;}
  focus(){this.env.document.activeElement?.blur();this.env.document.activeElement=this;this.dispatchEvent(new UIEvent('focus'));}
  blur(){if(this.env.document.activeElement===this){this.env.document.activeElement=null;this.dispatchEvent(new UIEvent('blur'));}}
  setSelectionRange(){}
  click(){if(this.disabled)return;const event=new UIEvent('click',{bubbles:true});this.dispatchEvent(event);if(!event.defaultPrevented&&this.tagName==='BUTTON'&&(this.attributes.type||'submit')==='submit')this.closest('form')?.dispatchEvent(new UIEvent('submit',{bubbles:true}));}
}
function mount(html,parent){
  const stack=[parent];for(const token of html.match(/<\/?[\w-]+\b[^>]*>|[^<]+/g)||[]){
    if(!token.startsWith('<'))continue;
    const tag=/^<\/?([\w-]+)/.exec(token)[1].toLowerCase();
    if(token.startsWith('</')){if(stack.length>1)stack.pop();continue;}
    const attributes={};for(const [,name,quoted,single,bare]of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attributes[name]=quoted??single??bare??'';
    const node=new Element(tag,attributes,parent.env),container=stack.at(-1);node.parentElement=container;container.children.push(node);
    if(!/\/>$/.test(token)&&!['input','img','br','hr','meta','link'].includes(tag))stack.push(node);
  }
}
function fixture(type='redpacket'){
  const data={profile:{name:'我'},roles:[{id:'friend',name:'朋友',wechatId:'friend_id'}],wallet:{balanceCents:100000,transactions:[]},stickers:[{id:'saved',image:PNG}]};
  const calls=[],notices=[],reads=[],env={pending:[],document:null};let form,actError='';
  const document={activeElement:null,querySelector:selector=>selector==='#overlay > .page-editor .modal-form'?form:form?.querySelector(selector),querySelectorAll:selector=>form?.querySelectorAll(selector)||[]};env.document=document;
  const P={getState:()=>data,icons:{},esc:value=>String(value??''),avatar:()=>'',toast:message=>notices.push(message),refresh(){},closePage(){form.connected=false;},goBack(){},
    openPage(_title,html,submit){form=new Element('form',{},env);form.innerHTML='<div class="modal-header"></div>'+html;form.addEventListener('submit',async event=>{event.preventDefault();await submit(form);});},
    uploadImageData:async image=>image,
    uploadImage:async file=>{reads.push(file.name);if(file.error)throw new Error(file.error);return file.image;},
    act:async(type,payload)=>{calls.push({type,payload});if(actError)throw new Error(actError);if(type==='sticker.add')for(const image of payload.images)data.stickers.push({id:'new-'+data.stickers.length,image});},openChildDialog:()=>true,closeChildDialog(){}};
  const context=vm.createContext({window:{Pipi:P},document,crypto:{randomUUID:()=> 'isolated-ui-request'},Event:UIEvent,FormData:class{constructor(form){this.form=form;}get(key){return this.form.elements[key]?.value??null;}},setTimeout,clearTimeout,setInterval,clearInterval,AbortController});
  vm.runInContext(source,context);context.window.PipiFeatures.transfer(type,'friend');
  const find=selector=>{const node=form.querySelector(selector);assert.ok(node,'missing '+selector);return node;};
  return {data,calls,notices,reads,form,find,setError:value=>actError=value,
    mode:()=>form.dataset.payInput,click:selector=>find(selector).click(),key:value=>find('[data-pay-key="'+value+'"]').click(),
    async flush(){while(env.pending.length)await Promise.all(env.pending.splice(0));},
    keydown(node,key){const event=new UIEvent('keydown',{key,bubbles:true,isComposing:false});node.dispatchEvent(event);if(key==='Enter'&&!event.defaultPrevented&&node.tagName==='INPUT')form.dispatchEvent(new UIEvent('submit',{bubbles:true}));return event;},
    focusNote(value){form.elements.note.value=value;form.elements.note.focus();},active:()=>document.activeElement};
}
test('redpacket switches exclusively between amount, blessing, favorite stickers and no panel',()=>{
  const f=fixture(),pad=f.find('.pay-keypad'),stickers=f.find('.redpacket-sticker-panel');
  assert.equal(f.mode(),'none');assert.equal(pad.hidden,true);assert.equal(stickers.hidden,true);
  f.click('[data-pay-focus]');assert.equal(f.mode(),'amount');assert.equal(pad.hidden,false);
  f.focusNote('平安喜乐');assert.equal(f.mode(),'note');assert.equal(pad.hidden,true);assert.equal(f.active(),f.form.elements.note);
  f.click('#redpacket-emoji');assert.equal(f.mode(),'stickers');assert.equal(pad.hidden,true);assert.equal(stickers.hidden,false);assert.equal(f.active(),null);
  assert.equal(f.find('[data-packet-tab="favorites"]').attributes['aria-selected'],'true');assert.ok(f.find('[data-packet-sticker="saved"]'));
  f.click('[data-packet-collapse]');assert.equal(f.mode(),'none');assert.equal(stickers.hidden,true);
  f.click('#redpacket-emoji');f.click('.redpacket-total');assert.equal(f.mode(),'none');assert.equal(stickers.hidden,true);assert.equal(f.form.elements.note.value,'平安喜乐');
});
test('amount keys keep two decimal places, deletion and Done work, and Enter in a blessing does not send',async()=>{
  const f=fixture();f.click('[data-pay-focus]');for(const key of ['.','1','2','3','.'])f.key(key);
  assert.equal(f.form.elements.amount.value,'0.12');assert.equal(f.find('#redpacket-total').textContent,'0.12');
  f.key('back');f.key('5');assert.equal(f.form.elements.amount.value,'0.15');f.key('done');assert.equal(f.mode(),'none');assert.equal(f.find('.pay-keypad').hidden,true);assert.equal(f.calls.length,0);
  f.focusNote('祝福草稿');const event=f.keydown(f.form.elements.note,'Enter');await f.flush();
  assert.equal(event.defaultPrevented,true);assert.equal(f.mode(),'none');assert.equal(f.calls.length,0);assert.equal(f.form.elements.note.value,'祝福草稿');assert.equal(f.form.elements.amount.value,'0.15');
});
for(const remove of [false,true])test('selected redpacket sticker '+(remove?'can be removed':'is sent')+' without losing amount or blessing',async()=>{
  const f=fixture();f.click('[data-pay-focus]');for(const key of ['1','2','.','3','4'])f.key(key);f.focusNote('一起开心');f.click('#redpacket-emoji');f.click('[data-packet-sticker="saved"]');
  const preview=f.find('.redpacket-selected-sticker');assert.equal(preview.hidden,false);assert.equal(preview.querySelector('img').src,PNG);assert.equal(f.mode(),'none');
  if(remove){preview.querySelector('button').click();assert.equal(preview.hidden,true);}
  assert.equal(f.form.elements.amount.value,'12.34');assert.equal(f.form.elements.note.value,'一起开心');f.click('.wallet-pay-confirm');await f.flush();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].type,'wallet.transfer');const payload=f.calls[0].payload;assert.equal(payload.amountCents,1234);assert.equal(payload.note,'一起开心');assert.equal(payload.type,'redpacket');assert.equal(payload.stickerImage,remove?undefined:PNG);
});
test('transfer retains its initially open keypad and sends without a redpacket attachment',async()=>{
  const f=fixture('transfer');assert.equal(f.mode(),'amount');assert.equal(f.find('.pay-keypad').hidden,false);assert.equal(f.form.querySelector('#redpacket-emoji'),null);
  for(const key of ['2','5','.','5','0'])f.key(key);f.click('.wallet-pay-confirm');await f.flush();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].payload.type,'transfer');assert.equal(f.calls[0].payload.amountCents,2550);assert.equal(Object.hasOwn(f.calls[0].payload,'stickerImage'),false);
});
test('multiple sticker files submit one complete request and failures leave the panel, amount and blessing unchanged',async()=>{
  const f=fixture();f.click('[data-pay-focus]');f.key('6');f.focusNote('保留祝福');f.click('#redpacket-emoji');const upload=f.find('[data-packet-upload]');assert.equal(upload.hasAttribute('multiple'),true);
  upload.files=[{name:'a.png',image:PNG},{name:'b.gif',image:GIF}];upload.dispatchEvent(new UIEvent('change'));await f.flush();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].type,'sticker.add');assert.deepEqual([...f.calls[0].payload.images],[PNG,GIF]);assert.equal(f.data.stickers.length,3);assert.equal(f.form.querySelectorAll('[data-packet-sticker]').length,3);
  const before=f.find('.redpacket-sticker-content').innerHTML;upload.files=[{name:'valid.png',image:PNG},{name:'bad.svg',error:'不支持此图片'}];upload.dispatchEvent(new UIEvent('change'));await f.flush();
  assert.equal(f.calls.length,1);assert.equal(f.notices.at(-1),'不支持此图片');assert.equal(f.find('.redpacket-sticker-content').innerHTML,before);
  f.setError('表情库空间不足');upload.files=[{name:'valid.png',image:GIF}];upload.dispatchEvent(new UIEvent('change'));await f.flush();
  assert.equal(f.calls.length,2);assert.equal(f.notices.at(-1),'表情库空间不足');assert.equal(f.data.stickers.length,3);assert.equal(f.find('.redpacket-sticker-content').innerHTML,before);assert.equal(f.form.elements.amount.value,'6');assert.equal(f.form.elements.note.value,'保留祝福');assert.equal(f.mode(),'stickers');
});
