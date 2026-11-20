// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const S=require('../../state.cjs');
const PhotoCore=require('../photo-core.cjs');

function ensureData(state){
  state.engine.data.selfie??={};
  state.engine.data.selfie.photos??={};
  return state.engine.data.selfie;
}

function selectPhoto(state,roleId,args={}){
  const photos=state.engine?.data?.selfie?.photos?.[roleId]||[];
  let groupId=args.groupId;
  let photoIndex=args.photoIndex;
  const text=args.userText||args.prompt||'';
  const ordinal=text.match(/(?:第|组[的里中]?)\s*([一二三四1-4])\s*张/);
  const explicitIndex=ordinal?({'一':1,'二':2,'三':3,'四':4})[ordinal[1]]||Number(ordinal[1]):null;
  if(explicitIndex&&photoIndex&&explicitIndex!==photoIndex)S.fail('照片序号与用户要求不一致');
  photoIndex??=explicitIndex;
  const groupSizes=new Map();for(const photo of photos)if(photo.groupId)groupSizes.set(photo.groupId,(groupSizes.get(photo.groupId)||0)+1);
  if(photoIndex&&!groupId)groupId=[...photos].reverse().find(p=>groupSizes.get(p.groupId)>1)?.groupId;
  if(args.sourcePhotoId){
    const found=photos.find(p=>p.id===args.sourcePhotoId);
    if(!found)S.fail('找不到指定的历史照片');
    if((photoIndex&&found.photoIndex!==photoIndex)||(groupId&&found.groupId!==groupId))S.fail('来源照片与要求的组内序号不一致');
    return found;
  }
  if(groupId){const found=photos.find(p=>p.groupId===groupId&&(!photoIndex||p.photoIndex===photoIndex));if(!found)S.fail('找不到这组指定序号的照片，请说明要哪一张');return found;}
  if(photoIndex)S.fail('找不到对应的组照，请说明要哪一张');
  return photos.at(-1)||null;
}

function validateShotPlan(value,count){
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length!==count)S.fail('逐张拍摄方案的数量须与照片张数一致');
  return value.map(row=>{
    if(!S.obj(row)||Object.keys(row).some(k=>!['capture','framing','angle','action','expression'].includes(k)))S.fail('逐张方案只支持capture/framing/angle/action/expression');
    if(Object.values(row).some(v=>typeof v!=='string'||v.length>240||v.includes('\0')))S.fail('每张方案须填写不超过240字的具体拍摄细节');
    return row;
  });
}

function buildPhotoPlan(state,role,args={}){
  const R=require('../registry.cjs');
  const settings=R.values(state,'selfie');
  const stitchSchedule=settings.useScheduleOutfit!==false&&R.isEnabled(state,'schedule');
  const scheduleState=stitchSchedule?require('./schedule.cjs').currentState(state,role.id,args.at):null;
  let kind=['selfie','outfit','food','scene','edit'].includes(args.kind)?args.kind:'selfie';
  let sourceImage='',sourcePhoto=null;
  if(args.mode==='edit'||args.action==='continue'||(kind==='edit'&&args.sourcePhotoId)){
    const match=selectPhoto(state,role.id,args);
    sourcePhoto=match;
    if(!args.kind&&match?.kind)kind=match.kind;
    if(!match)S.fail('找不到可续拍的历史照片');
    if(match?.image)sourceImage=match.image;
  }
  const previousUserIndex=sourcePhoto?.referenceRoles?.findIndex(r=>r.startsWith('用户身份'))??-1;
  let userImage=previousUserIndex>=0?sourcePhoto.references[previousUserIndex]:'';
  if(kind==='edit')userImage=args.userImage||'';
  else if(args.withUserImage&&['selfie','outfit'].includes(kind)){
    userImage=args.userImage||'';
    if(!userImage)S.fail('请发送或引用要一起拍的图片');
  }
  if(kind==='edit'&&!sourceImage&&!userImage)S.fail('改图需要本会话的来源照片或用户图片');
  const maxGroup=Math.max(1,Math.min(4,Number(settings.maxGroupCount)||4));
  const count=Math.max(1,Math.min(maxGroup,Number(args.count)||1));
  const shotPlan=validateShotPlan(args.shotPlan??args.shot_plan,count);
  const stylePrompt=settings.stylePrompt===PhotoCore.SELFIE_STYLE&&['food','scene'].includes(kind)
    ?PhotoCore.LEGACY_SELFIE_STYLE:settings.stylePrompt;
  const shots=PhotoCore.buildShotPrompts({
    role:sourcePhoto?.identity?{...role,...sourcePhoto.identity}:role,
    rawPrompt:args.prompt||'',
    userText:args.userText,
    kind,
    scheduleState,
    count,
    stitchSchedule,
    stylePrompt:kind==='edit'?'':stylePrompt,
    defaultSize:settings.defaultSize||'3:4 2K',
    aspectRatio:args.aspectRatio||'',
    mode:args.mode||(args.action==='continue'?'edit':'new'),
    sourceImage,
    userImage,
    outfitImage:scheduleState?.outfitImage,
    shotPlan
  });
  return {
    shots,
    prompt:shots[0]?.prompt||String(args.prompt||''),
    references:shots[0]?.references||[],
    size:shots[0]?.size||'1536x2048',
    identity:sourcePhoto?.identity||{faceReferences:role.faceReferences||[],bodyReferences:role.bodyReferences||[],appearancePrompt:role.appearancePrompt||''},
    sourcePhotoId:sourcePhoto?.id||'',
    groupId:'g-'+S.id().slice(0,10)
  };
}

