// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

const SIZES_4K={
  '1:1':'2880x2880','16:9':'3840x2160','9:16':'2160x3840','5:4':'3200x2560',
  '4:5':'2560x3200','4:3':'3264x2448','3:4':'2448x3264','3:2':'3504x2336',
  '2:3':'2336x3504','21:9':'3808x1632'
};

const SIZES_2K={
  '1:1':'2048x2048','16:9':'2048x1152','9:16':'1152x2048','5:4':'2080x1664',
  '4:5':'1664x2080','4:3':'2048x1536','3:4':'1536x2048','3:2':'2064x1376',
  '2:3':'1376x2064','21:9':'2016x864'
};

function halfSize(size){
  const [w,h]=String(size||'1536x2048').split('x').map(Number);
  return `${Math.floor(w/32)*16}x${Math.floor(h/32)*16}`;
}

const SIZES_1K=Object.fromEntries(Object.entries(SIZES_2K).map(([r,s])=>[r,halfSize(s)]));
const TIERS={'1K':SIZES_1K,'2K':SIZES_2K,'4K':SIZES_4K};
const DEFAULT_RATIO='3:4';
const DEFAULT_TIER='2K';

const SELFIE_STYLE='像聊天时临时拿起手机随手拍一张。用现场已有的光线，保留自然的皮肤纹理。距离、构图和表情跟着当时的场景走。默认避免棚拍打光、美颜磨皮、人像精修和电影感调色。';
const LEGACY_SELFIE_STYLE='手机前置随手拍质感，自然光影，真实生活气息，细节清晰';
const CAPTURE_POLICY='拍摄逻辑：近景手持自拍采用真实的一臂距离、自然透视与随手构图，手机通常在画面外；全身取景可用手机定时或场景中可用的镜面自拍，不强行用一臂距离拍全身。对镜时允许手机自然入镜，持握、数量和镜面反射必须合理；不把每张都改成对镜。定时、第三人或视角拍摄时设备在画面外，不生成多余手机或相机界面。';
const FOOD_GUIDANCE='日常食物按现场自然呈现，油光适度，别自行增添强反光、浓烈红亮或大量蒸汽。';
const FOOD_STYLING_RE=/酱汁浓郁[、 ]*色泽红亮|色泽红亮|油光(?:锃亮|四溢|强烈|很重|明显)|(?:散发着|冒着)?腾腾热气|热气腾腾|大量蒸汽|浓烈蒸汽/g;
const FOOD_STYLE_REQ_RE=/广告|美食海报|油光|红亮|热气|蒸汽/;
const FULL_BODY_RE=/(?:全身|全身照|从头到脚|穿搭全貌|整套穿搭|全身镜|落地镜|大长腿|站姿全貌)/;
const RATIO_LITERAL_RE=/(?<![0-9])([0-9]{1,2})\s*[:：比]\s*([0-9]{1,2})(?![0-9])/g;
const RATIO_NEGATION_RE=/(?:不要|别|不用|不想(?:要)?)(?:再)?\s*(?:(?:用|选|按|拍(?:成)?|改成|做成|采用)\s*)?(?:比例\s*(?:为|用|[:：])?\s*)?$/;
const FRAMINGS=[['全身',FULL_BODY_RE],['半身',/半身|腰部以上/],['近景',/近景|特写|大头照|肩颈以上/],['中景',/中景|膝盖以上/]];
const CAPTURES=[['对镜',/对镜|对着镜子拍|镜子前(?:拍|自拍)/],['定时',/定时自拍|定时拍|手机定时|倒计时拍/],['手持',/手持|拿着手机拍|手拿手机拍/],['第三人',/第三人|旁人帮拍|别人帮拍/],['第一视角',/第一[人称]*视角/]];
const ANGLES=[['正面',/正面|正对镜头/],['侧面',/侧面|侧拍/],['背面',/背面|背影/],['俯拍',/俯拍|从上往下拍/],['仰拍',/仰拍|从下往上拍/]];
const NO_PERSON=/(?:不要|别|不用|禁止)\s*(?:有|让)?\s*(?:任何)?(?:人物|人|角色)(?:\s*(?:入镜|出镜|出现)|(?=$|[，。；、\s]))|(?:人物|角色|你|人)\s*(?:不要|别|不用|不)\s*(?:入镜|出镜|出现)/;
const PERSON_CUE=/自拍|肖像|人像|人物|全身|半身|入镜|出镜|合影|合照|回眸|表情|微笑|笑意|笑容/;
const NO_SMILE=/(?:不要|别|不必|不用|禁止)\s*(?:再)?\s*(?:笑|微笑|露出笑容)(?!得|太|这么|那么)|不(?:微笑|笑)(?=$|[，。；、\s])/;
const NO_TEETH=/(?:不要|别|不必|不用|禁止|不)\s*(?:再)?\s*露(?:出)?(?:牙(?:齿)?|齿)/;
const SMILE_REQUEST=/微笑|轻轻笑|轻笑|笑(?:开)?一点|笑一笑|笑一下|笑着|带点笑意/;
const SMILE_CUE=/笑|嘴角(?:微微|稍稍|轻轻)?(?:上扬|扬起|轻扬|勾起)|(?:扬起|轻扬|勾起)嘴角/;
const TEETH_CUE=/露(?:出)?[一整排洁白的]*(?:牙(?:齿)?|齿)|龇牙|咧嘴|(?:开口|张(?:开)?嘴)(?:大)?笑/;
const SELFIE_DETAIL_CUES=[
  /棚拍|棚灯|(?:摄影棚|影棚|照相馆|影楼)(?:式)?(?:打光|灯光|布光|柔光|质感|风格)|(?:专业摄影|影室)灯|柔光箱|(?:三点|伦勃朗)布光/g,
  /美颜|磨皮|精修|(?:无毛孔|光滑无瑕|无瑕)(?:的)?(?:肌肤|皮肤)|(?:肌肤|皮肤)光滑无瑕/g,
  /电影感|电影级(?:调色|色调|光影|布光|滤镜)|(?:电影式|青橙)(?:调色|色调|滤镜)/g,
  /(?:约\s*)?45\s*(?:度|°)/g,
  /回眸/g,
  /固定(?:的)?(?:机位|姿势|角度)|(?:每张|各张)(?:都)?(?:用|采用|保持)?(?:同一|相同)(?:的)?(?:机位|姿势|角度)/g
];
const SELFIE_CUE_NEGATION_RE=/(?:避免|不要|拒绝|没有|不用|不想(?:要)?|不需要|去掉|不像|不是|别|无|非|不)(?:再)?\s*(?:(?:使用|采用|加入|用|做|过度|刻意|明显)\s*)?(?:[^，。；;！？!?\n]{1,20}(?:、|和|或|以及)\s*)?$/;

