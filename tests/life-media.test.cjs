// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../lib/state.cjs'),Photo=require('../lib/engine/modules/selfie.cjs'),Core=require('../lib/engine/photo-core.cjs');
const {createSynthesisQueue}=require('../lib/synthesis-queue.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('group photos vary framing and bind body reference only to full-body shots',()=>{
  assert.deepEqual(Photo.validateShotPlan([{angle:'侧面'},{}],2),[{angle:'侧面'},{}]);
  const shots=Core.buildShotPrompts({role:{faceReferences:['face'],bodyReferences:['body']},rawPrompt:'轻轻笑一点',count:2,scheduleState:{mood:'高兴',outfit:'白衬衣',scene:'家里'},shotPlan:[{framing:'近景',expression:'闭嘴轻笑'},{framing:'全身',angle:'侧面'}]});
  assert.deepEqual(shots[0].references,['face']);assert.deepEqual(shots[1].references,['face','body']);
  assert.match(shots[0].prompt,/当前心情底色：高兴/);assert.match(shots[0].prompt,/不夸张咧嘴或露齿/);assert.match(shots[1].prompt,/本组第2\/2张/);
});
test('continuation inherits visible scene instead of current schedule and updates mood',()=>{
  const [shot]=Core.buildShotPrompts({role:{},rawPrompt:'再笑一点',mode:'edit',sourceImage:'source',scheduleState:{outfit:'新衣服',scene:'新地点',mood:'愉快'}});
  assert.doesNotMatch(shot.prompt,/新衣服|新地点/);assert.match(shot.prompt,/愉快/);assert.match(shot.prompt,/原图实际可见的衣服/);
});
test('history resolves exact group ordinal and refuses missing targets',()=>{
  const state={engine:{data:{selfie:{photos:{r:[{id:'one',groupId:'a',photoIndex:1,groupCount:2},{id:'two',groupId:'a',photoIndex:2,groupCount:2},{id:'new',groupId:'b',photoIndex:1,groupCount:1}]}}}}};
  assert.equal(Photo.selectPhoto(state,'r',{prompt:'刚才那组第二张'}).id,'two');assert.equal(Photo.selectPhoto(state,'r',{}).id,'new');assert.throws(()=>Photo.selectPhoto(state,'r',{sourcePhotoId:'one',prompt:'刚才那组第二张'}),/不一致/);assert.throws(()=>Photo.selectPhoto(state,'r',{sourcePhotoId:'missing'}),/找不到/);
});
test('each generated photo is reported before a later shot fails',async t=>{
  const state=sampleState(),role=state.roles[0],P=require('../lib/providers.cjs');
  const previous=P.generateImage;let calls=0;const saved=[];
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWVQAAAAASUVORK5CYII=';
  P.generateImage=async()=>{if(++calls===2)throw new Error('isolated second failure');return png;};t.after(()=>{P.generateImage=previous;});
  await assert.rejects(Photo.generateRolePhoto(state,role,{prompt:'随手拍',count:2,onPhoto:photo=>saved.push(photo)}),/isolated second failure/);
  assert.equal(saved.length,1);assert.equal(saved[0].photoIndex,1);assert.equal(saved[0].groupCount,2);assert.ok(saved[0].groupId);
});
test('synthesis shares pending requests, limits concurrency and cancellation blocks delivery',async()=>{
  const synthesize=createSynthesisQueue(2),release=[];let calls=0,active=0,peak=0;
  const run=()=>{calls++;active++;peak=Math.max(peak,active);return new Promise(resolve=>release.push(()=>{active--;resolve('audio');}));};
  const controller=new AbortController();
  const a=synthesize('same',run,{signal:controller.signal});const b=synthesize('same',run);const c=synthesize('other',run);const d=synthesize('third',run);
  await tick();assert.equal(calls,2);controller.abort();await assert.rejects(a,{name:'AbortError'});release.shift()();assert.equal(await b,'audio');await tick();assert.equal(calls,3);while(release.length)release.shift()();await Promise.all([c,d]);assert.equal(peak,2);
});
test('cancelled queued synthesis never starts',async()=>{
  const synthesize=createSynthesisQueue(1);let release;const first=synthesize('first',()=>new Promise(resolve=>{release=resolve;}));await tick();
  let called=false;const controller=new AbortController(),next=synthesize('next',()=>{called=true;},{signal:controller.signal});controller.abort();await assert.rejects(next,{name:'AbortError'});release('ok');await first;await tick();assert.equal(called,false);
});