async function generateRolePhoto(state,role,opts={}){
  const plan=opts.plan??buildPhotoPlan(state,role,opts);
  const Providers=require('../../providers.cjs');
  const results=[];
  let firstImage='';
  for(const shot of plan.shots){
    opts.signal?.throwIfAborted();
    const useFirstImage=firstImage&&shot.roleInFrame;
    const image=S.image(await Providers.generateImage(state,shot.prompt+(useFirstImage?'\n最后一张参考图为本组首张成片，只延续可见衣服、主体与环境；原始身份图继续决定人物长相，本张角度动作表情以本张方案为准。':''),{
      signal:opts.signal,
      onUsage:opts.onUsage,
      beforeRequest:opts.beforeRequest,
      references:useFirstImage?[...shot.references,firstImage]:shot.references,
      size:opts.skipSize?undefined:shot.size,
      allowSizeStepDown:true,
      dataDir:opts.dataDir
    }),false);
    opts.signal?.throwIfAborted();
    firstImage||=image;
    const photo={id:'p-'+S.id().slice(0,10),image,prompt:shot.prompt,size:shot.size,kind:shot.kind,spec:shot.spec,references:shot.references,referenceRoles:shot.referenceRoles,identity:plan.identity,sourcePhotoId:plan.sourcePhotoId,groupId:plan.groupId,photoIndex:shot.shotIndex+1,groupCount:plan.shots.length,brief:opts.prompt||'',createdAt:Date.now()};
    results.push(photo);
    if(opts.onPhoto)await opts.onPhoto(photo);
  }
  return results;
}

