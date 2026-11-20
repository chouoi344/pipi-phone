// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
(()=>{
  const P=()=>window.Pipi,esc=v=>P().esc(v??''),sessions=new Map();
  const layoutKey=id=>'pipi.life.layout.'+id;
  const categories = [
    {key:'basic', label:'基础配置', icon:'me', render:(ui,d)=>window.PipiLifeBasic.render(ui,d.role,outreachView(ui,d))},
    {key:'schedule', label:'日程', icon:'calendar', render:scheduleCard},
    {key:'interaction', label:'主动信息', icon:'chat', render:interactionCard},
    {key:'memory', label:'记忆', icon:'book'},
    {key:'stickers', label:'表情包', icon:'smile'},
    {key:'photo', label:'照片', icon:'image', render:photoCard},
    {key:'wardrobe', label:'衣柜', icon:'wardrobe', render:wardrobeCard},
    {key:'moments', label:'朋友圈', icon:'moments', render:momentsCard}
  ];
  function session(id){
    if(!sessions.has(id)){
      const saved=JSON.parse(sessionStorage.getItem(layoutKey(id))||'{}');
      sessions.set(id,{category:saved.category||'basic',data:null,loading:null,loadError:'',error:'',notice:'',scroll:saved.scroll||0,open:new Set(saved.open),draft:{},voices:null,saving:false,readingImages:new Set(),album:null,albumRequest:null,albumError:'',albumBrowse:saved.album||{month:'',page:1},momentFeed:null,momentRequest:null,momentError:'',momentBrowse:saved.moments||{month:'',page:1},wardrobeBrowse:saved.wardrobe||{category:'全部',season:'',page:1}});
    }
    return sessions.get(id);
  }
  const safeImage=v=>/^\/api\/media\/[a-f\d]{32,64}\.(png|jpg|jpeg|webp|gif)$/i.test(v||'')||/^data:image\/(png|jpeg|webp|gif);base64,/i.test(v||'');
  const fold=(ui,key,title,body)=>`<details data-life-detail="${key}" ${ui.open.has(key)?'open':''}><summary>${esc(title)}</summary><div class="life-fold-body">${body}</div></details>`;
  function value(ui,scope,key,original){return Object.hasOwn(ui.draft,scope+'.'+key)?ui.draft[scope+'.'+key]:original;}
  function feedImages(moment){
    const images=(moment.images?.length?moment.images:[moment.image]).filter(safeImage);
    return images.length?`<div class="life-feed-images">${images.map((src,index)=>`<button type="button" class="life-feed-image" data-life-image="${esc(src)}" aria-label="查看第 ${index+1} 张朋友圈图片"><img src="${esc(src)}" alt="" loading="lazy"></button>`).join('')}</div>`:'';
  }
  const outfitLabel=kind=>({home:'居家服',outdoor:'外出服',sleepwear:'睡衣',sports:'运动服'})[kind]||'待确认';
  const phoneLabel=state=>({free:'能及时看手机',glance:'偶尔看手机',offline:'暂时不看手机'})[state]||'待确认';
  function currentLife(schedule){
    if(!schedule.settings.enabled)return '<p class="life-muted">日程已关闭</p>';
    const current=schedule.current;
    const weather=current?.weather||schedule.plan?.weather||{};
    const temperature=Number.isFinite(weather.temp)?`${weather.temp}℃`:
      Number.isFinite(weather.tempMin)&&Number.isFinite(weather.tempMax)?`${weather.tempMin}～${weather.tempMax}℃`:'';
    const weatherText=[weather.summary||weather.description,temperature].filter(Boolean).join(' · ')||'暂无天气';
    const weatherSource=weather.fallbackFrom&&weather.city?`参考${weather.city}`:weather.aiSimulated&&!weatherText.includes('模拟')?'AI 模拟':'';
    const weatherFact=`<div class="life-now-weather"><dt>天气</dt><dd>${esc(weatherText)}${weatherSource?`<small>${esc(weatherSource)}</small>`:''}</dd></div>`;
    const activity=`<div class="life-now-activity"><dt>正在做</dt><dd>${esc(current?.activity||'暂无当前安排')}</dd></div>`;
    if(!current?.currentSlot)return `<dl class="life-now-facts">${activity}${weatherFact}</dl>`;
    const outfit=`<span>穿搭</span><span class="life-now-outfit-type">${outfitLabel(current.outfitType)}</span>`;
    return `<dl class="life-now-facts">
      ${activity}${weatherFact}
      <div><dt>在哪里</dt><dd>${esc(current.scene||'待确认')}</dd></div>
      <div><dt>心情</dt><dd>${esc(current.mood||'待确认')}</dd></div>
      <div class="life-now-phone"><dt>手机状态</dt><dd>${phoneLabel(current.phone)}</dd></div>
    </dl>`+(current.outfit?.trim()? `<button type="button" class="life-now-outfit" data-life-action="outfitDetails" aria-haspopup="dialog">${outfit}<i aria-hidden="true"></i></button>`:
      `<div class="life-now-outfit">${outfit}</div>`);
  }
  function scheduleCard(ui,d){
    const enabled=value(ui,'schedule','enabled',d.schedule.settings.enabled);
    return `<section class="life-card">
      <div class="life-field life-check life-card-heading" data-life-scope="schedule">
        <h3>日程与穿搭</h3>
        <input type="checkbox" role="switch" aria-label="开启日程" data-life-field="enabled" ${enabled?'checked':''}>
      </div>
      ${window.PipiSchedule.renderSleepProfile(value(ui,'schedule','sleepProfile',d.schedule.settings.sleepProfile))}
      <div class="life-schedule-overview"><h4>此刻的生活</h4>${currentLife(d.schedule)}</div>
      <button type="button" class="life-now-outfit" data-life-action="viewTimeline" aria-haspopup="dialog">
        <span>查看全天日程</span><i aria-hidden="true"></i>
      </button>
      ${window.PipiSchedule.renderProfile(d.schedule,ui.open,key=>value(ui,'profile',key,d.schedule.profile[key]??''))}
    </section>`;
  }
  function wardrobeCard(ui,d){
    const outfits=d.schedule.wardrobe;
    const browse=ui.wardrobeBrowse,{category,season}=browse;
    const matches=outfits.filter(item=>(category==='全部'||item.category===category)&&(!season||!item.seasons?.length||item.seasons.includes(season))).reverse();
    const pageSize=8,pages=Math.max(1,Math.ceil(matches.length/pageSize));
    const page=Math.min(browse.page,pages);
    Object.assign(browse,{page,pages});
    const visible=matches.slice((page-1)*pageSize,page*pageSize);
    return `<section class="life-card life-wardrobe">
      <div class="life-wardrobe-heading"><h3>衣柜 <small>${outfits.length} 套</small></h3>
        <div class="life-wardrobe-actions">
          <button type="button" data-life-action="wardrobeAdd">手动添加</button>
          <button type="button" data-life-action="wardrobeImport">批量导入</button>
        </div>
      </div>
      ${outfits.length?`<div class="life-wardrobe-filters" role="group" aria-label="穿搭分类">${['全部','外出','居家','睡衣','运动'].map(group=>
        `<button type="button" data-life-action="wardrobeFilter" data-wardrobe-category="${group}" aria-pressed="${group===category}">${group}</button>`).join('')}</div>
      <div class="life-wardrobe-toolbar">
        <button type="button" class="life-album-month-toggle" data-life-action="wardrobeSeason" aria-haspopup="dialog">${season?`${season}季`:'全部季节'}<i aria-hidden="true"></i></button>
        ${pages>1?`<nav class="life-wardrobe-pager" aria-label="衣柜分页">
          <button type="button" data-life-action="wardrobePage" data-wardrobe-page="${page-1}" ${page===1?'disabled':''}>上页</button>
          <button type="button" data-life-action="wardrobeJump" aria-label="跳转页码，当前第 ${page} 页，共 ${pages} 页" aria-haspopup="dialog">${page} / ${pages} 页</button>
          <button type="button" data-life-action="wardrobePage" data-wardrobe-page="${page+1}" ${page===pages?'disabled':''}>下页</button>
        </nav>`:''}
      </div>`:''}
      ${visible.length?`<div class="life-wardrobe-grid">${visible.map(item=>`
        <article class="life-wardrobe-item">
          <button type="button" class="life-wardrobe-outfit" data-life-action="wardrobeEdit" data-outfit-id="${esc(item.id)}" aria-label="编辑穿搭：${esc(item.description)}">
            <span class="life-wardrobe-image">${safeImage(item.image)?`<img src="${esc(item.image)}" alt="" loading="lazy">`:P().icons.image}</span>
            <span class="life-wardrobe-name">${esc(item.description)}</span>
          </button>
          <div class="life-wardrobe-meta">
            <span>${esc(item.category)} · ${esc(!item.seasons?.length||item.seasons.length===4?'四季':item.seasons.join('、'))}</span>
            <button type="button" data-life-action="wardrobeMenu" data-outfit-id="${esc(item.id)}" aria-label="穿搭操作">${P().icons.more}</button>
          </div>
        </article>`).join('')}</div>`:`<p class="life-wardrobe-empty">${outfits.length?'没有符合筛选的穿搭':'衣柜还是空的'}</p>`}
    </section>`;
  }
  function openLifeView(title,content){
    P().openModal(title,content,null);
    const overlay=document.querySelector('#overlay');
    const dialog=overlay.querySelector('[role="dialog"]');
    dialog.classList.add('life-view-dialog');
    dialog.querySelector('.modal-close').remove();
    const mask=document.createElement('div');
    mask.className='overlay-mask';
    mask.setAttribute('aria-hidden','true');
    mask.onclick=()=>P().closeModal();
    overlay.prepend(mask);
    const focus=dialog.querySelector('.life-timeline-scroll')||dialog.querySelector('.modal-body');
    focus.tabIndex=0;
    focus.focus({preventScroll:true});
    return dialog;
  }
  function openTimeline(ui){
    const schedule=ui.data.schedule;
    const slots=schedule.timeline;
    if(!slots.length){
      openLifeView('全天日程','<p class="life-outfit-detail">今天还没有日程</p>');
      return;
    }
    const now=Date.now();
    const rows=slots.map(slot=>{
      const phase=Number.isFinite(slot.startAt)?
        (slot.endAt<=now?'past':slot.startAt>now?'future':'current'):
        (slot.end<=schedule.nowHm?'past':slot.start>schedule.nowHm?'future':'current');
      const phone=({night_sleep:'夜睡 · 不看手机',nap:'午睡 · 不看手机'})[slot.restType]||phoneLabel(slot.phone);
      return `<li class="life-timeline-row" data-phase="${phase}" ${phase==='current'?'aria-current="time"':''}>
        <details name="life-timeline-slot">
          <summary>
            <span class="life-timeline-head">
              <span class="life-timeline-time">${esc(slot.start)}–${esc(slot.end)}</span>
              ${phase==='current'?'<span class="life-timeline-now">现在</span>':''}
              <span class="life-timeline-phone" aria-label="手机状态 ${phone}">${phone}</span>
              <span class="life-timeline-disclosure"><span class="life-timeline-expand">展开</span><span class="life-timeline-collapse">收起</span></span>
            </span>
            <span class="life-timeline-activity">${esc(slot.activity)}</span>
            <span class="life-timeline-facts">
              <span><span class="life-timeline-label">地点</span><span class="life-timeline-value">${esc(slot.scene||'待确认')}</span></span>
              <span><span class="life-timeline-label">心情</span><span class="life-timeline-value">${esc(slot.mood||'待确认')}</span></span>
            </span>
          </summary>
          ${slot.outfitType?`<div class="life-timeline-outfit">穿搭　${outfitLabel(slot.outfitType)}</div>`:''}
        </details>
      </li>`;
    }).join('');
    const dialog=openLifeView('全天日程',`<div class="life-timeline">
      <div class="life-timeline-scroll" role="region" aria-label="全天时间轴" tabindex="0"><ol class="life-timeline-rows">${rows}</ol></div>
    </div>`);
    const scroll=dialog.querySelector('.life-timeline-scroll');
    const active=scroll.querySelector('[aria-current="time"]');
    if(active){
      const row=active.getBoundingClientRect(),frame=scroll.getBoundingClientRect();
      scroll.scrollTop+=row.top-frame.top+(row.height-frame.height)/2;
    }
  }
  function outreachSetting(ui,settings,field){
    const {key,label,type}=field;
    const current=value(ui,'interaction',key,settings[key]);
    const attrs=`data-life-field="${key}"`;
    if(type==='boolean')return `<label class="life-field life-check"><span>${esc(label)}</span><input ${attrs} type="checkbox" role="switch" ${current?'checked':''}></label>`;
    if(type==='textarea')return `<label class="life-field"><span>${esc(label)}</span><textarea ${attrs} rows="3" maxlength="${field.maxLength}">${esc(current)}</textarea></label>`;
    const number=type==='number';
    const limits=number?`min="${field.min}" max="${field.max}" step="1"`:'';
    return `<label class="life-field life-outreach-setting"><span>${esc(label)}</span><input ${attrs} type="${number?'number':'time'}" value="${esc(current)}" ${limits} required></label>`;
  }
  function outreachView(ui,d){
    const {settings,hasCurrentSchedule}=d.interaction;
    const enabled=value(ui,'interaction','enabled',settings.enabled);
    const mode=value(ui,'interaction','mode',settings.mode);
    const fallback=mode==='schedule'&&(!hasCurrentSchedule||ui.draft['schedule.enabled']===false);
    const note=enabled&&fallback?'暂无日程，暂按频率发送。':'';
    return {enabled,mode,note,showCustom:enabled&&mode==='custom'};
  }
  function interactionCard(ui,d){
    const {settings}=d.interaction;
    const {enabled,mode,note,showCustom}=outreachView(ui,d);
    return `<section class="life-card" data-life-scope="interaction">
      <div class="life-field life-check life-card-heading">
        <h3>主动信息</h3>
        <input type="checkbox" role="switch" aria-label="开启主动信息" data-life-field="enabled" ${enabled?'checked':''}>
      </div>
      <fieldset class="life-outreach-modes" data-outreach-modes aria-label="联系方式" ${enabled?'':'disabled'}>
        <h4 class="life-outreach-title">跟随日程</h4>
        <p class="life-outreach-description">好友忙完或有事想分享时，可以主动联系你。</p>
        <p class="life-outreach-note" data-outreach-note ${note?'':'hidden'}>${esc(note)}</p>
        <label class="life-field life-check life-outreach-custom">
          <span>自己配置</span>
          <input type="checkbox" role="switch" data-life-field="mode" value="custom" ${mode==='custom'?'checked':''}>
        </label>
        <div class="life-outreach-settings" data-outreach-settings ${showCustom?'':'hidden'}>
          ${d.interactionFields.map(field=>outreachSetting(ui,settings,field)).join('')}
        </div>
      </fieldset>
    </section>`;
  }
  const albumDate=key=>key.split('-').slice(1).map(Number).join('月')+'日';
  function albumMonthLabel(key,months){
    const [year,month]=key.split('-');
    return (months[0].month.slice(0,4)!==months.at(-1).month.slice(0,4)?year+'年':'')+Number(month)+'月';
  }
  function albumPager({page,pages},action,label='相册分页'){
    return pages>1?`<nav class="life-memory-pager life-album-pager" aria-label="${label}">
      <button type="button" ${action}="${page-1}" ${page===1?'disabled':''}>上页</button>
      <span aria-live="polite">${page} / ${pages} 页</span>
      <button type="button" ${action}="${page+1}" ${page===pages?'disabled':''}>下页</button>
    </nav>`:'';
  }
  function monthPicker({month:activeMonth,months},unit,onSelect){
    const dialog=openLifeView('选择月份',`<div class="life-album-month-options">${months.map(({month,count})=>`
      <button type="button" data-album-month="${month}" aria-pressed="${month===activeMonth}">
        <span>${albumMonthLabel(month,months)}</span><small>${count} ${unit}</small><i aria-hidden="true">${month===activeMonth?P().icons.check:''}</i>
      </button>`).join('')}</div>`);
    dialog.querySelector('.life-album-month-options').onclick=event=>{
      const month=event.target.closest('button')?.dataset.albumMonth;
      if(!month)return;
      P().closeModal();
      onSelect(month);
    };
  }
  function photoCard(ui,d){
    const album=ui.album,months=album?.months||[];
    const stacks=album?.total?`<div class="life-album-stacks">${album.items.map(({date,count,covers})=>`
      <button type="button" class="life-album-day" data-life-action="albumDay" data-day="${date}" data-count="${count}" aria-haspopup="dialog">
        <span class="life-album-deck">${covers.filter(safeImage).map(image=>`<img src="${esc(image)}" alt="" loading="lazy">`).join('')}</span>
        <span class="life-album-day-label"><span>${albumDate(date)}</span><small>${count} 张</small></span>
      </button>`).join('')}</div>`:album?'<p class="life-photo-empty">还没有照片</p>':'';
    return `<section class="life-card life-photo-references" id="life-photo-references">
        <h3>人物参考图</h3>${window.PipiEngine.renderRoleReferences(d.role.id,true)}
      </section>
      <section class="life-card life-album">
        <div class="life-photo-heading"><h3>相册${album?` <small>${album.total} 张</small>`:''}</h3>
          ${months.length?`<button type="button" class="life-album-month-toggle" data-life-action="albumMonths" aria-haspopup="dialog">${albumMonthLabel(album.month,months)}<i aria-hidden="true"></i></button>`:''}
        </div>
        ${stacks}
        ${album?albumPager(album,'data-album-page'):''}
        ${ui.albumError?`<p class="life-photo-empty" role="alert">${esc(ui.albumError)} <button type="button" data-life-action="albumRetry">重试</button></p>`:!album?'<p class="life-photo-empty">正在读取相册…</p>':''}
      </section>`;
  }
  function albumRequest(roleId,query){
    return P().api('/api/engine/life/album?'+new URLSearchParams({roleId,...query}));
  }
  async function loadAlbum(id,month='',page=1){
    const ui=session(id),request=albumRequest(id,{month,page});
    ui.albumBrowse={month,page};
    ui.albumRequest=request;
    try{
      const album=await request;
      if(ui.albumRequest!==request)return;
      ui.album=album;
      ui.albumBrowse={month:album.month,page:album.page};
      ui.albumError='';
    }catch(error){
      if(ui.albumRequest===request)ui.albumError=error.message;
    }finally{
      if(ui.albumRequest===request){
        ui.albumRequest=null;
        if(document.querySelector('[data-life-root]')?.dataset.lifeRoot===id&&ui.category==='photo')P().refresh();
      }
    }
  }
  function openAlbumDay(id,day,count){
    const dialog=openLifeView(albumDate(day)+' · '+count+' 张',`<div class="life-album-day-contents" aria-live="polite">正在读取照片…</div>
      <dialog class="life-album-photo-dialog" aria-label="照片预览"></dialog>`);
    const body=dialog.querySelector('.life-album-day-contents'),preview=dialog.querySelector('dialog');
    let result,request;
    const loadPage=async page=>{
      const pending=albumRequest(id,{day,page});
      request=pending;
      try{
        const data=await pending;
        if(!dialog.isConnected||request!==pending)return;
        result=data;
        body.innerHTML=albumPager(data,'data-day-page')+`<div class="life-photo-grid">${data.items.filter(photo=>safeImage(photo.image)).map((photo,i)=>`
          <button type="button" data-preview-photo="${esc(photo.id)}" aria-label="查看第 ${(data.page-1)*6+i+1} 张照片"><img src="${esc(photo.image)}" alt=""></button>`).join('')||'还没有照片'}</div>`;
      }catch(error){
        if(dialog.isConnected&&request===pending)body.innerHTML=`<p role="alert">${esc(error.message)} <button type="button" data-day-page="${page}">重试</button></p>`;
      }
    };
    body.onclick=event=>{
      const control=event.target.closest('button');
      if(!control)return;
      if(control.dataset.dayPage){loadPage(Number(control.dataset.dayPage));return;}
      const photo=result.items.find(item=>item.id===control.dataset.previewPhoto);
      const format=(/^data:image\/([^;]+)/i.exec(photo.image)?.[1]||photo.image.split('.').at(-1)).toLowerCase();
      const ext=format==='jpeg'?'jpg':format;
      preview.innerHTML=`<div class="life-album-photo-content"><div class="life-album-photo-body"><img class="life-album-preview" src="${esc(photo.image)}" alt="照片">
        ${photo.brief?`<p class="life-album-caption">${esc(photo.brief)}</p>`:''}</div>
        <div class="life-album-actions"><a class="primary-btn" href="${esc(photo.image)}" download="生活照-${esc(photo.id)}.${ext}">下载</a></div></div>`;
      P().openChildDialog(preview);
    };
    preview.onclick=event=>{if(event.target===preview)P().closeChildDialog();};
    loadPage(1);
  }
  async function loadMoments(id,month='',page=1){
    const ui=session(id),request=P().api('/api/engine/life/moments?'+new URLSearchParams({roleId:id,month,page}));
    ui.momentRequest=request;
    ui.momentBrowse={month,page};
    try{
      const feed=await request;
      if(ui.momentRequest!==request)return;
      ui.momentFeed=feed;
      ui.momentBrowse={month:feed.month,page:feed.page};
      ui.momentError='';
    }catch(error){
      if(ui.momentRequest===request)ui.momentError=error.message;
    }finally{
      if(ui.momentRequest===request){
        ui.momentRequest=null;
        if(document.querySelector('[data-life-root]')?.dataset.lifeRoot===id&&ui.category==='moments')P().refresh();
      }
    }
  }
  function momentsCard(ui,d){
    const {moments,role}=d,name=role.remark||role.name;
    const setting=key=>value(ui,'moments',key,moments.settings[key]);
    const enabled=setting('enabled');
    const toggle=(key,label)=>`<label class="life-field life-check"><span>${label}</span>
      <input type="checkbox" role="switch" data-life-field="${key}" ${setting(key)?'checked':''}>
    </label>`;
    const feed=ui.momentFeed,groups=new Map();
    const timeFormat=new Intl.DateTimeFormat('zh-CN',{timeZone:d.schedule.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    for(const {day,post,dayCount} of feed?.items||[]){
      if(!groups.has(day))groups.set(day,{dayCount,posts:[]});
      groups.get(day).posts.push(post);
    }
    return `<section class="life-card life-moment-settings" data-life-scope="moments">
      <div class="life-field life-check life-card-heading">
        <h3>自动发圈</h3>
        <input type="checkbox" role="switch" aria-label="开启自动发圈" data-life-field="enabled" ${enabled?'checked':''}>
      </div>
      <div class="life-moment-fields">
        <label class="life-moment-limit"><span>每天最多发圈</span>
          <span class="life-moment-number"><input type="number" inputmode="numeric" min="0" step="1" data-life-field="dailyMax" value="${esc(setting('dailyMax'))}"><span>条</span></span>
        </label>
        ${toggle('useChat','参考近期聊天')}
        ${toggle('useMemory','参考共同记忆')}
      </div>
    </section>
    <section class="life-card life-moment-feed">
      <div class="life-photo-heading">
        <h3>朋友圈日常${feed?` <small>${feed.total} 条</small>`:''}</h3>
        ${feed?.month?`<button type="button" class="life-album-month-toggle" data-life-action="momentMonths" aria-haspopup="dialog">${albumMonthLabel(feed.month,feed.months)}<i aria-hidden="true"></i></button>`:''}
      </div>
      ${feed?albumPager(feed,'data-moment-page','朋友圈分页'):''}
      ${[...groups].map(([day,{dayCount,posts}])=>`<section class="life-moment-day">
        <h4>${albumDate(day)} <small>${dayCount} 条</small></h4>
        ${posts.map(post=>{
        const comments=post.comments||[];
        const postText=post.content||'', textKey='moment-text-'+post.id;
        const characters=Array.from(postText);
        const textMarkup=characters.length<=120?'<p class="life-feed-text">'+esc(postText)+'</p>':
          `<details class="life-feed-copy" data-life-detail="${esc(textKey)}" ${ui.open.has(textKey)?'open':''}>
            <summary><span class="life-feed-excerpt">${esc(characters.slice(0,100).join(''))}…</span><span class="life-feed-more">全文</span><span class="life-feed-less">收起全文</span></summary>
            <p class="life-feed-text">${esc(postText)}</p>
          </details>`;
        const discussion=comments.map(comment=>`<p class="life-comment"><span>${esc(comment.authorId===role.id?name:'我')}</span>：${esc(comment.content)}</p>`).join('');
        const editor=`<div class="life-comment-form">
          <input data-comment="${esc(post.id)}" value="${esc(value(ui,'comment',post.id,''))}" placeholder="写一条评论" aria-label="评论内容">
          <button type="button" class="secondary-btn" data-life-action="comment" data-moment-id="${esc(post.id)}">发送</button>
        </div>`;
        return `<article class="life-feed">
          ${P().avatar(role,34)}
          <div class="life-feed-body">
            <div class="life-feed-author">${esc(name)}</div>
            ${postText?textMarkup:''}
            ${feedImages(post)}
            <small>${esc(timeFormat.format(post.createdAt))}</small>
            ${fold(ui,'moment-comment-'+esc(post.id),comments.length?'评论 '+comments.length:'评论',discussion+editor)}
          </div>
        </article>`;
        }).join('')}
      </section>`).join('')}
      ${ui.momentError?`<p class="life-moment-empty" role="alert">${esc(ui.momentError)} <button type="button" data-life-action="momentRetry">重试</button></p>`:
        !feed?'<p class="life-moment-empty">正在读取朋友圈…</p>':
          feed.restricted?'<p class="life-moment-empty">当前好友的朋友圈不可见</p>':
            !feed.total?'<p class="life-moment-empty">还没有发布朋友圈</p>':''}
    </section>`;
  }
  function render(roleId,preview=false){
    const roles=P().getState()?.roles||[];
    const role=roleId?roles.find(friend=>friend.id===roleId):preview?roles[0]:null;
    if(!role)return '<header class="topbar"><button class="back-btn" data-action="back" aria-label="返回">'+P().icons.back+'</button><h2>角色配置</h2></header><div class="content page-content">找不到好友。</div>';
    const id=role.id;
    const ui=session(id),d=ui.data;
    if(d&&!ui.loading&&!ui.loadError&&P().getState().revision>d.revision)load(id);
    const categoryButton = ({key,label,icon}) => {
      const selected = ui.category === key;
      const mark=icon==='calendar'
        ? '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M7.5 3v4m9-4v4m-13 3.5h17M8 15h4"/></svg>'
        : icon==='moments'?'<span class="icon life-moments-mark" aria-hidden="true"></span>'
          :icon==='wardrobe'?'<span class="icon life-wardrobe-mark" aria-hidden="true"></span>':P().icons[icon];
      return `<button type="button" class="category-tab ${selected?'active':''}" aria-pressed="${selected}" aria-controls="life-panel-${key}" data-life-category="${key}">${mark}<span>${label}</span></button>`;
    };
    const navigation = '<nav class="model-ui life-navigation" aria-label="角色配置分类"><div class="category-tabs"><div class="main-categories">'+
      categories.slice(0,4).map(categoryButton).join('')+'</div><div class="aux-categories">'+
      categories.slice(4).map(categoryButton).join('')+'</div></div></nav>';
    const body = d ? categories.map(({key,render}) =>
      `<div id="life-panel-${key}" data-life-panel="${key}" ${ui.category===key?'':'hidden'}>${render?render(ui,d):''}</div>`
    ).join('') : ui.loadError?'':'<p class="life-muted">正在读取…</p>';
    return '<header class="topbar"><div class="header-leading"><button class="back-btn" data-action="back" aria-label="返回">'+P().icons.back+'</button></div><h2 class="title-centered">角色配置</h2>'+
      '<div class="header-actions"><button class="life-save" data-life-action="saveAll" '+(!d||ui.saving||ui.readingImages.size?'disabled':'')+'>'+(ui.saving?'保存中':'保存')+'</button></div></header>'+
      '<div class="life-content content page-content" data-life-root="'+esc(id)+'">'+
      navigation+(ui.error?'<p class="life-error" role="alert">'+esc(ui.error)+'</p>':'')+
      (ui.loadError?`<p class="life-error" role="alert">${esc(ui.loadError)} <button type="button" class="text-btn" data-life-action="retryLoad">重试</button></p>`:'')+body+'</div>';
  }
  function capture(id){
    const root=document.querySelector('[data-life-root]');
    if(root?.dataset.lifeRoot!==id)return;
    session(id).scroll=root.scrollTop;
  }
  async function load(id){
    const ui=session(id),request=P().api('/api/engine/life?roleId='+encodeURIComponent(id));
    ui.loading=request;
    try{
      const data=await request;
      if(ui.loading===request){ui.data=data;ui.loadError='';}
    }catch(error){
      if(ui.loading===request)ui.loadError=error.message;
    }finally{
      if(ui.loading===request){
        ui.loading=null;
        if(document.querySelector('[data-life-root]')?.dataset.lifeRoot===id)P().refresh();
      }
    }
  }
  async function updateProfile(id,action,payload){
    const result=await P().api('/api/engine/schedule',{roleId:id,action,...payload});
    const {profile,profileMeta}=result.view;
    Object.assign(session(id).data.schedule,{profile,profileMeta});
    P().setState(result.state);
  }
  async function saveAll(id){
    const ui=session(id),snapshot={...ui.draft};ui.saving=true;
    try{
      const sections={};
      for(const scope of ['basic','schedule','profile','interaction','moments']){
        const changed=Object.entries(snapshot).filter(([key])=>key.startsWith(scope+'.'));
        if(changed.length)sections[scope]=Object.fromEntries(changed.map(([key,draft])=>[key.slice(scope.length+1),draft]));
      }
      if(Object.keys(sections).length){
        const {view,state}=await P().api('/api/engine/life',{roleId:id,action:'saveConfiguration',sections});
        ui.loading=null;ui.loadError='';ui.data=view;
        P().setState(state);
        for(const [scope,fields] of Object.entries(sections))for(const [field,draft] of Object.entries(fields)){
          const key=scope+'.'+field;
          if(ui.draft[key]===draft)delete ui.draft[key];
        }
      }
      ui.notice='设置已保存。';
    }finally{ui.saving=false;}
  }
  async function perform(id,action,el){
    const ui=session(id);capture(id);ui.error='';ui.notice='';
    if(action==='retryLoad'){
      if(!ui.loading){el.disabled=true;await load(id);}
      return;
    }
    if(action==='viewTimeline'){openTimeline(ui);return;}
    if(action==='saveAll'&&ui.saving){P().toast('正在保存，请稍候');return;}
    if(action==='generateProfile'||action==='restoreProfileBackup'){
      if(ui.saving){P().toast('正在保存，请稍候');return;}
      const restore=action==='restoreProfileBackup';
      const warning=Object.keys(ui.draft).some(key=>key.startsWith('profile.'))?'未保存的档案编辑也会被替换。':'';
      const description=restore?'将使用所选备份覆盖当前生活档案。':'将根据当前人设生成全部生活档案，并覆盖现有档案内容。';
      P().confirmDialog(restore?'恢复生活档案？':'生成生活档案？',description+warning,async isCurrent=>{
        const snapshot={...ui.draft};
        ui.saving=true;
        try{
          await updateProfile(id,action,restore?{index:Number(el.dataset.index)}:{});
          for(const key of Object.keys(snapshot))if(key.startsWith('profile.')&&ui.draft[key]===snapshot[key])delete ui.draft[key];
          P().toast(restore?'生活档案已恢复':'生活档案已生成');
        }finally{ui.saving=false;}
        if(!isCurrent()&&document.querySelector('[data-life-root]')?.dataset.lifeRoot===id)P().refresh();
      },restore?'恢复':'生成');
      return;
    }
    if(action==='outfitDetails'){
      const {outfit,outfitType}=ui.data.schedule.current;
      openLifeView(outfitLabel(outfitType),`<p class="life-outfit-detail">${esc(outfit)}</p>`);
      return;
    }
    if(action==='wardrobeFilter'){
      if(ui.wardrobeBrowse.category===el.dataset.wardrobeCategory)return;
      Object.assign(ui.wardrobeBrowse,{category:el.dataset.wardrobeCategory,page:1});
      P().refresh();
      return;
    }
    if(action==='wardrobePage'){
      ui.wardrobeBrowse.page=Number(el.dataset.wardrobePage);
      P().refresh();
      return;
    }
    if(action==='wardrobeSeason'){
      const {season}=ui.wardrobeBrowse;
      const dialog=openLifeView('筛选季节',`<div class="life-album-month-options life-wardrobe-season-options">${['','春','夏','秋','冬'].map(option=>
        `<button type="button" data-wardrobe-season="${option}" aria-pressed="${option===season}"><span>${option?`${option}季`:'全部季节'}</span><i aria-hidden="true">${option===season?P().icons.check:''}</i></button>`).join('')}</div>`);
      for(const button of dialog.querySelectorAll('[data-wardrobe-season]'))button.onclick=()=>{
        P().closeModal();
        if(button.dataset.wardrobeSeason===season)return;
        Object.assign(ui.wardrobeBrowse,{season:button.dataset.wardrobeSeason,page:1});
        P().refresh();
      };
      return;
    }
    if(action==='wardrobeJump'){
      const {page,pages}=ui.wardrobeBrowse;
      const dialog=openLifeView('跳转页码',`<div class="life-wardrobe-jump"><input type="number" name="page" inputmode="numeric" min="1" max="${pages}" step="1" value="${page}" required aria-label="页码，1 至 ${pages}"><button type="submit">跳转</button></div>`);
      dialog.querySelector('form').addEventListener('submit',event=>{
        ui.wardrobeBrowse.page=event.currentTarget.elements.page.valueAsNumber;
        P().closeModal();
        P().refresh();
      });
      return;
    }
    if(action==='wardrobeImport'){
      const {assign,models}=P().getState().settings.ai;
      const simulated=/^mock-(?:wardrobe-vision|life-)/.test(models.find(model=>model.id===(assign.chat||assign.caption))?.model||'');
      window.PipiWardrobeImport.open(id,({result,view,state})=>{
        ui.data.schedule.wardrobe=view.wardrobe;
        P().setState(state);
        if(document.querySelector('[data-life-root]')?.dataset.lifeRoot===id){
          P().refresh();
          P().toast(`已导入 ${result.added} 套${result.duplicates?`，跳过 ${result.duplicates} 张重复图片`:''}`);
        }
      },{simulated});
      return;
    }
    if(action==='wardrobeAdd'||action==='wardrobeEdit'){
      const item=ui.data.schedule.wardrobe.find(outfit=>outfit.id===el.dataset.outfitId);
      window.PipiSchedule.openWardrobeEditor(id,item,{onSaved:view=>{ui.data.schedule.wardrobe=view.wardrobe;P().refresh();}});
      return;
    }
    if(action==='wardrobeMenu'){
      const itemId=el.dataset.outfitId;
      P().actionSheet('',[{label:'移除穿搭',danger:true,run:()=>P().confirmDialog('移除这套穿搭？','',async()=>{
        const result=await P().api('/api/engine/schedule',{roleId:id,action:'removeWardrobe',itemId});
        ui.data.schedule.wardrobe=result.view.wardrobe;
        P().setState(result.state);
        P().toast('已移除穿搭');
      },'移除')}]);
      return;
    }
    if(action==='albumRetry'){await loadAlbum(id,ui.albumBrowse.month,ui.albumBrowse.page);return;}
    if(action==='albumDay'){openAlbumDay(id,el.dataset.day,el.dataset.count);return;}
    if(action==='albumMonths'){monthPicker(ui.album,'张',month=>loadAlbum(id,month));return;}
    if(action==='momentRetry'){await loadMoments(id,ui.momentBrowse.month,ui.momentBrowse.page);return;}
    if(action==='momentMonths'){
      monthPicker(ui.momentFeed,'条',month=>loadMoments(id,month));
      return;
    }
    el.disabled=true;
    try{
      if(action==='saveAll'){await saveAll(id);if(document.querySelector('[data-life-root]')?.dataset.lifeRoot===id)P().refresh();}
      else if(action==='comment'){
        const input=document.querySelector(`[data-comment="${CSS.escape(el.dataset.momentId)}"]`),draft=input.value,key='comment.'+el.dataset.momentId;
        if(!draft.trim())throw new Error('请填写评论内容');
        await P().act('moment.comment',{id:el.dataset.momentId,content:draft.trim()});
        if(ui.draft[key]===draft)delete ui.draft[key];
        ui.notice='评论已发送。';
        if(document.querySelector('[data-life-root]')?.dataset.lifeRoot===id)P().refresh();
      }
      if(ui.notice)P().toast(ui.notice);
    }catch(error){ui.error=error.message;P().refresh();}finally{el.disabled=false;}
  }
  function bind(){const root=document.querySelector('[data-life-root]');if(!root)return;const id=root.dataset.lifeRoot,ui=session(id);
    if(!ui.data&&!ui.loading&&!ui.loadError)load(id);
    const categoryButtons=root.querySelectorAll('[data-life-category]');
    function showLibrary(){
      const key=ui.category;
      if(!ui.data)return;
      if(key==='photo'&&!ui.albumError&&!ui.albumRequest&&(ui.album?.revision??-1)<P().getState().revision)loadAlbum(id,ui.albumBrowse.month,ui.albumBrowse.page);
      if(key==='moments'&&!ui.momentError&&!ui.momentRequest&&(ui.momentFeed?.revision??-1)<P().getState().revision)loadMoments(id,ui.momentBrowse.month,ui.momentBrowse.page);
      if(key!=='memory'&&key!=='stickers')return;
      const panel=root.querySelector('[data-life-panel="'+key+'"]');
      panel.innerHTML=window.PipiEngine.renderRoleLibrary(key,id);
      window.PipiEngine.bindRoleLibrary(key,id,panel,image=>openLifeView('表情预览',`<img class="life-sticker-preview" src="${esc(image)}" alt="表情">`));
    }
    for(const button of categoryButtons)button.onclick=()=>{
      if(ui.category===button.dataset.lifeCategory)return;
      ui.category=button.dataset.lifeCategory;
      ui.scroll=0;root.scrollTop=0;
      for(const item of categoryButtons){
        const selected=item===button;
        item.classList.toggle('active',selected);
        item.setAttribute('aria-pressed',String(selected));
      }
      for(const panel of root.querySelectorAll('[data-life-panel]'))panel.hidden=panel.dataset.lifePanel!==ui.category;
      showLibrary();
      if((ui.category==='schedule'||ui.category==='interaction')&&ui.data&&!ui.loading&&!ui.loadError)load(id);
    };
    showLibrary();
    const ready=ui.data&&(ui.category!=='photo'||ui.album||ui.albumError)&&(ui.category!=='moments'||ui.momentFeed||ui.momentError);
    if(ready){root.scrollTop=ui.scroll;root.onscroll=()=>{ui.scroll=root.scrollTop;};}
    const references=root.querySelector('#life-photo-references');
    if(references)window.PipiEngine.bindReferences(id,references);
    root.querySelectorAll('[data-album-page]').forEach(el=>el.onclick=()=>{capture(id);loadAlbum(id,ui.album.month,Number(el.dataset.albumPage));});
    root.querySelectorAll('[data-moment-page]').forEach(el=>el.onclick=()=>{
      capture(id);
      loadMoments(id,ui.momentFeed.month,Number(el.dataset.momentPage));
    });
    document.querySelectorAll('[data-life-action]').forEach(el=>el.onclick=()=>perform(id,el.dataset.lifeAction,el));
    for(const input of root.querySelectorAll('[data-basic-image]')){
      const key=input.dataset.basicImage;
      const pick=root.querySelector('[data-pick-image="'+key+'"]');
      pick.disabled=ui.readingImages.has(key);
      pick.onclick=()=>input.click();
      input.onchange=async()=>{
        const file=input.files[0];
        if(!file)return;
        ui.readingImages.add(key);
        pick.disabled=true;
        document.querySelector('[data-life-action="saveAll"]').disabled=true;
        try{
          const isCurrent=()=>document.querySelector('[data-life-root]')?.dataset.lifeRoot===id && ui.category==='basic';
          const cropped=await window.PipiLifeCrop.pick(file,key,{isCurrent});
          if(cropped && isCurrent())ui.draft['basic.'+key]=cropped;
        }
        catch(error){P().toast(error.message);}
        finally{
          ui.readingImages.delete(key);
          if(document.querySelector('[data-life-root]')?.dataset.lifeRoot===id){capture(id);P().refresh();}
        }
      };
    }
    const syncOutreach=()=>{
      const {enabled,mode,note,showCustom}=outreachView(ui,ui.data);
      for(const toggle of root.querySelectorAll('[data-life-scope="interaction"] [data-life-field="enabled"]'))toggle.checked=enabled;
      for(const group of root.querySelectorAll('[data-outreach-modes]'))group.disabled=!enabled;
      for(const option of root.querySelectorAll('[data-outreach-modes] [data-life-field="mode"]'))option.checked=option.value===mode;
      for(const hint of root.querySelectorAll('[data-outreach-note]')){
        hint.textContent=note;
        hint.hidden=!note;
      }
      root.querySelector('[data-outreach-settings]').hidden=!showCustom;
    };
    root.querySelectorAll('[data-life-field]').forEach(el=>el.oninput=()=>{
      const scope=el.closest('[data-life-scope]').dataset.lifeScope;
      const field=el.dataset.lifeField;
      if(scope==='interaction'&&field==='mode'){
        ui.draft['interaction.mode']=el.type==='checkbox'&&!el.checked?'schedule':el.value;
        syncOutreach();
        return;
      }
      const draft=el.type==='checkbox'?el.checked:el.type==='number'?el.valueAsNumber:el.value;
      ui.draft[scope+'.'+field]=Number.isNaN(draft)?null:draft;
      if((scope==='interaction'||scope==='schedule')&&field==='enabled')syncOutreach();
      if(scope==='profile')el.closest('details').querySelector('.life-archive-preview').textContent=el.value.trim()||'待补充';
    });
    window.PipiSchedule.bindSleepProfile(root);
    root.querySelectorAll('[data-comment]').forEach(el=>el.oninput=()=>{ui.draft['comment.'+el.dataset.comment]=el.value;});
    const basic=root.querySelector('[data-life-scope="basic"]');
    if(basic)window.PipiLifeBasic.bind(basic,ui,ui.data.role);
    root.querySelectorAll('.life-feed-images').forEach(group=>{
      const buttons=[...group.querySelectorAll('[data-life-image]')];
      const images=buttons.map(button=>button.dataset.lifeImage);
      buttons.forEach((button,index)=>{
        button.onclick=()=>{
          capture(id);
          P().openPhoto(images[index],'朋友圈图片',{images,index});
        };
      });
    });
    root.querySelectorAll('[data-life-detail]').forEach(el=>el.ontoggle=()=>{if(el.open)ui.open.add(el.dataset.lifeDetail);else ui.open.delete(el.dataset.lifeDetail);});
  }
  window.addEventListener('pagehide',()=>{
    const id=document.querySelector('[data-life-root]')?.dataset.lifeRoot;
    if(!id||history.state?.route?.name!=='role-config')return;
    const {category,scroll,open,albumBrowse,momentBrowse,wardrobeBrowse}=session(id);
    const wardrobe={category:wardrobeBrowse.category,season:wardrobeBrowse.season,page:wardrobeBrowse.page};
    sessionStorage.setItem(layoutKey(id),JSON.stringify({category,scroll,open:[...open],moments:momentBrowse,album:albumBrowse,wardrobe}));
  });
  window.PipiLife={render,bind};
})();