test('tool persists first shot after second fails and resends without model',async t=>{
  let state=sampleState();state.messages=[];state.settings.ai.assign.image='isolated-image';
  const roleId=state.roles[0].id,P=require('../lib/providers.cjs'),previous=P.generateImage;let calls=0;
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWVQAAAAASUVORK5CYII=';
  P.generateImage=async()=>{if(++calls===2)throw new Error('isolated failure');return image;};t.after(()=>{P.generateImage=previous;});
  const ctx={roleId,getState:()=>structuredClone(state),mutate:fn=>{const next=structuredClone(state),value=fn(next);state=next;return {value,state};}};
  await assert.rejects(Photo.tools[0].execute('send_selfie',{prompt:'拍两张',count:2},ctx),/isolated failure/);
  assert.equal(state.engine.data.selfie.photos[roleId].length,1);assert.equal(state.messages.length,1);
  state.settings.ai.assign.image='';
  await Photo.tools[0].execute('send_selfie',{action:'resend',prompt:''},ctx);
  assert.equal(calls,2);assert.equal(state.messages.length,2);assert.equal(state.messages[1].content,image);
});
test('continuation keeps original identity snapshot and generic edits use user photo',()=>{
  const state=sampleState(),role=state.roles[0];
  state.engine.data.selfie={photos:{[role.id]:[{id:'old',kind:'selfie',image:'source',identity:{faceReferences:['original'],bodyReferences:[],appearancePrompt:'original identity'}}]}};
  role.faceReferences=['new'];
  const plan=Photo.buildPhotoPlan(state,role,{action:'continue',prompt:'换角度'});
  assert.ok(plan.references.includes('original'));assert.ok(!plan.references.includes('new'));
  state.messages=[{roleId:role.id,sender:'user',type:'image',content:'user-image'}];
  assert.throws(()=>Photo.buildPhotoPlan(state,role,{kind:'edit',prompt:'把背景改蓝'}),/来源照片或用户图片/);
  const edit=Photo.buildPhotoPlan(state,role,{kind:'edit',prompt:'把背景改蓝',userImage:'user-image'});
  assert.deepEqual(edit.references,['user-image']);assert.match(edit.prompt,/仅按本次要求调整/);
});
test('user framing, capture, ratio and closed-mouth smile win over conflicting AI details',()=>{
  const role={faceReferences:['face'],bodyReferences:['body']};
  const userText='给我拍张照片，只要半身，定时自拍，9:16，笑一点，别露牙。';
  const [shot]=Core.buildShotPrompts({
    role,userText,outfitImage:'clothes',aspectRatio:'16:9',
    rawPrompt:'全身，对镜自拍，横图 16:9，露齿笑，窗边自然光。',
    shotPlan:[{capture:'手持自拍',framing:'全身，头到脚',angle:'左前侧',action:'轻轻回头',expression:'露出牙齿灿烂大笑'}]
  });
  assert.equal(shot.ratio,'9:16');
  assert.equal(shot.userRatio,'9:16');
  assert.equal(shot.roleInFrame,true);
  assert.equal(shot.size,'1152x2048');
  assert.deepEqual(shot.references,['face','clothes']);
  assert.match(shot.referenceRoles[1],/只参考衣服/);
  assert.ok(shot.prompt.includes('用户原话：'+userText));
  assert.match(shot.prompt,/具体画面（模型补充）：窗边自然光/);
  assert.doesNotMatch(shot.prompt,/露出牙齿灿烂大笑|横图 16:9/);
  assert.deepEqual(shot.spec,{angle:'左前侧',action:'轻轻回头',capture:'定时自拍',framing:'半身',expression:'笑一点。嘴唇自然闭合，不露齿。'});
});
test('numbered user requests select body references per shot and preserve deliberate expression',()=>{
  const role={faceReferences:['face'],bodyReferences:['body']};
  const userText='拍两张。第一张近景，别笑。第二张从头到脚，微笑。';
  const shots=Core.buildShotPrompts({
    role,userText,count:2,rawPrompt:'窗边自然光。',
    shotPlan:[{framing:'全身',expression:'嘴角上扬'},{framing:'半身',expression:'不要微笑'}]
  });
  assert.deepEqual(shots.map(shot=>shot.references),[['face'],['face','body']]);
  assert.deepEqual(shots.map(shot=>shot.spec.framing),['近景','从头到脚']);
  assert.deepEqual(shots.map(shot=>shot.spec.expression),['不微笑。','微笑']);
  assert.ok(shots.every(shot=>shot.prompt.includes('用户原话：'+userText)));
  assert.doesNotMatch(shots[0].prompt,/嘴角上扬/);
  assert.doesNotMatch(shots[1].prompt,/不要微笑/);
});
test('scene and food never infer a visible role, and generic edits only use supplied source images',()=>{
  const role={faceReferences:['face'],bodyReferences:['body'],appearancePrompt:'固定外貌'};
  const base={role,outfitImage:'clothes',scheduleState:{outfit:'日程衣服',mood:'日程心情',scene:'日程地点'},stylePrompt:'默认手机自拍'};
  for(const kind of ['food','scene']){
    const [shot]=Core.buildShotPrompts({...base,kind,rawPrompt:'我端着餐盘，镜子里的衣柜旁边有花。'});
    assert.deepEqual(shot.references,[]);
    assert.equal(shot.roleInFrame,false);
    assert.doesNotMatch(shot.prompt,/固定外貌|日程衣服|日程心情|参考图用途/);
    const [continued]=Core.buildShotPrompts({...base,kind,mode:'edit',sourceImage:'old',rawPrompt:'换个角度'});
    assert.deepEqual(continued.references,['old']);
    assert.doesNotMatch(continued.prompt,/人物身份|日程衣服|日程心情|日程地点/);
  }
  const [edit]=Core.buildShotPrompts({...base,kind:'edit',hasHumanOverride:true,userImage:'upload',userText:'把背景改蓝。'});
  assert.deepEqual(edit.references,['upload']);
  assert.match(edit.prompt,/仅按本次要求调整/);
  assert.doesNotMatch(edit.prompt,/人物身份|固定外貌|日程衣服|日程心情|日程地点|默认手机自拍/);
});
test('explicit empty frame prevents role references and overrides a conflicting angle',()=>{
  const role={faceReferences:['face'],bodyReferences:['body'],appearancePrompt:'固定外貌'};
  const rawPrompt='对镜自拍，带笑意，侧面，窗外雨景。';
  for(const userText of ['窗外的雨，不要人物，俯拍。','你不入镜，只拍窗外雨景，俯拍。']){
    const shots=Core.buildShotPrompts({
      role,userText,rawPrompt,count:2,userImage:'userIdentity',outfitImage:'clothes',
      scheduleState:{outfit:'日程衣服',mood:'高兴'},
      shotPlan:[
        {framing:'全身',capture:'自拍',expression:'灿烂大笑',angle:'仰拍'},
        {framing:'半身',capture:'对镜自拍',action:'轻轻回眸',angle:'背面'}
      ]
    });
    for(const shot of shots){
      assert.equal(shot.roleInFrame,false);
      assert.deepEqual(shot.references,[]);
      assert.deepEqual(shot.spec,{angle:'俯拍'});
      assert.match(shot.prompt,/窗外雨景/);
      assert.match(shot.prompt,/保持同一主体与环境/);
      assert.doesNotMatch(shot.prompt,/固定外貌|日程衣服|表情|对镜自拍|参考图用途/);
    }
  }
});