const sendSelfieTool={
  type:'function',
  function:{
    name:'send_selfie',
    description:'拍摄并发送自己的生活照。自拍或穿搭的人物参考图只用来认长相，只拍眼前风景或食物时选 scene 或 food。自拍默认用现场光，保留自然肤质，补写时省去棚拍打光、美颜磨皮、人像精修和电影感。连拍按人设和现场自然变化角度、动作和表情，避免套用固定机位或姿势。用户明确指定的细节优先。续拍用来源成片，重发不生图。普通画图或修改引用图片用 generate_image。',
    parameters:{
      type:'object',
      properties:{
        action:{type:'string',enum:['generate','continue','resend'],description:'generate=新拍(默认)，continue=延续上一张微调角度，resend=重发已拍过的照片'},
        kind:{type:'string',enum:['selfie','outfit','food','scene'],description:'selfie=本人入镜自拍，outfit=本人入镜穿搭照，food=食物，scene=眼前风景或小物'},
        prompt:{type:'string',description:'简短拍摄意图，程序会单独保留用户原话。重发时可留空'},
        count:{type:'integer',minimum:1,maximum:4,description:'一次连拍几张（1~4，默认1）'},
        groupId:{type:'string',description:'指定历史组照编号'},
        photoIndex:{type:'integer',minimum:1,maximum:4,description:'组内第几张'},
        shotPlan:{type:'array',items:{type:'object',properties:Object.fromEntries(['capture','framing','angle','action','expression'].map(k=>[k,{type:'string'}])),additionalProperties:false},description:'与count等长的逐张方案'},
        sourcePhotoId:{type:'string',description:'续拍或重发时指定本会话的照片编号'},
        withUserImage:{type:'boolean',description:'用户明确想合影时使用本轮引用或上传的人物图'},
        aspectRatio:{type:'string',description:'可选比例，例如 3:4、1:1、16:9、9:16'},
        waitingText:{type:'string',description:'拍照前先发给用户的一句简短过渡语，例如“等我拍给你看呀”，照片发出前不要说已发'}
      },
      required:[],
      additionalProperties:false
    }
  }
};