function parseSizeSetting(text){
  const raw=String(text||'').trim();
  if(!raw)return {ratio:DEFAULT_RATIO,tier:DEFAULT_TIER,exact:'',size:TIERS[DEFAULT_TIER][DEFAULT_RATIO]};
  const exact=raw.match(/^(\d{3,4})\s*[xX×*]\s*(\d{3,4})$/);
  if(exact){
    const w=Math.max(256,Math.min(4096,Number(exact[1]))),h=Math.max(256,Math.min(4096,Number(exact[2])));
    const ratio=nearestRatio(w,h);
    return {ratio,tier:DEFAULT_TIER,exact:`${w}x${h}`,size:`${w}x${h}`};
  }
  let ratio=DEFAULT_RATIO,tier=DEFAULT_TIER;
  const rMatch=raw.match(/(\d{1,2})\s*[:：]\s*(\d{1,2})/);
  if(rMatch){
    const candidate=`${Number(rMatch[1])}:${Number(rMatch[2])}`;
    if(SIZES_2K[candidate])ratio=candidate;
  }
  const tMatch=raw.match(/([124])\s*[kK]/);
  if(tMatch)tier=`${tMatch[1]}K`;
  return {ratio,tier,exact:'',size:TIERS[tier][ratio]};
}

function nearestRatio(w,h){
  const target=w/h;
  let best=DEFAULT_RATIO,bestDiff=Infinity;
  for(const ratio of Object.keys(SIZES_2K)){
    const [rw,rh]=ratio.split(':').map(Number);
    const diff=Math.abs(target-rw/rh);
    if(diff<bestDiff){bestDiff=diff;best=ratio;}
  }
  return best;
}