test('portrait uses one candid-photo baseline and filters AI studio style and template poses',()=>{
  const userText='在窗边给我拍一张，手里拿着书。';
  const rawPrompt='站在窗边，影棚式布光，柔光箱，明显美颜，皮肤光滑无瑕，电影级调色，轻轻回眸，右前侧约45度，每张都同一机位，背景是旧书柜。';
  const [shot]=Core.buildShotPrompts({
    role:{faceReferences:['face']},userText,rawPrompt,stylePrompt:Core.LEGACY_SELFIE_STYLE,
    shotPlan:[{capture:'把手机固定在桌上，柔光箱',framing:'半身，棚拍',angle:'自然平视、左前侧约45度',action:'把书放下、固定的姿势、轻轻回眸',expression:'眼神放松、照片精修'}]
  });
  assert.equal(shot.prompt.split(Core.SELFIE_STYLE).length,2);
  assert.ok(shot.prompt.includes('用户原话：'+userText));
  assert.match(shot.prompt,/三视图只用来认长相/);
  assert.match(shot.prompt,/身份参考图不决定打光、构图、画风和修饰效果/);
  assert.match(shot.prompt,/站在窗边，背景是旧书柜/);
  assert.doesNotMatch(shot.prompt,/手机前置|影棚式布光|柔光箱|明显美颜|肤光滑无瑕|电影级调色|轻轻回眸|约45度|同一机位|固定的姿势/);
  assert.deepEqual(shot.spec,{capture:'把手机固定在桌上',framing:'半身',angle:'自然平视',action:'把书放下',expression:'眼神放松'});
});