module.exports={
  id:'selfie',
  name:'生图与自拍',
  isolated:true,
  description:'绑定人物正脸/全身参考图与固定外貌，联动今日穿搭与当前场景，支持 1~4 张连拍、原图微调及零成本重发。',
  settings:[
    {key:'enabled',label:'开启日常拍照与自拍',type:'boolean',default:true},
    {key:'autoMomentsPhoto',label:'发朋友圈时偶尔附上日常照片',type:'boolean',default:true},
    {key:'stylePrompt',label:'默认画风与拍照质感',type:'textarea',default:PhotoCore.SELFIE_STYLE,maxLength:2000},
    {key:'defaultSize',label:'默认比例与清晰度',type:'select',default:'3:4 2K',advanced:true,options:[
      {value:'3:4 2K',label:'竖屏 3:4 高清（推荐）'},
      {value:'3:4 4K',label:'竖屏 3:4 超清 4K'},
      {value:'1:1 2K',label:'正方形 1:1 高清'},
      {value:'4:3 2K',label:'横屏 4:3 高清'},
      {value:'9:16 2K',label:'手机全屏 9:16'}
    ]},
    {key:'useScheduleOutfit',label:'自动结合今日穿搭与当前场景',type:'boolean',default:true,advanced:true},
    {key:'maxGroupCount',label:'单次最多连拍张数',type:'number',min:1,max:4,step:1,default:4,advanced:true}
  ],
  hooks:{
    afterAssemble(ctx){
      const s=ctx.getState?.();if(!s||!ctx.role||!ctx.messages?.[0])return;
      const R=require('../registry.cjs');
      if(!R.values(s,'actions').allowImages)return;
      const photos=(s.engine?.data?.selfie?.photos?.[ctx.role.id]||[]).slice(-5);
      const faceCount=ctx.role.faceReferences?.length||0,bodyCount=ctx.role.bodyReferences?.length||0;
      const refHint=faceCount||bodyCount?`已绑定人物参考图（正脸 ${faceCount} 张${bodyCount?`，全身 ${bodyCount} 张`:''}）。三视图只用来认长相，全身图只参考体态。按现场光和日常随手拍安排镜头与表情。`:'';
      const photoList=photos.length?'\n近期你拍过的照片记录：\n'+photos.map(p=>`- [照片编号:${p.id}] [组:${p.groupId||'旧照片'} 第${p.photoIndex||1}/${p.groupCount||1}张] (${p.kind}) ${p.brief}`).join('\n'):'';
      if((refHint||photoList)&&typeof ctx.messages[0].content==='string'){
        ctx.messages[0].content+=`\n【拍照与相册】${refHint}${photoList}`;
      }
    }
  },
  tools:[{
    definitions:(state,role)=>{
      const R=require('../registry.cjs');
      if(!R.values(state,'actions').allowImages)return [];
      if(!state.settings?.ai?.assign?.image&&!state.engine?.data?.selfie?.photos?.[role?.id]?.length)return [];
      return [sendSelfieTool];
    },
    async execute(name,args,ctx){
      if(name!=='send_selfie')S.fail('未知的自拍工具');
      const {getState,mutate,roleId,signal,onUsage,dataDir}=ctx;
      const at=typeof ctx.now==='function'?ctx.now():ctx.now;
      const before=getState(),actor=S.role(before,roleId);S.chatAllowed(actor);
      const R=require('../registry.cjs');
      const checkPermission=s=>{
        if(!R.isEnabled(s,'selfie')||!R.values(s,'actions').allowImages)S.fail('这个角色动作当前不可用');
      };
      checkPermission(before);
      if(args?.action!=='resend'&&!before.settings?.ai?.assign?.image)S.fail('请先配置生图模型');
      if(!S.obj(args))S.fail('自拍参数格式有误');
      const {deliverBubble}=require('../actions.cjs');
      const {userText,userImage}=ctx.imageRequest||{};

      // Zero-cost resend of a previous photo
      if(args.action==='resend'){
        const hit=selectPhoto(before,roleId,{...args,userText});
        if(!hit?.image)S.fail('找不到可重发的历史照片，请改用新拍');
        return mutate(s=>{
          const r=S.role(s,roleId);S.chatAllowed(r);
          checkPermission(s);
          const msg={id:S.id(),roleId:r.id,sender:'assistant',type:'image',content:hit.image,createdAt:Date.now(),status:'sent'};
          deliverBubble(s,r,msg,ctx);
          return {messageId:msg.id,photoId:hit.id,resent:true};
        }).value;
      }

      if(typeof args.prompt!=='string'||!args.prompt.trim())S.fail('自拍画面描述不能为空');
      if(args.kind==='edit'||args.mode==='edit'&&args.action!=='continue')S.fail('需要改图时，请使用引用或本轮上传的原图进行修改');
      const plan=buildPhotoPlan(before,actor,{...args,at,userText,userImage});

      const sentWaiting=Boolean(ctx.beforeImageGeneration?.(args.waitingText));

      // Honor explicit selfie defaultSize config, references, aspect ratios, multi-shot, or edits
      const explicitSize=typeof before.settings?.modules?.selfie?.defaultSize==='string'&&before.settings.modules.selfie.defaultSize.trim();
      const useCustomSize=Boolean(args.aspectRatio||Number(args.count)>1||args.action==='continue'||explicitSize||plan.shots.some(shot=>shot.userRatio||shot.references.length));
      const messageIds=[],photoIds=[],mediaIds=[];
      const savePhoto=ctx.mutatePhotoProgress||mutate;
      await generateRolePhoto(before,actor,{plan,skipSize:!useCustomSize,signal,onUsage,dataDir,onPhoto:photo=>{
        signal?.throwIfAborted();
        savePhoto(s=>{
          const r=S.role(s,roleId);S.chatAllowed(r);
          checkPermission(s);
          const store=ensureData(s),list=store.photos[roleId]??=[];
          const media={id:S.id(),photoId:photo.id,roleId,image:photo.image,prompt:photo.prompt,createdAt:photo.createdAt};
          (s.engine.data.actions.roleMedia??=[]).push(media);
          list.push(photo);
          if(list.length>40)store.photos[roleId]=list.slice(-40);
          const msg={id:S.id(),roleId,sender:'assistant',type:'image',content:photo.image,createdAt:Date.now(),status:'sent'};
          deliverBubble(s,r,msg,ctx);
          messageIds.push(msg.id);photoIds.push(photo.id);mediaIds.push(media.id);
        });
      }});
      return {messageId:messageIds[0],mediaId:mediaIds[0],photoId:photoIds[0],count:messageIds.length,sentWaiting};
    }
  }],
  jobs:[],
  data:'selfie',
  page:null,
  selectPhoto,
  validateShotPlan,
  buildPhotoPlan,
  generateRolePhoto
};
// Deleting a friend also removes their photo records.
module.exports.removeRole=(s,id)=>{const photos=s.engine?.data?.selfie?.photos;if(photos)delete photos[id];};