function smallerSize(currentSize){
  const m=String(currentSize||'').match(/^(\d+)x(\d+)$/);
  if(!m)return '';
  const w=Number(m[1]),h=Number(m[2]),px=w*h;
  const ratio=nearestRatio(w,h);
  const s4=SIZES_4K[ratio],s2=SIZES_2K[ratio],s1=SIZES_1K[ratio];
  const p2=(()=> {const [a,b]=s2.split('x').map(Number);return a*b;})();
  const p1=(()=> {const [a,b]=s1.split('x').map(Number);return a*b;})();
  if(px>p2)return s2;
  if(px>p1)return s1;
  return '';
}

function requestedRatio(text,proposed='',defaultRatio=DEFAULT_RATIO){
  const input=String(text||'');
  const clauses=input.split(/[，,。；;！？!?]/);
  const rejected=new Set();
  for(const clause of clauses){
    RATIO_LITERAL_RE.lastIndex=0;
    let m;
    while((m=RATIO_LITERAL_RE.exec(clause))){
      const candidate=`${Number(m[1])}:${Number(m[2])}`;
      if(SIZES_2K[candidate]){
        if(RATIO_NEGATION_RE.test(clause.slice(0,m.index)))rejected.add(candidate);
        else return candidate;
      }
    }
  }
  const p=rejected.has(proposed)?'':proposed;
  for(const clause of clauses){
    const hasAffirm=re=>{
      const match=clause.match(re);
      return Boolean(match&&!RATIO_NEGATION_RE.test(clause.slice(0,match.index)));
    };
    if(hasAffirm(/正方形|方形(?:照片|图)|方图/))return '1:1';
    if(hasAffirm(/横屏|横图|横幅|横版|横向|宽屏(?!显示器|电视)/)){
      if(p){
        const [pw,ph]=p.split(':').map(Number);
        if(pw>ph)return p;
      }
      return rejected.has('16:9')?'4:3':'16:9';
    }
    if(hasAffirm(/竖屏|竖图|竖幅|竖版|竖向/)){
      const portrait=ratio=>ratio&&Number(ratio.split(':')[0])<Number(ratio.split(':')[1]);
      return [p,defaultRatio,DEFAULT_RATIO,...Object.keys(SIZES_2K)].find(ratio=>portrait(ratio)&&!rejected.has(ratio))||DEFAULT_RATIO;
    }
    if(p&&hasAffirm(/(?:保持|沿用|按|还是).{0,8}(?:原图|原来|刚才|上[一]?张).{0,4}比例/))return p;
  }
  if(p&&SIZES_2K[p])return p;
  if(!rejected.has(defaultRatio))return defaultRatio;
  return [DEFAULT_RATIO,...Object.keys(SIZES_2K)].find(ratio=>!rejected.has(ratio))||defaultRatio;
}

