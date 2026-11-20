'use strict';
// Exercise the production recording/dispatch functions without a microphone or provider.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const turn = () => new Promise(resolve => setImmediate(resolve));
const funcs = ['startRecording','stopRecording','finishRecording','releaseMicrophone','releaseRecordingSession','applyDictationTranscript'];
function fixture({enabled=['voiceUnderstanding','stt'], microphone, recognize=async()=>({text:'到了'})} = {}) {
  const calls=[],uploads=[], notices=[], tracks=[], timers=new Set();
  let time=1000;
  class Recorder {
    constructor(stream){this.stream=stream;this.mimeType='audio/webm';this.state='inactive';}
    static isTypeSupported(){return true;}
    start(){this.state='recording';}
    stop(){
      this.state='inactive';
      queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['sample'])});this.onstop?.();});
    }
  }
  class Reader {readAsDataURL(){this.result='data:audio/wav;base64,dGVzdA==';this.onload();}}
  const stream=()=>{const track={ended:false,stop(){this.ended=true;}};tracks.push(track);return {getTracks:()=>[track]};};
  const scope=vm.createContext({
    window:{MediaRecorder:Recorder,PipiEngine:{serviceReady:kind=>enabled.includes(kind),resetActivity(){}},PipiAudio:{recordingWav:async x=>x}},
    navigator:{mediaDevices:{getUserMedia:()=>microphone?microphone(stream):Promise.resolve(stream())}},
    Date:{now:()=>time}, Blob,FileReader:Reader,MediaRecorder:Recorder,crypto:require('node:crypto').webcrypto,
    view:{querySelector(){return null;}},document:{hidden:false},syncComposerControls(){},refresh(){},receiveState(){},
    setTimeout(fn){timers.add(fn);return fn;},clearTimeout(fn){timers.delete(fn);},
    async apiRaw(url,blob){uploads.push({url,blob});return {url:'/api/media/'+'a'.repeat(64)+'.wav'};},
    async api(url,body){calls.push([url,JSON.parse(JSON.stringify(body))]);return url==='/api/voice/transcribe'?recognize():{state:{}};},
    toast:text=>notices.push(text)
  });
  vm.runInContext(
    "let binaryMedia=true;let recordingSession=null,dictationBusy=false,sending=false,composeComposing=false,composeText='已有草稿',composeImage='',quoteId='q1',forceBottomRole='',pendingRender=false;let route={name:'chat',arg:'alice'};const state={messages:[{id:'q1',roleId:'alice'}]};"+
    source.match(/^  function quotedMessage.*$/m)[0]+'\n'+source.match(/^  async function uploadMedia.*$/m)[0]+'\n'+
    funcs.map(name=>{
      const begin=source.match(new RegExp('^  (?:async )?function '+name+'\\(','m')).index;
      const end=source.indexOf('\n  }',begin);
      return source.slice(begin,end+4);
    }).join('\n')+
    "\nglobalThis.testUI={begin:controls=>startRecording('hold',controls),leave(){stopRecording(true);route.arg='bob';},draft:()=>[composeText,quoteId],session:()=>recordingSession};",scope);
  return {begin(){
    const ctl=new AbortController(),state={dismissed:false,capped:false};
    const ready=scope.testUI.begin({signal:ctl.signal,dismiss(){state.dismissed=true;},capped(){state.capped=true;}});
    return {ready,state,cancel:()=>ctl.abort()};
  },leave:scope.testUI.leave,draft:()=>[...scope.testUI.draft()],session:scope.testUI.session,
  advance:(ms=900)=>{time+=ms;},cap:()=>{for(const f of [...timers])f();},calls,uploads,notices,tracks};
}
test('hold: voice and send-as-text each need only their own model, preserve quoted draft',async()=>{
  for(const [choice,purpose,expected] of [['voice','voiceUnderstanding',['/api/chat/send']],['text','stt',['/api/voice/transcribe','/api/chat']]]){
    const f=fixture({enabled:[purpose]}),control=await f.begin().ready;
    assert.deepEqual(f.calls,[]);f.advance();control.stop(choice);await turn();
    assert.deepEqual(f.calls.map(([url])=>url),expected);
    const msg=f.calls.at(-1)[1];assert.equal(msg.roleId,'alice');assert.equal(msg.quoteId,'q1');
    if(choice==='voice'){assert.equal(msg.durationMs,900);assert.ok(msg.audio);assert.equal(msg.text,undefined);assert.match(msg.audio,/^\/api\/media\/[a-f0-9]{64}\.wav$/);assert.equal(f.uploads.length,1);assert.ok(f.uploads[0].blob instanceof Blob);}
    else{assert.equal(msg.text,'到了');assert.equal(msg.audio,undefined);}
    assert.deepEqual(f.draft(),['已有草稿','q1']);assert.equal(f.session(),null);
  }
});
test('hold: missing selected model, canceled hold and failed transcription never send a message',async()=>{
  for(const [choice,enabled] of [['voice',['stt']],['text',['voiceUnderstanding']]]){
    const f=fixture({enabled}),control=await f.begin().ready;
    f.advance();control.stop(choice);await turn();
    assert.deepEqual(f.calls,[]);assert.equal(f.tracks[0].ended,true);assert.match(f.notices[0],/模型/);
  }
  const cancel=fixture(),held=cancel.begin();await held.ready;held.cancel();await turn();
  assert.deepEqual(cancel.calls,[]);assert.equal(cancel.tracks[0].ended,true);
  const bad=fixture({recognize:async()=>{throw Error('识别失败');}}),control=await bad.begin().ready;
  bad.advance();control.stop('text');await turn();assert.deepEqual(bad.calls.map(x=>x[0]),['/api/voice/transcribe']);
  assert.match(bad.notices[0],/识别失败/);assert.deepEqual(bad.draft(),['已有草稿','q1']);
});
test('hold: late microphone permission and late transcription cannot send after leaving',async()=>{
  let allow,complete;
  const denied=fixture({microphone:stream=>new Promise(resolve=>{allow=()=>resolve(stream());})}),held=denied.begin();
  held.cancel();allow();await held.ready;
  assert.deepEqual(denied.calls,[]);assert.equal(denied.tracks[0].ended,true);
  const f=fixture({recognize:()=>new Promise(resolve=>{complete=resolve;})}),control=await f.begin().ready;
  f.advance();control.stop('text');await turn();f.leave();complete({text:'不要发到另一个对话'});await turn();
  assert.deepEqual(f.calls.map(x=>x[0]),['/api/voice/transcribe']);assert.equal(f.session(),null);
});
test('hold: the 60-second cap releases the microphone and waits for the final gesture',async()=>{
  const f=fixture(),held=f.begin(),control=await held.ready;
  f.advance(60000);f.cap();await turn();assert.equal(held.state.capped,true);
  assert.equal(f.tracks[0].ended,true);assert.deepEqual(f.calls,[]);
  f.advance(9000);control.stop('voice');await turn();assert.equal(f.calls[0][1].durationMs,60000);
});