test('explicit style and posture override only the relevant candid defaults',()=>{
  const userText='这张用影楼布光，左前侧约45度，不要磨皮和电影感，也别回眸。';
  const [shot]=Core.buildShotPrompts({
    role:{},userText,stylePrompt:Core.SELFIE_STYLE,
    rawPrompt:'影楼布光，左前侧约45度，强磨皮，电影级色调，轻轻回眸，手放在杯子旁。',
    shotPlan:[{capture:'影楼布光',angle:'左前侧约45度',action:'手放在杯子旁，轻轻回眸',expression:'下巴放松、强磨皮'}]
  });
  assert.equal(shot.prompt.split(Core.SELFIE_STYLE).length,2);
  assert.ok(shot.prompt.includes('用户原话：'+userText));
  assert.match(shot.prompt,/具体画面（模型补充）：影楼布光，左前侧约45度，手放在杯子旁/);
  assert.doesNotMatch(shot.prompt,/强磨皮|电影级色调|轻轻回眸/);
  assert.deepEqual(shot.spec,{capture:'影楼布光',angle:'左前侧约45度',action:'手放在杯子旁',expression:'下巴放松'});
});

test('portrait series drop fixed fallback poses while a continuation keeps source lighting',()=>{
  const role={faceReferences:['face'],bodyReferences:['body']};
  const series=Core.buildShotPrompts({role,rawPrompt:'窗边等雨停',count:3});
  assert.deepEqual(series.map(shot=>shot.spec),[{},{},{}]);
  assert.ok(series.every(shot=>shot.prompt.includes('保持同一个人、同一套衣服和同一个场景')));
  const outfits=Core.buildShotPrompts({role,rawPrompt:'换好衣服了',kind:'outfit',count:2});
  assert.deepEqual(outfits.map(shot=>shot.spec),[{framing:'全身，头到脚完整入画'},{framing:'全身，头到脚完整入画'}]);
  assert.ok(outfits.every(shot=>shot.references.includes('body')));
  const [continued]=Core.buildShotPrompts({role,rawPrompt:'喝一口水',mode:'edit',sourceImage:'original'});
  assert.deepEqual(continued.references,['original','face']);
  assert.ok(continued.prompt.includes(Core.SELFIE_STYLE));
  assert.match(continued.prompt,/以原图实际可见的衣服、环境与光线为准/);
  const [food]=Core.buildShotPrompts({role,rawPrompt:'台灯下的小碗',kind:'food',stylePrompt:Core.LEGACY_SELFIE_STYLE});
  assert.ok(!food.prompt.includes(Core.SELFIE_STYLE));
  assert.ok(food.prompt.includes(Core.LEGACY_SELFIE_STYLE));
});