function faceLockLines(refIndices=[1],{multiPerson=false}={}){
  if(multiPerson){
    const label='参考图'+refIndices.join('、');
    return [
      `严格保持每位人物的身份识别特征与其对应身份参考图一致（${label}），逐人绑定，不互换。三视图只用来认长相。身份参考图只用于识别人物，不沿用其打光、构图、画风和修饰效果；表情、目光和嘴角按本张方案变化。`,
      '再次强调：每位人物的脸必须与其对应身份参考图属于同一人，允许自然表情变化，不复制参考图神态，不跨人物复制外貌或穿搭。'
    ];
  }
  const [primary,...supporting]=refIndices;
  const detailNote=supporting.length?`参考图${supporting.join('、')}只补主参考图看不到的脸部角度和遮挡细节，不混合改造主参考图的脸。`:'';
  return [
    `严格保持参考图${primary}中同一人物的身份识别特征，以该图为人物身份主锚。保持脸型、眼鼻嘴相对比例和下颌轮廓。三视图只用来认长相。身份参考图不决定打光、构图、画风和修饰效果。${detailNote}表情、目光和嘴角按本张方案自然变化。`,
    `再次强调：人物的脸必须与参考图${primary}属于同一人，以主参考图的脸型、五官相对比例和下颌轮廓为准，允许自然表情变化，不复制参考图神态。`
  ];
}

function splitFaceLock(prompt){
  const lines=String(prompt||'').split('\n');
  let start='',end='';
  if(lines.length&&lines[0].startsWith('严格保持')&&lines[0].includes('人物'))start=lines.shift();
  for(let i=lines.length-1;i>=0;i--){
    if(lines[i].startsWith('再次强调：')&&(lines[i].includes('的脸必须与')||lines[i].includes('每位人物的脸'))){
      end=lines.splice(i,1)[0];
      break;
    }
  }
  return {start,body:lines.join('\n').replace(/^\n+|\n+$/g,''),end};
}

function applyFaceLock(prompt,refIndices=[1],{multiPerson=false}={}){
  if(!Array.isArray(refIndices)||!refIndices.length)return String(prompt||'');
  const {body}=splitFaceLock(prompt);
  const [start,end]=faceLockLines(refIndices,{multiPerson});
  return `${start}\n${body}\n${end}`;
}

function sanitizeFoodPrompt(raw){
  if(FOOD_STYLE_REQ_RE.test(raw))return raw;
  return raw.replace(FOOD_STYLING_RE,'日常质感');
}


const DIMENSION_NEGATION_RE=/(?:不要|别|不用|不想(?:要)?|禁止)(?:再)?\s*(?:(?:用|选|按|拍(?:成)?|改成|做成|采用)\s*)?$/;

function requestedDimension(text,choices){
  let last;
  for(const clause of text.split(/[，,、。；;！？!?\n]/)){
    for(const [type,pattern] of choices){
      const match=pattern.exec(clause);
      if(match&&!DIMENSION_NEGATION_RE.test(clause.slice(0,match.index)))last={type,text:match[0]};
    }
  }
  return last;
}

function hasSelfieCue(text,pattern){
  return [...text.matchAll(pattern)].some(match=>!SELFIE_CUE_NEGATION_RE.test(text.slice(0,match.index)));
}

// Remove recognizable contradictory phrases. The full wording still guides the image model.
function removeConflictingDetails(text,request){
  const {framing,capture,angle,noPerson,noSmile,noTeeth,smile,ratio,excludedSelfieCues}=request;
  if(!framing&&!capture&&!angle&&!noPerson&&!noSmile&&!noTeeth&&!smile&&!ratio&&!excludedSelfieCues.length)return text;
  return text.split(/([，,、。；;！？!?\n]+)/).flatMap((part,index,parts)=>{
    if(index%2||!part)return [];
    const shownFrame=framing&&requestedDimension(part,FRAMINGS);
    const shownCapture=capture&&requestedDimension(part,CAPTURES);
    const shownAngle=angle&&requestedDimension(part,ANGLES);
    const shownRatio=ratio&&requestedRatio(part,ratio,ratio);
    if((noPerson&&PERSON_CUE.test(part))||(noSmile&&SMILE_CUE.test(part))||(noTeeth&&TEETH_CUE.test(part))||(smile&&NO_SMILE.test(part))
      ||(shownFrame&&shownFrame.type!==framing.type)||(shownCapture&&shownCapture.type!==capture.type)
      ||(shownAngle&&shownAngle.type!==angle.type)
      ||excludedSelfieCues.some(pattern=>hasSelfieCue(part,pattern))
      ||(shownRatio&&shownRatio!==ratio))return [];
    return part+(parts[index+1]||'');
  }).join('').trim().replace(/[，,、；;]+$/,'');
}

function fallbackShot(kind,index){
  if(['food','scene','edit'].includes(kind)){
    return {capture:'用手机拍摄，设备在画面外',framing:kind==='food'?'普通吃饭距离，保留已有容器与适量桌面':'围绕同一主体取景',angle:['自然平视或轻俯拍','稍偏左取景','稍偏右取景','稍靠近主体'][index],action:'保持主体、物件与空间关系连续'};
  }
  return kind==='outfit'?{framing:'全身，头到脚完整入画'}:{};
}

function numberedRequests(original,count){
  if(count===1)return [original];
  const mentions=[...original.matchAll(/第\s*([一二三四1-4])\s*张/g)];
  if(!mentions.length)return Array(count).fill(original);
  const common=original.slice(0,mentions[0].index);
  const ordinal='一二三四';
  const requests=Array.from({length:count},()=>[common]);
  for(const [index,mention] of mentions.entries()){
    const n=ordinal.includes(mention[1])?ordinal.indexOf(mention[1])+1:Number(mention[1]);
    if(n<=count)requests[n-1].push(original.slice(mention.index,mentions[index+1]?.index));
  }
  return requests.map(parts=>parts.join('').trim());
}

function buildShotPrompts({role,rawPrompt,userText='',kind='selfie',scheduleState=null,outfitImage='',count=1,stitchSchedule=true,stylePrompt='',defaultSize='3:4 2K',aspectRatio='',mode='new',sourceImage='',userImage='',hasHumanOverride=null,shotPlan=[]}){
  const raw=String(rawPrompt||'').trim(),original=String(userText||'').trim();
  const extraStyle=stylePrompt?.trim();
  const total=Math.max(1,Math.min(4,Math.trunc(Number(count))||1)),requests=numberedRequests(original,total);
  const portrait=kind!=='edit'&&(hasHumanOverride??(kind==='selfie'||kind==='outfit'));
  const parsedSize=parseSizeSetting(defaultSize);
  const aiRatio=requestedRatio(aspectRatio||raw,parsedSize.ratio,parsedSize.ratio);
  const {sanitizeForbiddenText,promptWeather}=require('./schedule-core.cjs');

  return requests.map((userForShot,index)=>{
    const constrainingText=userForShot||(!original?raw:'');
    const noPerson=NO_PERSON.test(userForShot),roleInFrame=Boolean(portrait&&!noPerson);
    const chosenRatio=requestedRatio(userForShot,aiRatio,parsedSize.ratio);
    const noSmile=NO_SMILE.test(constrainingText);
    const request={
      framing:requestedDimension(userForShot,FRAMINGS),
      capture:requestedDimension(userForShot,CAPTURES),
      angle:requestedDimension(userForShot,ANGLES),
      noPerson,
      noSmile,
      noTeeth:NO_TEETH.test(constrainingText),
      smile:!noSmile&&userForShot.match(SMILE_REQUEST)?.[0],
      ratio:chosenRatio!==aiRatio||requestedRatio(userForShot,'','')?chosenRatio:'',
      excludedSelfieCues:roleInFrame?SELFIE_DETAIL_CUES.filter(pattern=>!hasSelfieCue(userForShot,pattern)):[]
    };
    const spec={};
    const proposed=shotPlan[index]||(total>1?fallbackShot(noPerson?'scene':kind,index):{});
    for(const [key,text] of Object.entries(proposed)){
      if(noPerson&&key==='expression')continue;
      const clean=removeConflictingDetails(text,request);
      if(clean)spec[key]=clean;
    }
    if(request.capture)spec.capture=request.capture.text;
    if(request.framing)spec.framing=request.framing.text;
    if(request.angle)spec.angle=request.angle.text;
    if(!noPerson&&request.smile&&!spec.expression)spec.expression=request.smile;
    const expressionLimits=[request.noSmile&&'不微笑。',request.noTeeth&&'嘴唇自然闭合，不露齿。'].filter(Boolean).join('');
    if(!noPerson&&expressionLimits)spec.expression=(spec.expression?spec.expression.replace(/[。！？.!?]+$/,'')+'。':'')+expressionLimits;
    const isFullBody=spec.framing?FULL_BODY_RE.test(spec.framing):kind==='outfit'||FULL_BODY_RE.test(raw);
    const cleanRaw=removeConflictingDetails(raw,request);
    const references=[],referenceRoles=[],characterRefIndices=[];
    function addRef(image,purpose){
      if(!image||references.includes(image))return 0;
      references.push(image);referenceRoles.push(purpose);
      return references.length;
    }
    const sourceRefIndex=(mode==='edit'||kind==='edit')?addRef(sourceImage,roleInFrame
      ?'来源成片：延续实际可见的衣服、主体和环境；人物身份仍按原始身份图'
      :'来源成片：保留未要求调整的主体与细节'):0;
    if(roleInFrame){
      for(const image of (role?.faceReferences||[]).filter(Boolean).slice(0,3)){
        const number=addRef(image,'角色身份：只参考脸型和五官比例，不固定表情、衣服或背景');
        if(number)characterRefIndices.push(number);
      }
      if(isFullBody)for(const image of (role?.bodyReferences||[]).filter(Boolean).slice(0,3))addRef(image,'角色体态：仅参考肩宽、腰身和腿部比例，不复制脸、衣服、姿势和背景');
      if(stitchSchedule&&mode==='new')addRef(outfitImage,'当前穿搭：只参考衣服，用户指定其他衣服时按用户要求');
    }
    const userRefIndex=addRef(noPerson&&portrait?'':userImage,kind==='edit'?'用户改图来源：保留未要求修改的主体与细节'
      :roleInFrame?'用户身份或互动参考：逐人绑定，不与角色身份混合':'用户画面参考：参考本次指定的物件、地点或构图');

    const lines=['用户原话中明确指定的维度最高优先级，本张补写方案不覆盖用户要求。'];
    if(original)lines.push('用户原话：'+original);
    if(userForShot!==original)lines.push('只把用户原话中针对第'+(index+1)+'张的要求与整组通用要求用于本张。');
    if(roleInFrame)lines.push(SELFIE_STYLE);
    if(roleInFrame&&role?.appearancePrompt?.trim())lines.push('人物固定外貌特征：'+role.appearancePrompt.trim());
    if(stitchSchedule&&scheduleState&&mode==='new'&&kind!=='edit'){
      const scene=sanitizeForbiddenText(scheduleState.scene,'');
      const weather=scheduleState.weatherText||promptWeather(scheduleState.weather)||'';
      const lifeParts=[];
      if(roleInFrame&&scheduleState.outfit)lifeParts.push('今日穿搭服饰：'+scheduleState.outfit);
      if(scene)lifeParts.push('当前所处环境场景：'+scene);
      if(weather&&kind!=='food')lifeParts.push('当前天气：'+weather);
      if(lifeParts.length)lines.push(lifeParts.join('；'));
    }
    if(roleInFrame){
      if(mode==='edit'&&/保持.*表情|表情不变/.test(constrainingText))lines.push('保持来源成片实际可见的表情。');
      else{
        const intensity=scheduleState?.currentSlot?.moodIntensity||scheduleState?.currentSlot?.mood_intensity;
        const mood=scheduleState?.mood;
        if(intensity)lines.push('当前情绪强度：'+intensity+'，用自然眉眼和嘴角变化表达，不强行夸张。');
        if(mood)lines.push('当前心情底色：'+mood+'。表情优先遵从用户本次要求和本张方案，心情只补未指定部分。');
        if(!request.noSmile&&/笑|开心|微笑/.test(constrainingText||cleanRaw)&&!/大笑|露齿|咧嘴|哈哈/.test(constrainingText||cleanRaw))lines.push('自然笑意：眉眼柔和，嘴角轻扬，不夸张咧嘴或露齿。');
      }
    }
    const cleanSubject=kind==='food'&&!FOOD_STYLE_REQ_RE.test(original)?sanitizeFoodPrompt(cleanRaw):cleanRaw;
    if(cleanSubject)lines.push('具体画面（模型补充）：'+cleanSubject);
    if(Object.keys(spec).length)lines.push('本张具体拍摄方案：'+JSON.stringify(spec));
    if(sourceRefIndex){
      if(kind==='edit')lines.push(`以参考图${sourceRefIndex}为改图来源，仅按本次要求调整，保留未要求改变的主体与细节。`);
      else if(roleInFrame)lines.push(`基于参考图${sourceRefIndex}做局部或延续修改，以原图实际可见的衣服、环境与光线为准，人物身份以原始身份参考图为准；表情按本次要求与当前心情变化，只有明确要求才保持原表情。只按本次要求调整画面。`);
      else lines.push('基于参考图'+sourceRefIndex+'继续拍摄同一主体，以原图实际可见的环境与光线为准。');
    }
    if(userRefIndex){
      const purpose=kind==='edit'?'以这张图片为改图来源，仅按本次要求调整，保留未要求改变的主体与细节。'
        :roleInFrame?'请自然呼应或互动其中元素，不改变角色主身份特征。':'只参考用户本次指定的元素。';
      lines.push('参考图'+userRefIndex+'是用户本次提供的图片。'+purpose);
    }
    if(total>1)lines.push('本组第'+(index+1)+'/'+total+'张，'+(roleInFrame
      ?'保持同一个人、同一套衣服和同一个场景。角度、动作和表情按用户要求或当时的情境自然变化。'
      :'保持同一主体与环境，按本张方案调整未锁定的角度与构图。'));
    if(roleInFrame)lines.push(CAPTURE_POLICY);
    if(kind==='food')lines.push(FOOD_GUIDANCE);
    if(kind!=='edit'&&extraStyle&&extraStyle!==SELFIE_STYLE&&(!roleInFrame||extraStyle!==LEGACY_SELFIE_STYLE))lines.push('拍摄质感与画风：'+extraStyle);
    if(referenceRoles.length)lines.push('参考图用途（严格按编号）：\n'+referenceRoles.map((r,i)=>'参考图'+(i+1)+'：'+r).join('\n'));
    let prompt=lines.join('\n');
    if(characterRefIndices.length){
      const multiPerson=Boolean(userRefIndex&&/(?:合影|合照|一起拍|同框|两人|两个人)/.test(userForShot||cleanRaw));
      const indices=multiPerson?[...characterRefIndices,userRefIndex]:characterRefIndices;
      prompt=applyFaceLock(prompt,indices,{multiPerson});
    }
    const size=parsedSize.exact&&!aspectRatio&&chosenRatio===parsedSize.ratio?parsedSize.exact:TIERS[parsedSize.tier][chosenRatio];
    return {shotIndex:index,kind,roleInFrame,prompt:prompt.slice(0,8000),references,referenceRoles,spec,size,ratio:chosenRatio,userRatio:request.ratio};
  });
}


module.exports={
  SIZES_4K,
  SIZES_2K,
  SIZES_1K,
  TIERS,
  DEFAULT_RATIO,
  DEFAULT_TIER,
  SELFIE_STYLE,
  LEGACY_SELFIE_STYLE,
  CAPTURE_POLICY,
  FOOD_GUIDANCE,
  parseSizeSetting,
  smallerSize,
  requestedRatio,
  faceLockLines,
  applyFaceLock,
  sanitizeFoodPrompt,
  isFullBodyRequest:text=>FULL_BODY_RE.test(String(text||'')),
  buildShotPrompts
};

