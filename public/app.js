'use strict';
(() => {
  if(typeof crypto!=='undefined'&&typeof crypto.randomUUID!=='function'&&typeof crypto.getRandomValues==='function'){
    crypto.randomUUID=()=>([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
  }
  const view = document.getElementById('view');
  const overlay = document.getElementById('overlay');
  const toastEl = document.getElementById('toast');
  // Adapted from LiangNiang/fake-world, GPL-3.0-only, commit
  // de336cfc469772bccdf00ef1f91bfbf8d3953d08. Source: packages/web/src/assets,
  // wechatComponents/{BottomNavbar,List,User/UserAvatar}, and conversation header/footer.
  // Plain DOM implementation retains this application's server-backed business actions.
  // Native layout/interaction reference: alexiscn/WeChatSwift (MIT code),
  // Commit 75d83cd281cd7cf2f9a7153292ab3fca260293bd; Screenshots/01-03; SessionCellNode (48px avatar, 72px row, 76px separator),
  // SessionMoreMenuFloatView (160px x 56px rows), ChatRoomToolPanelNode
  // (4 x 2 paging, 64px buttons), ChatRoomContactInfoViewController (8px groups).
  // Reference artwork/fonts are not copied; this app reuses the GPL icon set below.
  // Masks are rendering derivatives: the upstream React SVG root fill is resolved
  // to black while original licensed SVG bytes remain intact in /icons.
  const assetIcon = (name, color = false, cls = '') => color
    ? `<img class="icon asset-icon ${cls}" src="/vendor/fake-world/icons/${name}.svg" alt="" aria-hidden="true">`
    : `<span class="icon mask-icon ${cls}" style="--icon-url:url('/vendor/fake-world/masks/${name}.svg')" aria-hidden="true"></span>`;
  const nativeIcon = name => `<span class="icon mask-icon" style="--icon-url:url('/vendor/native-icons/${name}.svg')" aria-hidden="true"></span>`;
  // The upstream chat mark uses a white fill / dark stroke when inactive. Keep its
  // licensed path unchanged so both states follow BottomNavbar, rather than drawing a substitute.
  const chatMark = `<svg class="icon chat-mark" viewBox="0 0 29 28" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.875 23.3333C21.3184 23.3333 26.5417 18.8935 26.5417 13.4167C26.5417 7.93984 21.3184 3.5 14.875 3.5C8.43172 3.5 3.20837 7.93984 3.20837 13.4167C3.20837 16.3758 4.73321 19.0322 7.15142 20.8492L6.79898 23.8812C6.76178 24.2012 6.99104 24.4908 7.31105 24.528C7.42049 24.5407 7.53129 24.5222 7.63063 24.4746L11.1107 22.8058C12.2917 23.1478 13.5579 23.3333 14.875 23.3333Z"/></svg>`;
  // GPL-3.0-only rendering adaptation of fake-world favorites.svg's cube geometry.
  // The three filled faces are separated by transparent Y-shaped gaps. This is
  // a secondary-reference approximation, not copied proprietary WeChat artwork.
  const chatFavoritesMark='<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.2 9 5.25-9 5.2-9-5.2Zm-9 6.65 8.4 4.85v8.5L3 17.3Zm18 0v8.45l-8.4 4.9v-8.5Z"/></svg>';
  // Original common geometric tool symbols (GPL-3.0-only). Filled subjects
  // follow the accepted secondary sample; they do not certify 8.0.80 artwork.
  const toolRedpacketMark='<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="4.5" y="2.5" width="15" height="19" rx="1"/><path d="M4.5 7c3.8 4.4 11.2 4.4 15 0" fill="none" stroke="#fff" stroke-width="1.2"/><circle cx="12" cy="10.5" r="1.6" fill="#fff"/></svg>';
  const toolTransferMark='<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.6 4.2 20.4 9.6v1.5H3.6V9.3h12.3V5.6Zm-5.200 15.600L3.600 14.400v-1.500h16.800v1.800H8.100v3.700Z"/></svg>';
  const toolGiftMark='<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.500 5h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10.500l-3.500 2.800V18H4.500a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="M12 11.200c-1.600-2.600-4.800-3.200-4.800-1.300 0 1.900 3.200 1.800 4.800 1.300Zm0 0c1.600-2.600 4.800-3.200 4.800-1.300 0 1.900-3.200 1.800-4.800 1.300Zm0 0-2.600 3.400m2.600-3.400 2.600 3.400M3 11.200h18" fill="none" stroke="#fff" stroke-width="1.100" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // Filled adaptation of the existing GPL fake-world cards.svg geometry,
  // scoped to the chat tool panel.
  const toolCardsMark='<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5.9 20.2 3.5a.7.7 0 0 1 .8.7v2.7L3 4.6Zm1 .1 17.2 2.3a1 1 0 0 1 .8 1v10.6a.8.8 0 0 1-1 .8L3.8 18.5a1 1 0 0 1-.8-1V6.9a.8.8 0 0 1 1-.9Z"/><path d="m5 10 15 2v1.6L5 11.6Z" fill="#fff"/></svg>';
  // WeUI Icon v1.0.2, Copyright 2021 Tencent, Inc., MIT. Filled music.svg
  // at weui/weui-icon c9dc64ea1a9c4ba87c018bed214eb8731e6e2e04.
  const toolMusicMark='<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18 4.309L8 6.5v12.7c0 .937-.627 1.85-1.47 2.243-.157.073-1.148.295-1.277.32-1.243.25-2.198-.814-2.25-1.89-.053-1.077.653-1.974 1.472-2.139l1.265-.317c.447-.112.76-.514.76-.975V5.96a1 1 0 01.786-.976l11.607-2.542a.5.5 0 01.607.488v13.61c0 .937-.633 1.85-1.483 2.243-.158.073-1.158.295-1.288.32-1.253.25-2.217-.814-2.27-1.89-.053-1.077.66-1.974 1.485-2.139l1.292-.32c.449-.11.764-.513.764-.975v-9.47z" fill-rule="evenodd" fill-opacity=".9"/></svg>';
  // Original geometric marks for the payment cards (GPL-3.0-only): a ringed exchange symbol and a plain envelope.
  const transferCardMark='<svg class="icon payment-mark" viewBox="0 0 42 42" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="21" cy="21" r="19.8" stroke-width="2"/><path d="M12.5 17.5h17l-5-4.5M29.5 24.5h-17l5 4.5" stroke-width="2"/></svg>';
  const redpacketCardMark='<svg class="icon payment-mark" viewBox="0 0 34 42" aria-hidden="true"><rect x="1" y="1" width="32" height="40" rx="3" fill="#e0584b"/><path d="M1 4a3 3 0 0 1 3-3h26a3 3 0 0 1 3 3v9.5C24 19 10 19 1 13.5Z" fill="#ef6f5e"/><circle cx="17" cy="17.5" r="5" fill="#fbd284"/></svg>';
  const icons = {
    chat:chatMark, contacts:assetIcon('address-book-outlined'), discover:assetIcon('discover-outlined'), me:assetIcon('people-outlined'),
    plus:assetIcon('plus-circle'), add:assetIcon('add2-outlined'), search:assetIcon('search-outlined'),
    chevron:assetIcon('arrow-outlined',false,'chevron'), back:'<svg class="icon nav-back-mark" viewBox="0 0 10 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.6 1 1 9l7.6 8"/></svg>', more:'<svg class="icon nav-more-mark" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><circle cx="2" cy="9" r="2"/><circle cx="9" cy="9" r="2"/><circle cx="16" cy="9" r="2"/></svg>',
    close:assetIcon('close-outlined'), image:assetIcon('album-outlined'), camera:assetIcon('camera-outlined'), video:assetIcon('video-call-outlined'), location:assetIcon('location-outlined'), redpacket:assetIcon('redpacket-outlined'), file:assetIcon('folder-outlined'), music:assetIcon('music-outlined'), gift:assetIcon('gift-outlined'),
    voice:assetIcon('voice-outlined'), voiceWave:assetIcon('voice'), mic:assetIcon('voice-outlined'), keyboard:assetIcon('keyboard-outlined'), smile:assetIcon('sticker-outlined'),
    voiceBubbleWave:'<svg class="voice-signal" viewBox="0 0 18 22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 10q1 1 0 2"/><path class="wave-middle" d="M7 7.6q3 3.4 0 6.8"/><path class="wave-far" d="M10.5 4.6q5.5 6.4 0 12.8"/></svg>',
    heart:assetIcon('like-outlined'), wallet:assetIcon('wallet-outlined'), meFavorites:assetIcon('favorites',true), toolFavorites:chatFavoritesMark, messageFavorites:assetIcon('favorites'), toolImage:assetIcon('album-filled'), toolCamera:assetIcon('camera-filled'), toolContact:nativeIcon('tool-me-filled'), toolCards:toolCardsMark, toolMusic:toolMusicMark, toolVideo:nativeIcon('tool-video-call-filled'), toolLocation:nativeIcon('tool-location-filled'), toolVoice:nativeIcon('tool-mike-filled'), toolFile:nativeIcon('tool-folder-filled'), toolRedpacket:toolRedpacketMark, toolTransfer:toolTransferMark, toolGift:toolGiftMark,
    settings:assetIcon('setting-outlined'), check:assetIcon('done-filled'), trash:'',
    book:assetIcon('news-outlined'), edit:assetIcon('more-2-outlined'), farm:assetIcon('games',true), services:assetIcon('paylogo-outlined'),
    moments:assetIcon('moment',true),channels:'<img class="icon asset-icon" src="/icons/channels.svg" alt="" aria-hidden="true">', info:assetIcon('help-outlined'), copy:'',
    quote:assetIcon('comment-outlined'), pin:'', transfer:assetIcon('transfer2-outlined'),
    send:assetIcon('done2-outlined'), cloud:assetIcon('display-mobile-outlined'), logout:assetIcon('back-filled'),
    qrcode:assetIcon('qrcode-outlined'), scan:assetIcon('scan-outlined'), addFriend:assetIcon('add-friend-outlined'), skin:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linejoin="round" aria-hidden="true"><path d="m8 3.7-5.7 3.8L5 12.3l2.8-1.5v9.5h8.4v-9.5l2.8 1.5 2.7-4.8L16 3.7a4.1 4.1 0 0 1-8 0Z"/></svg>',
  };
  icons.scan='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8.5V6a2 2 0 0 1 2-2h2.500M15.500 4H18a2 2 0 0 1 2 2v2.500M20 15.500V18a2 2 0 0 1-2 2h-2.500M8.500 20H6a2 2 0 0 1-2-2v-2.500M2.500 12h19"/></svg>';
  icons.games=assetIcon('games',true);
  icons.farm='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#07c160" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21v-9M12 14.500C12 10 9 7.500 4 7.500c0 4.500 3 7 8 7ZM12 12c0-4.500 2.800-7.500 8-8 .3 5-2.800 8-8 8ZM6 21h12"/></svg>';
  icons.miniProgram=assetIcon('mini-program-2-outlined');
  icons.meAlbum='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#1485ee" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><rect x="2.7" y="4.7" width="18.6" height="14.6" rx="1.2"/><path d="m3 16.2 5.2-5 4 3.8 2.8-2.6 6 5.2"/></svg>';
  icons.mePersona='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.8h11.700v12.200" stroke="#2f6fd6"/><path d="M6.300 5.900h11.800v12.300" stroke="#f5a33c"/><rect x="2.800" y="9" width="12.200" height="12.200" rx=".8" stroke="#35a8f5"/></svg>';
  Object.assign(icons,Object.fromEntries(['location','file','music','shopping','group','tag','mute','gift','shake','nearby','redpacket'].map(name=>[name,nativeIcon(name)])),{contactCard:nativeIcon('contact-card')});
  const statusSvg=body=>`<svg class="icon status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  Object.assign(icons,{
    statusHappy:statusSvg('<circle cx="12" cy="12" r="9"/><path d="M8.2 10.2c.5-.8 1.5-.8 2 0M13.8 10.2c.5-.8 1.5-.8 2 0M8.5 14.2c.9 1.6 2.1 2.3 3.5 2.3s2.6-.7 3.5-2.3"/>'),
    statusDaze:statusSvg('<circle cx="12" cy="12.5" r="8.5"/><circle cx="9.2" cy="11.2" r="1" fill="currentColor" stroke="none"/><circle cx="14.8" cy="11.2" r="1" fill="currentColor" stroke="none"/><path d="M9.5 15.2h5"/><circle cx="19.5" cy="4.5" r="1.3"/>'),
    statusBusy:statusSvg('<circle cx="12" cy="12" r="9"/><path d="M12.6 7.2 9.4 12.3h4.2l-.8 4.5 3.8-5.3h-4.2Z"/>'),
    statusFocus:statusSvg('<path d="M12 6.2C10.2 5 7.5 4.6 4.5 5v12.5c3-.4 5.7 0 7.5 1.3m0-12.6c1.8-1.2 4.5-1.6 7.5-1.2v12.5c-3-.4-5.7 0-7.5 1.3m0-12.6v12.6"/>'),
    statusFish:statusSvg('<path d="M20.5 12c-2.4-3.6-6-5.2-9.8-4.5-2.1.4-3.9 1.6-5.2 3.2L2.5 8.5v7l3-2.2c1.3 1.6 3.1 2.8 5.2 3.2 3.8.7 7.4-.9 9.8-4.5Z"/><circle cx="15.8" cy="10.8" r="1" fill="currentColor" stroke="none"/>'),
    statusWork:statusSvg('<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8v1.7M3.5 12.5h17"/>'),
    statusTravel:statusSvg('<path d="M21 15.5 13.5 11V4.8a1.5 1.5 0 0 0-3 0V11L3 15.5v2l7.5-2.3V19l-2.2 1.5V22l3.7-1 3.7 1v-1.5L13.5 19v-3.8L21 17.5Z"/>'),
    statusExercise:statusSvg('<path d="M6.5 7v10M3.8 9v6M17.5 7v10M20.2 9v6M6.5 12h11"/>'),
    statusCoffee:statusSvg('<path d="M5 9h11v5a5.5 5.5 0 0 1-11 0V9Zm11 1.2h1.8a2.4 2.4 0 0 1 0 4.8H16M4 20h13M8.2 4.5c0 1.2 1 1.4 1 2.5M12.2 4.5c0 1.2 1 1.4 1 2.5"/>'),
    statusRest:statusSvg('<path d="M6 18C6 10.5 11.5 5.5 19.5 5c.5 8-4.5 13.5-12 13.5H6Zm0 0L4 20M6.5 17.5 14 10"/>'),
    statusMusic:statusSvg('<path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2"/><rect x="3.5" y="13.5" width="3.5" height="6" rx="1.5"/><rect x="17" y="13.5" width="3.5" height="6" rx="1.5"/>'),
    statusGame:statusSvg('<rect x="3" y="7.5" width="18" height="10" rx="4.5"/><path d="M8.5 10.5v4M6.5 12.5h4"/><circle cx="15.2" cy="11.3" r=".9" fill="currentColor" stroke="none"/><circle cx="17.2" cy="13.5" r=".9" fill="currentColor" stroke="none"/>'),
    statusSleep:statusSvg('<path d="M18.5 14.8A7.5 7.5 0 0 1 9.2 5.5a7.5 7.5 0 1 0 9.3 9.3Z"/><path d="M16.5 4.5h3l-3 3.5h3" stroke-width="1.5"/>'),
    statusOther:statusSvg('<path d="m12 3.5 2.1 5.6 5.6 2.1-5.6 2.1L12 18.9l-2.1-5.6-5.6-2.1 5.6-2.1Z"/><path d="M18.5 4v3M17 5.5h3" stroke-width="1.5"/>'),
    backupExport:statusSvg('<path d="M12 15V4m0 0-4 4m4-4 4 4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
    backupRestore:statusSvg('<path d="M12 4v11m0 0-4-4m4 4 4-4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>')
  });
  const initialView=document.body.dataset.initialView==='life-workbench'?'life-workbench':'chats';
  const browserPositionKey='pipi.browser-position';
  let rolePanelAvailable=false;
  const restoredPage=history.state?.pipi&&typeof history.state.route?.name==='string'?history.state:null;
  let state = null, csrf = '', authEpoch = 0, route = restoredPage?{...restoredPage.route}:{name:initialView,arg:null}, authSetup = false, modalOpen = false, searchTerm = '', searchOpen = false;
  let sourceUrl = '';
  let composeText = '', composeImage = '', composeStickerId = '', quoteId = '', panel = '', sending = false, sendingRoleId = '', outgoing = null, avatarDraft = '', toastTimer, pendingRender = false, modalReturnFocus = null;
  let recordingSession=null,dictationBusy=false,composeComposing=false,searchComposing=false,deferredComposerUpdate=false;
  const routes = new Map();
  const navStack = restoredPage?.stack?.slice()||[], drafts = new Map(), chatScrolls = new Map();
  const newChatMessageIds=new Set();
  let speechSession=null;
  let slowReplyRole='',chatProgressSequence=0;
  const composerHistories=new Map(),pendingDraftSends=new Map();
  const composerPointers=new Set();
  const patRequests=new Set();
  const avatarTaps=new Map();
  const readRequests=new Set();
  let composerPointerSettling=false,composerPointerFrame=0,pointerComposerUpdatePending=false,pointerViewRefreshPending=false;
  let focusMessageId = '', forceBottomRole='', composerSelection = {start:0,end:0};
  let composerScroll={input:0,emoji:0};
  let morePage=0, emojiPage=0, chatSearch='',chatSearchFilter='all',chatSearchDate='';
  let emojiTab='all',emojiSearch='',emojiExpandedHeight=0;
  let composerPanelFrom=null;
  let modalCloseCallback=null,modalSaveInProgress=false;
  let statusDraft=null,statusSaving=false,statusExpiryTimer;
  let chatSelection=null;
  let globalSearchTerm='';
  let contactsReturn=null,chatsReturn=0;
  const transcriptViews=new Map();
  const statusChoices=[['happy','美滋滋','statusHappy'],['daze','发呆','statusDaze'],['busy','忙','statusBusy'],['focus','学习','statusFocus'],['fish','摸鱼','statusFish'],['work','搬砖','statusWork'],['travel','出差','statusTravel'],['exercise','运动','statusExercise'],['coffee','喝咖啡','statusCoffee'],['rest','休息','statusRest'],['music','听歌','statusMusic'],['game','玩游戏','statusGame'],['sleep','睡觉','statusSleep'],['other','其他','statusOther']];
  const statusGroups=[['心情想法',['happy','daze']],['工作学习',['busy','focus','fish','work','travel']],['活动',['exercise','coffee']],['休息',['rest','music','game','sleep']],['其他',['other']]];
  const statusThemes={happy:'#8c9364',daze:'#747f92',busy:'#797b69',focus:'#657f91',fish:'#6d8f8b',work:'#a6a46d',travel:'#687f95',exercise:'#9c8270',coffee:'#9b8275',rest:'#7d7f9a',music:'#7e7e9a',game:'#738989',sleep:'#6c718d',other:'#718c83'};
  let overlayBackPending=false,overlayCloseQueued=false,queuedView=null,queuedBack=false;
  let childDialog=null,childDialogSequence=0;
  const overlayBackWaiters=[];
  const afterOverlayBack=()=>overlayBackPending?new Promise(resolve=>overlayBackWaiters.push(resolve)):Promise.resolve();
  const featureNames = new Set(['moments','moment-album','ledger','wallet','farm','favorites','services']);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeImage = value => typeof value === 'string' && ((/^data:image\/(?:png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=\s]+$/.test(value) && value.length < 12500000) || /^\/api\/media\/[a-f0-9]{32,64}\.(?:png|jpg|jpeg|webp|gif)$/i.test(value.trim()));
  const safeAudio = value => typeof value === 'string' && /^data:audio\/(?:mpeg|mp3|wav|x-wav|ogg|webm|mp4|aac|flac)(?:;codecs=[a-zA-Z0-9.,-]+)?;base64,[a-zA-Z0-9+/=\s]+$/.test(value);
  function emojiSprite(item,inline=false){const x=Number(item.x),y=Number(item.y);if(!Number.isFinite(x)||!Number.isFinite(y))return esc(item.token);return `<span class="wechat-emoji ${inline?'inline-emoji':''}" style="background-position:${x}px ${y}px;${item.row===3&&item.col===4?`transform:scale(${inline?.95:1.05})`:''}" aria-label="${esc(item.label||item.token)}" role="img"></span>`;}
  let emojiSource,emojiLookup;
  function compiledEmoji(){
    const entries=window.PipiEmoji;
    if(!emojiLookup||entries!==emojiSource){
      emojiSource=entries;
      const map=new Map((entries||[]).map(item=>[item.token,item]));
      const tokens=[...map.keys()].filter(Boolean).sort((a,b)=>b.length-a.length);
      emojiLookup={map,expression:tokens.length?new RegExp('('+tokens.map(token=>token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')','g'):null};
    }
    return emojiLookup;
  }
  function richText(value,editable=false){const {map,expression}=compiledEmoji(),text=String(value??'');if(!expression)return esc(text);return text.split(expression).map(part=>{if(!map.has(part))return esc(part);const html=emojiSprite(map.get(part),true);return editable?html.replace('<span ','<span contenteditable="false" data-compose-token="'+esc(part)+'" '):html;}).join('');}
  // Reuse the licensed sprite and token renderer above. A real editing host lets
  // the browser place the caret around atomic pictures, including wrapped lines;
  // the server and drafts continue to receive the existing plain token format.
  function composerDOM(input){
    let text='';const units=[],boundaries=new Map(),tokens=compiledEmoji().map;
    const visit=node=>{
      if(node.nodeType===Node.TEXT_NODE){const value=node.data.replace(/\u00a0/g,' '),start=text.length;text+=value;units.push({node,start,end:text.length});return;}
      if(node.nodeType!==Node.ELEMENT_NODE)return;
      const token=node.dataset.composeToken;
      if(token&&tokens.has(token)){const start=text.length;text+=token;units.push({node,start,end:text.length,atomic:true});return;}
      if(node.tagName==='BR'){if(!(node.parentNode===input&&input.childNodes.length===1)){const start=text.length;text+='\n';units.push({node,start,end:text.length,atomic:true});}return;}
      const points=[];boundaries.set(node,points);let previousBlock=false;
      [...node.childNodes].forEach((child,index)=>{const block=child.nodeType===1&&/^(DIV|P|LI)$/.test(child.tagName);if((block||previousBlock)&&text&&!text.endsWith('\n'))text+='\n';points[index]=text.length;visit(child);previousBlock=block;});points[node.childNodes.length]=text.length;
    };visit(input);
    const offset=(node,index)=>{const unit=units.find(item=>item.node===node);if(unit)return unit.atomic?(index?unit.end:unit.start):unit.start+Math.min(index,unit.end-unit.start);return boundaries.get(node)?.[index];};
    const point=value=>{value=Math.max(0,Math.min(text.length,value));for(const unit of units){if(value<=unit.end){if(!unit.atomic)return [unit.node,Math.max(0,value-unit.start)];const parent=unit.node.parentNode,index=[...parent.childNodes].indexOf(unit.node);return [parent,index+(value>unit.start?1:0)];}}return [input,input.childNodes.length];};
    return {text,offset,point};
  }
  function readComposerSelection(input){const selection=getSelection();if(!selection?.rangeCount)return composerSelection;const range=selection.getRangeAt(0);if(!input.contains(range.startContainer)||!input.contains(range.endContainer))return composerSelection;const model=composerDOM(input),start=model.offset(range.startContainer,range.startOffset),end=model.offset(range.endContainer,range.endOffset);return Number.isFinite(start)&&Number.isFinite(end)?{start,end}:composerSelection;}
  function setComposerSelection(input,start,end=start){if(!input)return;const model=composerDOM(input),range=document.createRange(),a=model.point(start),b=model.point(end);range.setStart(...a);range.setEnd(...b);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);composerSelection={start:model.offset(...a)??0,end:model.offset(...b)??model.text.length};}
  function readComposerText(input){return input?.isContentEditable||input?.hasAttribute('contenteditable')?composerDOM(input).text:input?.value||'';}
  function paintComposer(input,restoreSelection=false){if(!input)return;const html=richText(composeText,true);if(input.innerHTML!==html)input.innerHTML=html;if(restoreSelection)setComposerSelection(input,composerSelection.start,composerSelection.end);}
  function rememberComposerEdit(text=composeText,selection=composerSelection){if(route.name!=='chat')return;let history=composerHistories.get(route.arg);if(!history){history={undo:[],redo:[]};composerHistories.set(route.arg,history);}const previous=history.undo.at(-1);if(!previous||previous.text!==text)history.undo.push({text,selection:{...selection}});if(history.undo.length>100)history.undo.shift();history.redo.length=0;}
  function restoreComposerEdit(redo=false){if(composeComposing||sending)return;const history=composerHistories.get(route.arg),from=history?.[redo?'redo':'undo'],to=history?.[redo?'undo':'redo'];if(!from?.length)return;const next=from.pop();to.push({text:composeText,selection:{...composerSelection}});composeText=next.text;composerSelection={...next.selection};syncComposerDraft();}
  const roleById = id => state?.roles?.find(r => r.id === id);
  const roleName = r => r?.remark || r?.name || '联系人';
  function avatar(entity = {}, size = 48) {
    const name = String(entity.name || entity.remark || '我');
    return `<span class="avatar ${safeImage(entity.avatar)?'':'avatar-empty'}" style="--avatar-size:${Math.max(20,Math.min(100,Number(size)||48))}px">${safeImage(entity.avatar) ? `<img src="${esc(entity.avatar)}" alt="${esc(name)}的头像" loading="lazy">` : assetIcon('people-filled')}</span>`;
  }
  function toast(text, subtle = false) {
    clearTimeout(toastTimer);
    toastEl.textContent = String(text);
    toastEl.classList.toggle('toast-subtle', subtle);
    if (subtle) {
      const toolbar = modalOpen ? null : view.querySelector(':scope > .bottom-tabs, :scope > .chat-composer');
      toastEl.style.setProperty('--toast-lift', `${toolbar ? toolbar.offsetHeight + 12 : 0}px`);
    }
    toastEl.classList.add('visible');
    toastTimer = setTimeout(() => toastEl.classList.remove('visible'), subtle ? 1800 : 3200);
  }
  function setState(next) { if (next && typeof next === 'object') {if(state&&next.revision<state.revision)return;globalThis.window?.WaterdropChat?.observeState(state,next,view);trackNewChatMessages(state,next);state = next;globalThis.window?.PipiStickers?.syncDetail();syncVisibleChatRead();globalThis.window?.PipiEngine?.start();} }
  function receiveState(next) {
    if(!state||next.revision<=state.revision)return;
    setState(next);
    if(modalOpen||composeComposing||searchComposing){pendingRender=true;return;}
    const active=document.activeElement,input=view.querySelector('#compose-text');
    if(active&&active!==input&&(active.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))){pendingRender=true;return;}
    const focused=!!input&&active===input,anchor=captureChatLayout();
    if(input){composeText=readComposerText(input);composerSelection=readComposerSelection(input);composerScroll.input=input.scrollTop;}
    refresh();restoreChatLayout(anchor);
    if(focused){const nextInput=view.querySelector('#compose-text');if(nextInput){nextInput.focus({preventScroll:true});setComposerSelection(nextInput,composerSelection.start,composerSelection.end);}}
  }
  function updateTyping(roleId=route.arg,slow=false) {
    if(route.name!=='chat'||route.arg!==roleId)return;
    chatProgressSequence++;
    slowReplyRole=slow?roleId:'';
    const title=view.querySelector('[data-chat-title]'),status=view.querySelector('.chat-retry-status');
    if(title)title.textContent=window.PipiEngine?.isTyping(roleId)?'对方正在输入…':roleName(roleById(roleId));
    if(status)status.hidden=!slow;
    window.WaterdropChat?.updateTyping(view);
  }
  async function syncChatProgress(){
    if(route.name!=='chat'||!roleById(route.arg))return;
    const roleId=route.arg,sequence=++chatProgressSequence;
    try{
      const status=await api('/api/engine/chat-progress?roleId='+encodeURIComponent(roleId));
      if(sequence===chatProgressSequence)window.PipiEngine?.setChatProgress({...status,roleId});
    }catch(error){if(error.status!==401&&!error.stale)console.debug('查询聊天进度失败');}
  }
  async function cancelChatReply(button){
    const roleId=route.arg;button.disabled=true;
    try{
      const result=await api('/api/engine/chat-cancel',{roleId});
      if(result.state)receiveState(result.state);
      await syncChatProgress();
    }catch(error){if(button.isConnected)toast(error.message);}
    finally{button.disabled=false;}
  }
  function syncVisibleChatRead(){
    const roleId=route.name==='chat'&&!document.hidden?route.arg:null;
    if(!roleId||!roleById(roleId)?.unread||readRequests.has(roleId))return;
    readRequests.add(roleId);
    act('conversation.read',{roleId}).then(()=>{readRequests.delete(roleId);pendingRender=true;if(route.name!=='chat'&&!modalOpen&&!document.activeElement?.matches('input,textarea,select,[contenteditable]'))refresh();syncVisibleChatRead();}).catch(err=>{readRequests.delete(roleId);toast(err.message);});
  }
  async function api(path, body, method) {
    const requestEpoch=authEpoch,verb = method || (body === undefined ? 'GET' : 'POST');
    const headers={...(body!==undefined?{'Content-Type':'application/json'}:{}),...(verb!=='GET'&&csrf?{'X-CSRF-Token':csrf}:{})};
    if(path==='/api/engine/models')headers['X-Pipi-Model-Page']='card-save';
    const response = await fetch(path, {method:verb,credentials:'same-origin',headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
    let result; try { result = await response.json(); } catch { throw new Error('服务器返回了无法读取的响应，请稍后重试'); }
    if(requestEpoch!==authEpoch){const error=new Error('登录状态已变化，请重新操作');error.stale=true;throw error;}
    if (result.csrfToken) csrf = result.csrfToken;
    if (!response.ok) {
      if (result.state) setState(result.state);
      if (response.status === 401 && !['/api/login','/api/setup'].includes(path)) { csrf = ''; state = null; window.PipiEngine?.stop(); closeModal(false); renderAuth(false); }
      const error = new Error(result.error || `请求失败（${response.status}）`); error.status = response.status; error.state = result.state;
      error.code = result.code;
      if (result.code === 'PROVIDER_KEY_CHANGED') error.keyRevisions = result.keyRevisions;
      throw error;
    }
    return result;
  }
  async function apiRaw(path, body, contentType='application/octet-stream', method='POST') {
    const requestEpoch=authEpoch;
    const response = await fetch(path, {method,credentials:'same-origin',headers:{'Content-Type':contentType,...(csrf?{'X-CSRF-Token':csrf}:{})},body});
    let result; try { result = await response.json(); } catch { throw new Error('服务器返回了无法读取的响应，请稍后重试'); }
    if(requestEpoch!==authEpoch){const error=new Error('登录状态已变化，请重新操作');error.stale=true;throw error;}
    if (result.csrfToken) csrf = result.csrfToken;
    if (!response.ok) {
      if (result.state) setState(result.state);
      const error = new Error(result.error || `请求失败（${response.status}）`); error.status = response.status; throw error;
    }
    return result;
  }
  async function act(type, payload = {}) { const result = await api('/api/action',{type,payload}); if (result.state) setState(result.state); if(type==='sticker.add'){const images=payload.images||[payload.image];window.PipiStickers?.analyze(state.stickers.filter(s=>images.includes(s.image))).catch(error=>toast(error.message));}return result; }
  function trackModalHistory(nested=false){if((nested||!history.state?.overlay)&&!overlayBackPending)history.pushState({pipi:true,route:{...route},stack:[...navStack],overlay:true,overlayDepth:nested?(history.state?.overlayDepth||1)+1:1},'');}
  // A native dialog within a page owns one history entry, just like other
  // nested overlays. Back dismisses this layer before touching its parent.
  function openChildDialog(dialog){
    if(!modalOpen||overlayBackPending||childDialog||!dialog?.isConnected)return false;
    dialog.showModal();
    const entry={dialog,id:++childDialogSequence,controller:new AbortController()};childDialog=entry;
    history.pushState({...history.state,childDialog:entry.id},'');
    dialog.addEventListener('cancel',event=>{if(childDialog!==entry)return;event.preventDefault();closeChildDialog();},{signal:entry.controller.signal});
    dialog.addEventListener('close',()=>{if(childDialog===entry)closeChildDialog();},{signal:entry.controller.signal});
    return true;
  }
  function closeChildDialog(fromHistory=false){
    if(!childDialog)return false;
    const entry=childDialog;childDialog=null;entry.controller.abort();
    if(entry.dialog.open)entry.dialog.close();
    if(!fromHistory&&history.state?.childDialog===entry.id&&!overlayBackPending){overlayBackPending=true;history.back();}
    return true;
  }
  // Successful discard also consumes retained parent entries; Cancel restores
  // the parent's existing DOM and consumes only the top layer.
  function closeModal(notifyClose=true,fromHistory=false) {
    if(modalSaveInProgress&&notifyClose!==false){if(fromHistory)trackModalHistory();return;}
    const hadModal=modalOpen,callback=modalCloseCallback,childDepth=childDialog&&history.state?.childDialog===childDialog.id?1:0;closeChildDialog(true);modalCloseCallback=null;overlay.replaceChildren(); modalOpen = false; if(modalReturnFocus?.isConnected)modalReturnFocus.focus({preventScroll:true}); modalReturnFocus=null;if(hadModal&&!fromHistory&&history.state?.overlay){if(overlayBackPending)overlayCloseQueued=notifyClose===false?'all':true;else{overlayBackPending=true;const depth=(notifyClose===false?(history.state.overlayDepth||1):1)+childDepth;if(depth>1)history.go(-depth);else history.back();}}if(notifyClose!==false&&typeof callback==='function')callback();
  }
  function bindSheetBackdrop() {
    let pressedSheet=null;
    overlay.addEventListener('pointerdown',event=>{
      const sheets = window.ClassicSocial ? ':scope > :is(.model-sheet,.usage-sheet,.contact-remark-editor,.chat-background-editor)' : ':scope > :is(.model-sheet,.usage-sheet)';
      pressedSheet=event.target===overlay?overlay.querySelector(sheets):null;
    });
    overlay.addEventListener('pointercancel',()=>{pressedSheet=null;});
    overlay.addEventListener('click',event=>{
      const sheet=pressedSheet;
      pressedSheet=null;
      if(event.target===overlay&&sheet?.parentElement===overlay)closeModal();
    });
  }
  function openModal(title, html, onSubmit, submitLabel = '保存', onClose, navigation = 'cancel', {lockWhileSaving=false}={}) {
    modalCloseCallback=typeof onClose==='function'?onClose:null;
    modalReturnFocus=document.activeElement;modalOpen = true;
    trackModalHistory();
    const isPage = navigation === 'back';
    overlay.innerHTML = `<section class="modal-sheet page-editor" data-navigation="${isPage ? 'back' : 'cancel'}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><form class="modal-form"><div class="modal-header"><button type="button" class="modal-close${isPage ? ' modal-back' : ''}" data-close aria-label="${isPage ? '返回' : '取消'}">${isPage ? icons.back : '取消'}</button><h3>${esc(title)}</h3>${onSubmit ? `<button type="submit" class="primary-btn modal-submit">${esc(submitLabel)}</button>` : '<span></span>'}</div><div class="modal-body">${html}</div><div class="modal-error" role="alert"></div></form></section>`;
    overlay.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeModal));
    const form = overlay.querySelector('form');
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!onSubmit) return;
      const button = form.querySelector('[type=submit]'); if (button.disabled) return;
      const closeButton=lockWhileSaving?form.querySelector('[data-close]'):null;
      if(closeButton){modalSaveInProgress=true;closeButton.disabled=true;form.setAttribute('aria-busy','true');}
      button.disabled = true; const oldText = button.textContent; button.textContent = lockWhileSaving?'正在保存…':'请稍候…';const body=form.querySelector('.modal-body');if(body)body.inert=true;
      try { form.querySelector('.modal-error').textContent = ''; await onSubmit(form); }
      catch (err) { if (form.isConnected) form.querySelector('.modal-error').textContent = err.message; else toast(err.message); }
      finally {
        if(closeButton){modalSaveInProgress=false;closeButton.disabled=false;form.removeAttribute('aria-busy');}
        button.disabled = false; button.textContent = oldText;if(body)body.inert=false;
      }
    });
    // Some editors move their header controls after opening. Keep keyboard
    // focus in this sheet, including when an inactive parent remains underneath.
    const sheet = form.parentElement;
    sheet.tabIndex = -1;
    queueMicrotask(() => {
      if (sheet.parentElement !== overlay || sheet.contains(document.activeElement)) return;
      form.querySelector('[data-close]')?.focus({preventScroll:true});
      if (!sheet.contains(document.activeElement)) sheet.focus({preventScroll:true});
    });
  }
  // Pushed pages share the form shell, but their leading control means Back.
  // Keep openModal's Cancel default for composition and decision dialogs.
  function openPage(title, html, onSubmit, submitLabel, onClose) {
    return openModal(title, html, onSubmit, submitLabel, onClose, 'back');
  }
  function openNestedPage(title,html,onSubmit,submitLabel,onClose){
    const parent=captureModalParent();if(!parent)return openPage(title,html,onSubmit,submitLabel,onClose);
    openPage(title,html,onSubmit,submitLabel,()=>{restoreModalParent(parent);onClose?.();});trackModalHistory(true);mountModalParent(parent);
  }
  function captureModalParent(){return modalOpen&&overlay.querySelector('.modal-sheet')?{nodes:[...overlay.childNodes],focus:modalReturnFocus,active:document.activeElement,close:modalCloseCallback}:null;}
  function mountModalParent(parent){if(!parent)return;const underlay=document.createElement('div');underlay.className='modal-parent-underlay';underlay.style.cssText='position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center;pointer-events:none';underlay.inert=true;underlay.setAttribute('aria-hidden','true');underlay.append(...parent.nodes);overlay.prepend(underlay);}
  function restoreModalParent(parent){overlay.replaceChildren(...parent.nodes);modalOpen=true;modalReturnFocus=parent.focus;modalCloseCallback=parent.close;if(parent.active?.isConnected)parent.active.focus({preventScroll:true});else overlay.querySelector('button,input,textarea,select')?.focus({preventScroll:true});}
  function actionSheet(caption, actions) {
    const parent=captureModalParent();modalCloseCallback=parent?()=>restoreModalParent(parent):null;
    modalReturnFocus=document.activeElement;modalOpen = true;
    trackModalHistory(!!parent);
    overlay.innerHTML = `<div class="overlay-mask" data-close></div><div class="sheet-actions" role="dialog" aria-modal="true" aria-label="操作菜单">${caption ? `<div class="sheet-caption">${esc(caption)}</div>` : ''}${actions.map((a,i) => `<button class="sheet-action ${a.danger?'danger':''}" data-sheet="${i}">${a.icon || ''}${esc(a.label)}</button>`).join('')}<button class="sheet-action" data-close>取消</button></div>`;
    mountModalParent(parent);
    overlay.querySelectorAll(':scope > [data-close], :scope > .sheet-actions [data-close]').forEach(el => el.onclick = closeModal);
    queueMicrotask(()=>overlay.querySelector(':scope > .sheet-actions .sheet-action')?.focus({preventScroll:true}));
    overlay.querySelectorAll(':scope > .sheet-actions [data-sheet]').forEach(el => el.onclick = async () => { const action = actions[Number(el.dataset.sheet)]; closeModal(); await afterOverlayBack(); try { await action.run(); } catch (err) { toast(err.message); } });
  }
  function confirmDialog(title, description, callback, label = '确认') {
    const parent=captureModalParent();modalCloseCallback=parent?()=>restoreModalParent(parent):null;
    modalReturnFocus=document.activeElement;modalOpen=true;
    trackModalHistory(!!parent);
    overlay.innerHTML=`<div class="overlay-mask" data-close></div><section class="alert-dialog" role="alertdialog" aria-modal="true" aria-labelledby="alert-title" aria-describedby="alert-description"><h3 id="alert-title">${esc(title)}</h3><p id="alert-description">${esc(description)}</p><div class="modal-error" role="alert"></div><div class="alert-actions"><button data-close>取消</button><button class="danger modal-submit" id="alert-confirm">${esc(label)}</button></div></section>`;
    mountModalParent(parent);
    overlay.querySelectorAll(':scope > [data-close], :scope > .alert-dialog [data-close]').forEach(el=>el.onclick=closeModal);
    const button=overlay.querySelector(':scope > .alert-dialog #alert-confirm');button.onclick=async()=>{button.disabled=true;try{await callback(()=>button.isConnected);if(button.isConnected){closeModal(false);refresh();}}catch(err){if(button.isConnected){overlay.querySelector(':scope > .alert-dialog .modal-error').textContent=err.message;button.disabled=false;}else toast(err.message);}};
    overlay.querySelector(':scope > .alert-dialog .alert-actions [data-close]')?.focus({preventScroll:true});
  }
  function field(label, name, value = '', placeholder = '', type = 'text', help = '') {
    const attrs = `name="${esc(name)}" ${type==='password'?'autocomplete="new-password"':'autocomplete="off"'} placeholder="${esc(placeholder)}"${name==='wechatId'?' autocapitalize="none" spellcheck="false"':''}`;
    if(name==='wechatId')help='不支持中文';
    return `<label class="form-field"><span class="field-label">${esc(label)}</span>${type === 'textarea' ? `<textarea ${attrs} maxlength="20000">${esc(value)}</textarea>` : `<input type="${esc(type)}" ${attrs} value="${esc(value)}" ${type === 'number'?'step="1"':''}>`}${help ? `<span class="field-help">${esc(help)}</span>` : ''}</label>`;
  }
  function selectField(label, name, selected, options, help = '') {
    return `<label class="form-field"><span class="field-label">${esc(label)}</span><select name="${esc(name)}">${options.map(o => `<option value="${esc(o.value)}" ${o.value===selected?'selected':''}>${esc(o.label)}</option>`).join('')}</select>${help ? `<span class="field-help">${esc(help)}</span>` : ''}</label>`;
  }
  const formValues = form => Object.fromEntries(new FormData(form));
  function cell(title, icon, action, value = '', color = '', description = '') {
    return `<button class="cell list-item" data-action="${esc(action)}"><span class="cell-icon" style="color:${color || '#555'}">${icons[icon] || icons.services}</span><span class="cell-main"><span class="cell-body"><span class="cell-title">${esc(title)}</span>${description ? `<span class="cell-desc">${esc(description)}</span>` : ''}</span>${value ? `<span class="cell-value">${esc(value)}</span>` : ''}${icons.chevron}</span></button>`;
  }
  function header(title, {back = false, right = '', centered = true} = {}) {
    const otherUnread=route.name==='chat'?(state?.roles||[]).filter(r=>r.id!==route.arg).reduce((sum,r)=>sum+(Number(r.unread)||0),0):0;
    const chatProgress=route.name==='chat'&&!chatSelection;
    const heading=chatProgress?`<span data-chat-title>${esc(title)}</span><span class="chat-retry-status" ${slowReplyRole===route.arg?'':'hidden'}><span>网络较慢，正在重试…</span><button type="button" data-chat-cancel>取消</button></span>`:esc(title);
    return `<header class="topbar ${route.name==='moments'?'moments-topbar':''}"><div class="header-leading">${back ? `<button class="back-btn" data-action="back" aria-label="返回">${icons.back}${otherUnread?`<span class="chat-back-count">${otherUnread>99?'99+':otherUnread}</span>`:`<span>${back === true ? '' : esc(back)}</span>`}</button>` : ''}</div><h2 class="${centered?'title-centered':''}">${heading}</h2><div class="header-actions">${right}</div></header>`;
  }
  const iconButton = (icon, action, label) => `<button class="icon-btn" data-action="${esc(action)}" aria-label="${esc(label)}">${icons[icon] || ''}</button>`;
  function tabbar(active) {
    const unread = (state.roles || []).reduce((sum,r) => sum + (r.muted ? 0 : Number(r.unread)||0), 0);
    return `<nav class="bottom-tabs" aria-label="主要导航">${[['chats','chat','微信'],['contacts','contacts','通讯录'],['discover','discover','发现'],['me','me','我']].map(([name,icon,label]) => `<button class="tab ${active===name?'active':''}" data-nav="${name}" ${active===name?'aria-current="page"':''}>${name==='chats'?icons.chat:assetIcon(({contacts:'address-book',discover:'discover',me:'people'})[name]+(active===name?'-filled':'-outlined'))}${name==='chats'&&unread ? `<span class="tab-dot">${unread>99?'99+':unread}</span>`:''}<span class="tab-label">${label}</span></button>`).join('')}</nav>`;
  }
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let navigationAnimation,navigationCleanup;
  function startPageTransition(name,arg,fromBack){
    const primaryTabs=['chats','contacts','discover','me'];
    navigationAnimation?.cancel();
    navigationCleanup?.();
    view.classList.remove('navigation-entering');
    if(!view.dataset.route||view.dataset.route==='auth'||(route.name===name&&route.arg===arg)
      ||(!fromBack&&primaryTabs.includes(route.name)&&primaryTabs.includes(name)))return null;
    if(reduceMotion.matches||typeof view.animate!=='function')return null;
    const selector='.content,.chat-messages,.emoji-scroll';
    const scrolls=[...view.querySelectorAll(selector)].map(element=>({top:element.scrollTop,left:element.scrollLeft}));
    let conversationHeights;
    if(view.dataset.route==='chats'&&'contentVisibility' in view.style&&'containIntrinsicBlockSize' in view.style){
      const rows=view.querySelectorAll('.conversation-wrap:not([hidden])');
      if(rows.length){
        const {top,bottom}=view.querySelector('.content').getBoundingClientRect();
        conversationHeights=[...rows].map(row=>{
          const rect=row.getBoundingClientRect();
          return rect.height&&(rect.bottom<top-128||rect.top>bottom+128)?rect.height:0;
        });
      }
    }
    const snapshot=view.cloneNode(true);
    snapshot.removeAttribute('id');
    snapshot.removeAttribute('aria-live');
    snapshot.setAttribute('aria-hidden','true');
    snapshot.inert=true;
    snapshot.classList.add('navigation-snapshot');
    snapshot.querySelectorAll('[id]').forEach(element=>element.removeAttribute('id'));
    const snapshotScrolls=snapshot.querySelectorAll(selector);
    // Only the inert home snapshot skips offscreen row contents. Preserve
    // measured row heights and a blur margin so its scroll and paint stay fixed.
    if(conversationHeights)snapshot.querySelectorAll('.conversation-wrap:not([hidden])').forEach((row,index)=>{
      const height=conversationHeights[index];
      if(height){row.style.contentVisibility='hidden';row.style.containIntrinsicBlockSize=height+'px';}
    });
    view.after(snapshot);
    if(!fromBack)view.classList.add('navigation-entering');
    return ()=>{
      // Read the old page before DOM writes, then restore the snapshot after
      // the new page is built. No read/write interleaving or extra initial layout.
      snapshotScrolls.forEach((element,index)=>{
        const {top,left}=scrolls[index];
        if(top)element.scrollTop=top;
        if(left)element.scrollLeft=left;
      });
      const moving=fromBack?snapshot:view;
      const animation=moving.animate(fromBack
        ?[{transform:'translateX(0)'},{transform:'translateX(100%)'}]
        :[{transform:'translateX(100%)'},{transform:'translateX(0)'}],
      {duration:250,easing:'cubic-bezier(.22,.61,.36,1)'});
      navigationAnimation=animation;
      const cleanup=()=>{
        snapshot.remove();
        if(navigationAnimation===animation){navigationAnimation=null;navigationCleanup=null;view.classList.remove('navigation-entering');}
      };
      navigationCleanup=cleanup;
      animation.onfinish=cleanup;
      animation.oncancel=cleanup;
    };
  }
  function showView(name, arg, fromBack=false) {
    if(modalSaveInProgress)return;
    if(name==='sticker-store')name='stickers';
    if(overlayBackPending){queuedView={name,arg,fromBack};return;}
    if(chatSelection&&(name!=='chat'||(arg?.roleId||arg?.id||arg)!==chatSelection.roleId)){finishMessageSelection();if(overlayBackPending){queuedView={name,arg,fromBack};return;}}
    if(modalOpen&&history.state?.overlay&&!fromBack){closeModal(false);queuedView={name,arg,fromBack};return;}
    resetComposerPointerState();
    composerPanelFrom=null;
    if(composeComposing){const input=view.querySelector('#compose-text');if(input)composeText=readComposerText(input);composeComposing=false;deferredComposerUpdate=false;}
    searchComposing=false;
    if (recordingSession) stopRecording(true);
    closeModal(false);
    if(route.name==='chat'){
      const input=view.querySelector('#compose-text'),emoji=view.querySelector('.emoji-scroll');
      if(input){composeText=readComposerText(input);composerSelection=readComposerSelection(input);composerScroll.input=input.scrollTop;}
      if(emoji)composerScroll.emoji=emoji.scrollTop;
      drafts.set(route.arg,{text:composeText,image:composeImage,stickerId:composeStickerId,quote:quoteId,panel,selection:{...composerSelection},scroll:{...composerScroll},morePage,emojiPage,emojiTab,emojiSearch,emojiExpandedHeight});
      const list=view.querySelector('#chat-messages');if(list)chatScrolls.set(route.arg,list.scrollTop);
    }
    if(route.name==='chats')chatsReturn=view.querySelector('.content')?.scrollTop||0;
    if(route.name==='contacts'){const content=view.querySelector('.content.contacts');contactsReturn={top:content?.scrollTop||0,term:searchTerm};}
    if(route.name==='settings'){
      route.scrollTop=view.querySelector('.settings-content')?.scrollTop||0;
      if(!fromBack)history.replaceState({...history.state,route:{...route}},'');
    }
    if(route.name==='moments'&&!fromBack){
      const content=view.querySelector('.moments-content');
      if(content)history.replaceState({...history.state,route:{...route,momentsPosition:capturePagePosition(content)}},'');
    }
    const nextArg=['chat','role','memories','role-memories','role-schedule','role-references','chat-info','role-config','contact-settings','contact-more','contact-permissions','chat-search'].includes(name)?(arg?.roleId||arg?.id||arg):arg;
    if(route.name!==name||route.arg!==nextArg){
      newChatMessageIds.clear();stopSpeech();
      slowReplyRole='';chatProgressSequence++;
    }
    const playTransition=startPageTransition(name,nextArg,fromBack);
    if(name==='chat'&&!fromBack&&arg?.scroll==='bottom')forceBottomRole=nextArg;
    if(!fromBack){if(['chats','contacts','discover','me'].includes(name))navStack.length=0;else if(route.name!==name||route.arg!==nextArg)navStack.push({...route});}
    if(name!=='chat'||route.name!=='chat'||route.arg!==nextArg){
      const draft=name==='chat'?drafts.get(nextArg):null;
      composeText=draft?.text||'';composeImage=draft?.image||'';composeStickerId=draft?.stickerId||'';quoteId=draft?.quote||'';
      composerSelection=draft?.selection?{...draft.selection}:{start:composeText.length,end:composeText.length};composerScroll=draft?.scroll?{...draft.scroll}:{input:0,emoji:0};
      const returningFromPayment=fromBack&&route.name==='wallet'&&route.arg?.roleId===nextArg&&['transfer','redpacket'].includes(route.arg?.mode);
      panel=draft?.panel==='voice'?'voice':returningFromPayment&&draft?.panel==='more'?'more':'';morePage=draft?.morePage||0;emojiPage=draft?.emojiPage||0;emojiTab=draft?.emojiTab||'all';emojiSearch=draft?.emojiSearch||'';emojiExpandedHeight=draft?.emojiExpandedHeight||0;
    }
    route = {name,arg:nextArg,...(name==='settings'&&fromBack?{scrollTop:history.state?.route?.scrollTop||0}:{})};
    if(!fromBack&&['chats','contacts','discover','me'].includes(name))globalSearchTerm='';
    if(!fromBack)history.pushState({pipi:true,route:{...route},stack:[...navStack]},'');
    searchOpen = false; searchTerm = name==='contacts'&&fromBack?contactsReturn?.term||'':'';if(name==='contacts'&&!fromBack&&contactsReturn?.term)contactsReturn=null;
    const momentsPosition=name==='moments'&&fromBack?history.state?.route?.momentsPosition:null;
    refresh({resetScroll:Boolean(momentsPosition)});
    if(momentsPosition)restorePagePosition(view.querySelector('.moments-content'),momentsPosition);
    playTransition?.();
    if(name==='chat'){syncVisibleChatRead();syncChatProgress();}
  }
  // A long-press menu opens while the finger is still down. The release must not
  // count as a tap on the backdrop, otherwise the menu closes the moment it appears.
  let pressActive=false;
  document.addEventListener('touchstart',()=>{},{passive:true});
  window.addEventListener('pointerdown',()=>{pressActive=true;},true);
  for(const name of ['pointerup','pointercancel'])window.addEventListener(name,()=>{pressActive=false;},true);
  function holdMenuUntilRelease(){
    const backdrop=overlay.querySelector('.menu-dismiss,[data-close]');if(!backdrop)return;
    backdrop.style.pointerEvents='none';
    const release=()=>{window.removeEventListener('pointerup',release,true);window.removeEventListener('pointercancel',release,true);setTimeout(()=>{backdrop.style.pointerEvents='';},350);};
    window.addEventListener('pointerup',release,true);window.addEventListener('pointercancel',release,true);
  }
  function goBack(){if(overlayBackPending){queuedBack=true;return;}if(childDialog){closeChildDialog();return;}if(modalOpen){closeModal();return;}if(window.PipiFeatures?.handleBack?.('button'))return;if(chatSelection){finishMessageSelection();return;}if(navStack.length){history.back();}else showView('chats',undefined,true);}
  function refresh({resetScroll=false}={}) {
    const pageKey=JSON.stringify([route.name,route.arg]);
    const preserve=!resetScroll&&!['chat','contacts','settings','role-config','life-workbench'].includes(route.name)&&view.dataset.pageKey===pageKey;
    const content=preserve?view.querySelector('.content'):null;
    const position=content?capturePagePosition(content):null;
    renderView();
    view.dataset.pageKey=JSON.stringify([route.name,route.arg]);
    if(position&&view.dataset.pageKey===pageKey)restorePagePosition(view.querySelector('.content'),position);
  }
  function capturePagePosition(content){
    const position={top:content.scrollTop,left:content.scrollLeft,details:[...content.querySelectorAll('details.engine-details,details.model-context-details')].map(node=>node.open)};
    const caption=content.querySelector('.caption-prompt-details');if(caption)position.captionOpen=caption.open;
    if(route.name==='moments')position.expandedMoments=window.PipiFeatures.captureMomentExpansion(content);
    return position;
  }
  function restorePagePosition(content,position){
    if(!content||!position)return;
    content.querySelectorAll('details.engine-details,details.model-context-details').forEach((node,index)=>{if(index<position.details.length)node.open=position.details[index];});
    const caption=content.querySelector('.caption-prompt-details');if(caption)caption.open=position.captionOpen===true;
    if(position.expandedMoments)window.PipiFeatures.restoreMomentExpansion(content,position.expandedMoments);
    content.scrollTop=position.top;
    content.scrollLeft=position.left;
  }
  function saveBrowserPosition(){
    if(!state||view.dataset.route!==route.name)return;
    const content=view.querySelector(route.name==='chat'?'#chat-messages':'.content');
    if(!content)return;
    const position=capturePagePosition(content);
    if(route.name==='chat'&&chatNearBottom(content))position.bottom=true;
    if(route.name==='providers'){
      position.modelCategory=window.PipiModels.getCategory();
      position.modelProvider=window.PipiModels.getExpanded();
      position.modelAdvanced=content.querySelector('.inline-provider-options')?.open;
    }
    if(route.name==='engine-usage')position.usage=window.PipiUsage.getView();
    sessionStorage.setItem(browserPositionKey,JSON.stringify({route:[route.name,route.arg],position,modelDrafts:window.PipiModels?.captureDrafts()}));
  }
  async function restoreBrowserPage(){
    const saved=sessionStorage.getItem(browserPositionKey);
    sessionStorage.removeItem(browserPositionKey);
    const snapshot=saved?JSON.parse(saved):null;
    const position=restoredPage&&JSON.stringify(snapshot?.route)===JSON.stringify([route.name,route.arg])?snapshot.position:null;
    if(snapshot?.modelDrafts)window.PipiModels?.restoreDrafts(snapshot.modelDrafts);
    if(['engine-home','providers','engine-functions','engine-module'].includes(route.name))await window.PipiEngine.refreshConfig();
    if(route.name==='providers'&&position?.modelCategory)window.PipiModels.restoreCategory(position.modelCategory,position.modelProvider);
    if(route.name==='engine-usage')await window.PipiUsage.restoreView(position?.usage);
    if(position&&route.name==='chat'&&!position.bottom)chatScrolls.set(route.arg,position.top);
    refresh();
    if(route.name==='providers'&&position?.modelAdvanced){const details=view.querySelector('.inline-provider-options');if(details)details.open=true;}
    if(position&&route.name===restoredPage.route.name&&route.name!=='chat'&&route.name!=='role-config'){
      restorePagePosition(view.querySelector('.content'),position);
    }
  }
  function renderView() {
    if (!state) return;
    if(route.name==='chat'&&view.dataset.route==='chat'&&composerPointerBusy()){pointerViewRefreshPending=true;pendingRender=true;return;}
    if(recordingSession?.mode==='hold'){pendingRender=true;return;}
    if(searchComposing||(route.name==='chat'&&composeComposing&&view.dataset.route==='chat')){pendingRender=true;return;}
    window.PipiFeatures?.cleanup?.();
    const previousContacts=route.name==='contacts'&&view.dataset.route==='contacts'?view.querySelector('.content.contacts'):null;
    if(previousContacts)contactsReturn={top:view.dataset.contactsTerm===searchTerm?previousContacts.scrollTop:0,term:searchTerm};
    if(route.name==='settings'&&view.dataset.route==='settings')route.scrollTop=view.querySelector('.settings-content').scrollTop;
    const previousChat=view.querySelector('#chat-messages');
    if(previousChat&&view.dataset.chatRole===route.arg&&route.name==='chat'&&forceBottomRole!==route.arg){if(previousChat.scrollHeight-previousChat.scrollTop-previousChat.clientHeight<100)chatScrolls.delete(route.arg);else chatScrolls.set(route.arg,previousChat.scrollTop);}
    pendingRender = false;
    const name = route.name;
    view.dataset.route = name;
    view.dataset.contactsTerm=name==='contacts'?searchTerm:'';
    view.dataset.chatRole=name==='chat'?route.arg:'';
    const personaPage=window.PipiPersonas?.render(name,route.arg);
    if(personaPage!==null&&personaPage!==undefined){view.innerHTML=personaPage;bindMain();window.PipiPersonas.bind(name,route.arg);return;}
    const enginePage=window.PipiEngine?.render(name,route.arg);
    if(enginePage!==null&&enginePage!==undefined){view.innerHTML=enginePage;bindMain();window.PipiEngine.bind(name,route.arg);return;}
    if (featureNames.has(name)) {
      const titles = {moments:'朋友圈','moment-album':'相册',ledger:'记账本',wallet:'钱包',farm:'小农场',favorites:'收藏',services:'服务'};
      view.innerHTML = header(titles[name],{back:true,right:name==='moments'&&(!route.arg?.roleId||route.arg?.roleId==='me')?iconButton('camera','compose-moment','发表朋友圈'):name==='wallet'?'<button class="nav-text" data-action="wallet-bills">账单</button>':''}) + `<div class="content page-content feature-content ${name==='moments'?'moments-content':''}">${window.PipiFeatures?.render(name,route.arg) || '<div class="empty">这个页面暂未开放</div>'}</div>`;
      window.PipiFeatures?.bind(name,route.arg); bindMain(); return;
    }
    if (routes.has(name)) { view.innerHTML=routes.get(name)(route.arg); bindMain(); return; }
    if(name==='contact-more'){view.innerHTML=renderContactMore();bindMain();return;}
    if(['stickers','contact-tags','tag-contacts'].includes(name)){view.innerHTML=name==='stickers'?renderStickers():renderContactTags();bindMain();return;}
    const renderers = {chats:renderChats,'global-search':renderGlobalSearch,contacts:renderContacts,discover:renderDiscover,me:renderMe,skins:renderSkins,chat:renderChat,role:renderRole,settings:renderSettings,memories:renderMemories,profile:renderProfile,about:renderAbout,backup:renderBackup,'chat-info':renderChatInfo,'role-config':renderRoleConfig,'contact-settings':renderContactSettings,'contact-permissions':renderContactPermissions,blacklist:renderBlacklist,'chat-search':renderChatSearch,'new-friends':renderNewFriends,'add-friend':renderAddFriend,'profile-more':renderProfileMore,'status':renderStatus,'status-history':renderStatusHistory,'status-picker':renderStatusPicker,'status-editor':renderStatusEditor};
    if (!renderers[name]) { route = {name:'chats',arg:null}; }
    view.innerHTML = (renderers[route.name] || renderChats)(); bindMain();
    if (route.name === 'chat') { bindChat(); scrollChat(focusMessageId); }
    if (route.name === 'chats' || route.name==='contacts') bindConversations();
    if(route.name==='chats')view.querySelector('.content').scrollTop=chatsReturn;
    if(route.name==='contacts'&&contactsReturn&&searchTerm===contactsReturn.term)view.querySelector('.content.contacts').scrollTop=contactsReturn.top;
    if(route.name==='settings'){
      view.querySelector('.settings-content').scrollTop=route.scrollTop||0;
      if(globalThis.__pipiUpdatesEnabled)window.PipiUpdates?.bindSettings(view);
    }
    if(route.name==='about'&&globalThis.__pipiUpdatesEnabled)window.PipiUpdates?.bindAbout(view);
  }
  const clockFormat=new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  function shortTime(value, inChat = false) {
    const date = new Date(value); if (!Number.isFinite(date.getTime())) return '';
    const today = new Date(), age = Math.floor((new Date(today.getFullYear(),today.getMonth(),today.getDate()) - new Date(date.getFullYear(),date.getMonth(),date.getDate())) / 86400000);
    const clock = clockFormat.format(date), weekday = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][date.getDay()];
    if (age===0) return clock;
    if (age===1) return '昨天 '+clock;
    if (age<7) return inChat ? weekday+' '+clock : weekday;
    return inChat ? `${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日 ${clock}` : `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()}`;
  }
  function preview(message) {
    if (!message) return '点击开始聊天';
    const text = ({image:'[图片]',voice:'[语音]',forward:'[聊天记录]',transfer:'[转账]',redpacket:'[红包]'})[message.type] || String(message.content || '');
    return text;
  }
  function renderChats() {
    const unread=(state.roles||[]).reduce((sum,r)=>sum+(r.muted?0:Number(r.unread)||0),0);
    const lastMessages=new Map();
    for(const message of state.messages)lastMessages.set(message.roleId,message);
    const visible = (state.roles||[]).filter(r=>!r.hidden).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned) || new Date(lastMessages.get(b.id)?.createdAt || 0)-new Date(lastMessages.get(a.id)?.createdAt || 0));
    return header(unread?`微信 (${unread>99?'99+':unread})`:'微信', {right:iconButton('plus','new-menu','添加')}) + `<div class="search-bar"><button class="search-input-wrap search-entry" data-action="global-search" aria-label="搜索联系人与消息">${icons.search}<span>搜索</span></button></div><div class="content"><div class="conversation-list">${visible.map(r=>{
      const msg=lastMessages.get(r.id); return `<div class="conversation-wrap"><div class="conversation-actions"><button class="unread-action" data-conv="${r.unread?'read':'unread'}" data-role="${esc(r.id)}">${r.unread?'标为已读':'标为未读'}</button><button class="hide-action" data-conv="hide" data-role="${esc(r.id)}">不显示</button><button class="delete-action" data-conv="delete" data-role="${esc(r.id)}">删除</button></div><button class="conversation ${r.pinned?'pinned':''}" data-role="${esc(r.id)}" data-open-chat="${esc(r.id)}"><span class="conversation-avatar">${avatar(r,48)}${r.unread?(r.muted?'<span class="unread-dot"></span>':`<span class="unread-badge">${r.unread>99?'99+':r.unread}</span>`):''}</span><span class="conversation-copy"><span class="conversation-line"><span class="conversation-name">${esc(roleName(r))}</span><time class="conversation-time">${esc(shortTime(msg?.createdAt))}</time></span><span class="conversation-preview">${msg?.status==='error'?'<span class="failed">!</span>':''}${r.muted&&r.unread>1?'['+r.unread+'条] ':''}${esc(preview(msg))}</span></span>${r.muted?assetIcon('muted',false,'conversation-muted'):''}</button></div>`;
    }).join('') || `<div class="empty"><h3>暂无聊天</h3><p>创建朋友后，就可以开始聊天。</p><button class="primary-btn" data-action="add-role">创建新朋友</button></div>`}</div></div>${tabbar('chats')}`;
  }
  function renderGlobalSearch() {
    const term=globalSearchTerm.trim().toLowerCase();
    const contacts=term?(state.roles||[]).filter(r=>`${roleName(r)} ${r.name} ${r.wechatId||''}`.toLowerCase().includes(term)):[];
    const messages=term?(state.messages||[]).filter(m=>roleById(m.roleId)&&String(m.type==='image'?'[图片]':m.meta?.transcript||m.content).toLowerCase().includes(term)).slice().reverse():[];
    return `<div class="search-bar global-search-bar"><label class="search-input-wrap">${icons.search}<input id="list-search" type="search" placeholder="搜索" value="${esc(globalSearchTerm)}" aria-label="搜索联系人与全部聊天记录">${globalSearchTerm?'<button type="button" class="search-clear" data-action="clear-list-search" aria-label="清除搜索">×</button>':''}</label><button class="nav-text" data-action="cancel-global-search">取消</button></div><div class="content global-search-results">${term?`<h3>联系人</h3><section class="section">${contacts.map(r=>`<button class="cell" data-nav="role" data-arg="${esc(r.id)}">${avatar(r,40)}<span class="cell-body cell-title">${esc(roleName(r))}</span></button>`).join('')||'<p class="search-empty">没有找到联系人</p>'}</section><h3>聊天记录</h3><section class="section">${messages.map(m=>{const r=roleById(m.roleId);return `<button class="search-result" data-global-message="${esc(m.id)}" data-search-role="${esc(r.id)}">${avatar(m.sender==='user'?state.profile:r,40)}<span><b>${esc(roleName(r))}</b><p>${richText(preview(m))}</p><time>${esc(shortTime(m.createdAt))}</time></span></button>`;}).join('')||'<p class="search-empty">没有找到聊天记录</p>'}</section>`:'<p class="search-empty">搜索联系人与聊天记录</p>'}</div>`;
  }
  function contactInitial(name) {
    const first=Array.from(String(name||''))[0]||'';
    if(/^[a-z]$/i.test(first))return first.toUpperCase();
    if(!/^[\u3400-\u9fff]$/.test(first))return '#';
    const bounds=[['A','阿'],['B','芭'],['C','擦'],['D','搭'],['E','蛾'],['F','发'],['G','噶'],['H','哈'],['J','击'],['K','喀'],['L','垃'],['M','妈'],['N','拿'],['O','哦'],['P','啪'],['Q','期'],['R','然'],['S','撒'],['T','塌'],['W','挖'],['X','昔'],['Y','压'],['Z','匝']];
    let group='A';for(const [letter,char] of bounds){if(first.localeCompare(char,'zh-CN-u-co-pinyin')>=0)group=letter;else break;}return group;
  }
  function renderContacts() {
    const contacts=(state.roles||[]).filter(r=>!searchTerm||`${r.name} ${r.remark||''}`.toLowerCase().includes(searchTerm.toLowerCase())).sort((a,b)=>{const letters='ABCDEFGHIJKLMNOPQRSTUVWXYZ#',group=letters.indexOf(contactInitial(roleName(a)))-letters.indexOf(contactInitial(roleName(b)));return group||roleName(a).localeCompare(roleName(b),'zh-CN-u-co-pinyin',{numeric:true});});
    const ordered=searchTerm?contacts:[...contacts.filter(r=>r.starred),...contacts.filter(r=>!r.starred)];
    let previous='';const rows=ordered.map(r=>{const letter=!searchTerm&&r.starred?'star':contactInitial(roleName(r));const group=letter!==previous?`<div class="contacts-index" id="contact-group-${letter}">${letter==='star'?'星标朋友':letter}</div>`:'';previous=letter;return group+`<button class="cell" data-nav="role" data-arg="${esc(r.id)}">${avatar(r,40)}<span class="cell-body"><span class="cell-title">${esc(roleName(r))}</span></span></button>`;}).join('');
    const tools=[['新的朋友','addFriend','new-friends','#fa9d3b'],['群聊','group','coming-group','#07c160'],['标签','tag','contact-tags','#2782d7'],['公众号','book','coming-official','#2782d7'],['服务号','services','coming-service-account','#2782d7']];
    const groups=[...new Set(ordered.map(r=>!searchTerm&&r.starred?'star':contactInitial(roleName(r))))];
    const rail=!searchTerm&&groups.length?'<nav class="contact-index-rail" aria-label="通讯录字母索引"><button type="button" data-contact-index="top" aria-label="通讯录顶部">↑</button>'+groups.map(letter=>'<button type="button" data-contact-index="'+letter+'" aria-label="跳到'+(letter==='star'?'星标朋友':letter)+'">'+(letter==='star'?'★':letter)+'</button>').join('')+'</nav>':'';
    return header('通讯录',{right:iconButton('addFriend','add-friend','添加朋友')})+`<div class="search-bar"><label class="search-input-wrap">${icons.search}<input id="list-search" type="search" value="${esc(searchTerm)}" placeholder="搜索" aria-label="搜索联系人">${searchTerm?'<button type="button" class="search-clear" data-action="clear-list-search" aria-label="清除搜索">×</button>':''}</label></div><div class="content contacts">${!searchTerm?tools.map(([title,icon,action,color])=>`<button class="cell" data-action="${action}"><span class="contact-tool" style="background:${color}">${icons[icon]}</span><span class="cell-body"><span class="cell-title">${title}</span></span></button>`).join(''):''}${rows}<div class="contacts-count">${contacts.length}个朋友</div></div>${rail}${tabbar('contacts')}`;
  }
  function renderDiscover() {
    const unreadMoments=(state.momentNotifications||[]).some(n=>{const p=roleById(n.actorId)?.permissions||{};return !n.read&&!p.blocked&&!p.onlyChat&&!p.hideTheirMoments;});
    const momentsCell=unreadMoments?cell('朋友圈','moments','moments').replace('</span><span class="cell-main">','<span class="discover-dot" aria-hidden="true"></span></span><span class="cell-main">'):cell('朋友圈','moments','moments');
    return header('发现')+`<div class="content discover"><section class="section">${momentsCell}</section><section class="section">${cell('小农场','farm','farm')}${cell('功能','settings','engine-functions','','#1485e5')}</section><section class="section">${cell('扫一扫','scan','coming-scan','','#1485e5')}${cell('听一听','music','coming-listen','','#fa5151')}</section><section class="section">${cell('看一看','book','coming-news','','#f3ac32')}${cell('搜一搜','search','coming-search','','#fa5151')}</section><section class="section">${cell('附近','nearby','coming-nearby','','#1485e5')}</section><section class="section">${cell('购物','shopping','coming-shopping','','#fa5151')}${cell('游戏','games','coming-games')}</section><section class="section">${cell('小程序','miniProgram','coming-mini','','#7d7eea')}</section></div>${tabbar('discover')}`;
  }
  function renderSkins() {
    const current = document.documentElement.dataset.skin;
    const options = window.PipiSkins.installed.map(({id, name, wallpaper}) => `
      <label class="skin-option">
        <input type="radio" name="appearance-skin" value="${esc(id)}" aria-label="${esc(name)}" ${wallpaper ? `aria-describedby="skin-wallpaper-${esc(id)}"` : ''} ${id === current ? 'checked' : ''}>
        <span class="skin-sample" data-preview-skin="${esc(id)}" aria-hidden="true">
          <span class="skin-sample-row"><span class="skin-sample-avatar">${icons.me}</span><span class="skin-sample-bubble">早上好！</span></span>
          <span class="skin-sample-row outgoing"><span class="skin-sample-avatar">${icons.me}</span><span class="skin-sample-bubble">早呀</span></span>
        </span>
        <span class="skin-option-caption"><span class="skin-option-title"><span class="skin-option-name">${esc(name)}</span>${wallpaper ? `<span id="skin-wallpaper-${esc(id)}" class="skin-option-wallpaper">聊天壁纸 · ${esc(wallpaper)}</span>` : ''}</span>
          <span class="skin-option-state" aria-hidden="true">${icons.check}使用中</span>
        </span>
      </label>`).join('');
    return header('皮肤', {back:true}) + `<div class="content skin-picker" role="radiogroup" aria-label="选择皮肤">${options}</div>`;
  }
  function renderMe() {
    const profile=state.profile||{};
    const current=activeStatus(),choice=statusChoice(current?.preset);
    return `<div class="content me-content"><div class="me-topspace"></div><div class="me-profile-block"><button class="profile-card" data-nav="profile" style="width:100%;text-align:left">${avatar(profile,64)}<span class="profile-copy"><h3>${esc(profile.name||'我')}</h3><p>微信号：${esc(profile.wechatId||'未设置')}</p></span><span class="profile-qr">${icons.qrcode}</span>${icons.chevron}</button><div class="me-status-row"><button class="me-status-button ${current?'has-status':''}" data-action="open-status" aria-label="${current?'查看我的状态':'设置状态'}">${current?icons[choice[2]]:'<span class="status-plus" aria-hidden="true">＋</span>'}<span>${current?esc(choice[1]):'状态'}</span>${current?icons.chevron:''}</button><button class="me-status-friends" data-action="coming-friend-status" aria-label="朋友的状态"></button>${current?.description?`<span class="me-status-description">${esc(current.description)}</span>`:''}</div></div><section class="section">${cell('服务','services','services','','#07a865')}</section><section class="section">${cell('收藏','meFavorites','favorites')}${cell('朋友圈','meAlbum','my-moments')}${cell('我的人设','mePersona','role-personas')}${cell('皮肤','skin','skins','','#1485ee')}${cell('表情','smile','manage-stickers','','#f3ac32')}</section><section class="section">${cell('设置','settings','settings','','#1485e5')}</section></div>${tabbar('me')}`;
  }
  function statusChoice(preset){return statusChoices.find(choice=>choice[0]===preset)||statusChoices.at(-1);}
  function activeStatus(){
    const current=state.profile?.status;
    clearTimeout(statusExpiryTimer);
    if(!current||current.expiresAt<=Date.now())return null;
    statusExpiryTimer=setTimeout(()=>{if(state&&['me','status'].includes(route.name))refresh();},Math.max(1,current.expiresAt-Date.now()+30));
    return current;
  }
  function renderStatus(){
    const current=activeStatus(),choice=statusChoice(current?.preset);
    return header('我的状态',{back:true})+`<div class="content page-content status-page"><section class="status-current">${avatar(state.profile,64)}<p class="status-owner">${esc(state.profile?.name||'我')}</p>${current?`<h3>${icons[choice[2]]}<span>${esc(choice[1])}</span></h3>${current.description?`<p class="status-description">${esc(current.description)}</p>`:''}<p class="status-validity">24小时内有效</p>`:'<p class="status-ended">当前没有状态</p>'}</section><section class="section">${plainCell(current?'修改状态':'设个状态','edit-status')}${plainCell('历史状态','status-history')}${current?'<button class="cell centered-cell danger" data-action="end-status">结束状态</button>':''}</section></div>`;
  }
  function renderStatusHistory(){
    const history=(state.statusHistory||[]).slice().sort((a,b)=>b.startedAt-a.startedAt);
    return header('历史状态',{back:true})+`<div class="content page-content"><section class="section">${history.map(item=>{const choice=statusChoice(item.preset);return `<button class="cell status-history-row" data-status-history="${esc(item.id)}"><span class="status-history-icon">${icons[choice[2]]}</span><span class="cell-body"><span class="cell-title">${esc(choice[1])}</span><span class="cell-desc">${esc(item.description||'未填写说明')}</span><time>${esc(new Date(item.startedAt).toLocaleString('zh-CN',{hour12:false}))}</time></span>${icons.chevron}</button>`;}).join('')}</section>${!history.length?'<div class="empty">暂无历史状态</div>':''}</div>`;
  }
  function renderStatusEditor(){
    if(!statusDraft){const current=activeStatus();statusDraft={preset:current?.preset||'',description:current?.description||''};}
    const choice=statusChoice(statusDraft.preset),theme=statusThemes[choice[0]];
    return `<div class="status-editor-surface" style="--status-theme:${theme}"><header class="status-editor-header"><button data-action="cancel-status" class="status-dismiss" aria-label="取消设置状态" ${statusSaving?'disabled':''}>${icons.close}</button></header><div class="content status-editor"><form id="status-form"><input type="hidden" name="preset" value="${esc(statusDraft.preset)}"><button type="button" class="status-selected" data-action="choose-status">${icons[choice[2]]}<span>${esc(choice[1])}</span>${icons.chevron}</button><label class="status-description-field"><span class="sr-only">说点什么</span><textarea name="description" rows="3" maxlength="120" placeholder="这一刻的想法…" aria-describedby="status-length status-note">${esc(statusDraft.description)}</textarea></label><p id="status-length" class="status-length">${[...statusDraft.description].length}/60</p><div class="status-error" role="alert"></div><footer class="status-editor-footer"><p id="status-note" class="status-note">24小时内有效<br>仅在这部小手机中展示</p><button type="submit" class="status-save" ${statusSaving?'disabled':''}>就这样</button></footer></form></div></div>`;
  }
  function renderStatusPicker(){
    return `<div class="status-picker-surface"><header class="status-picker-header"><button class="status-dismiss" data-action="cancel-status" aria-label="取消设置状态">${icons.close}</button><h2>我的状态</h2><button class="status-history-entry" data-action="status-history">历史</button></header><div class="content status-picker">${statusGroups.map(([name,presets])=>`<section class="status-group" aria-label="${esc(name)}"><h3>${esc(name)}</h3><div class="status-grid">${presets.map(preset=>{const choice=statusChoice(preset);return `<button type="button" class="status-tile" data-status-preset="${preset}" aria-label="${esc(choice[1])}">${icons[choice[2]]}<span>${esc(choice[1])}</span></button>`;}).join('')}</div></section>`).join('')}</div></div>`;
  }
  function bindStatusEditor(){
    const form=view.querySelector('#status-form');if(!form)return;
    form.inert=statusSaving;const description=form.elements.description,error=form.querySelector('.status-error');
    const capture=()=>{statusDraft={preset:form.elements.preset.value,description:description.value};form.querySelector('#status-length').textContent=[...description.value].length+'/60';if(error.dataset.kind==='length'&&[...description.value.trim()].length<=60){error.textContent='';delete error.dataset.kind;}};
    form.oninput=capture;form.onchange=capture;
    form.onsubmit=async event=>{
      event.preventDefault();if(statusSaving)return;capture();error.textContent='';delete error.dataset.kind;
      if(!statusDraft.preset){error.textContent='请先选择一个状态';return;}
      if([...statusDraft.description.trim()].length>60){error.dataset.kind='length';error.textContent='状态说明最多 60 字';return;}
      statusSaving=true;form.inert=true;const submitted=statusDraft,button=view.querySelector('.status-save');button.disabled=true;
      try{await act('status.save',submitted);if(statusDraft===submitted)statusDraft=null;if(form.isConnected)showView('me');toast('状态已设置');}
      catch(err){if(form.isConnected)error.textContent=err.message;else toast(err.message);}
      finally{statusSaving=false;button.disabled=false;form.inert=false;const activeForm=view.querySelector('#status-form');if(activeForm){activeForm.inert=false;activeForm.querySelector('.status-save').disabled=false;}view.querySelector('.status-editor-header .status-dismiss')?.removeAttribute('disabled');}
    };
  }
  function renderSettings() {
    const group=(title,rows)=>`<p class="section-title settings-group-title">${title}</p><section class="section">${rows}</section>`;
    return header('设置',{back:true})+`<div class="content page-content settings-content">${group('账号',plainCell('个人资料','edit-profile'))}${group('小手机',plainCell('小手机','engine-home',state.settings?.ai?.assign?.chat?'已选择模型':'未选择模型')+plainCell('用量与日志','engine-usage'))}${group('通用',plainCell('朋友权限','friend-permissions')+plainCell('聊天记录管理','backup'))}${group('关于',plainCell('关于屁屁机','about'))}<section class="section"><button class="cell centered-cell" data-action="logout">退出登录</button></section></div>`;
  }
  routes.set('friend-permissions',()=>header('朋友权限',{back:true})+`<div class="content page-content"><section class="section">${plainCell('通讯录黑名单','blacklist')}</section></div>`);
  routes.set('friend-profile',()=>{const r=roleById(route.arg);if(!r)return header('朋友资料',{back:true})+'<div class="empty">联系人不存在</div>';return header('朋友资料',{back:true})+`<div class="content page-content"><section class="section">${plainCell('备注',"contact-remark",r.remark||'')}${plainCell('标签','contact-remark',(r.tags||[]).join('、'))}${plainCell('电话','contact-remark',r.phone||'')}${plainCell('描述','contact-remark',r.description||'')}</section><p class="section-title">朋友权限</p><section class="section">${plainCell('朋友权限','contact-permissions',r.permissions?.onlyChat?'仅聊天':'聊天、朋友圈、微信运动等')}</section></div>`;});
  function renderContactMore(){const r=roleById(route.arg)||{};return header('更多信息',{back:true})+`<div class="content page-content"><section class="section contact-more-info">${[['地区',r.region],['个性签名',r.bio],['来源','由你添加']].map(([label,value])=>`<div class="info-line"><span>${label}</span><p>${esc(value||'未填写')}</p></div>`).join('')}</section></div>`;}
  function renderStickers(){return header('表情库',{back:true})+window.PipiStickers.render(state.stickers||[]);}
  function renderContactTags(){const tag=route.name==='tag-contacts'?String(route.arg||''):null,tags=[...new Set((state.roles||[]).flatMap(r=>r.tags||[]))];return header(tag||'标签',{back:true})+`<div class="content page-content"><section class="section">${tag?(state.roles||[]).filter(r=>(r.tags||[]).includes(tag)).map(r=>`<button class="cell" data-nav="role" data-arg="${esc(r.id)}">${avatar(r,40)}<span class="cell-body cell-title">${esc(roleName(r))}</span></button>`).join(''):tags.map(t=>`<button class="cell plain-cell" data-nav="tag-contacts" data-arg="${esc(t)}"><span class="cell-body cell-title">${esc(t)}</span><span class="cell-value">${(state.roles||[]).filter(r=>(r.tags||[]).includes(t)).length}</span>${icons.chevron}</button>`).join('')}</section>${!tag&&!tags.length?'<div class="empty"><p>暂无标签</p><p>在朋友资料的「设置备注和标签」中添加。</p></div>':''}</div>`;}
  function editContactRemark(r){
    const html=field('备注名','remark',r.remark||'',r.name||'')+field('标签','tags',(r.tags||[]).join('，'),'多个标签用逗号分隔')+field('电话号码','phone',r.phone||'','添加电话号码','tel')+field('描述','description',r.description||'','添加描述','textarea');
    openModal('设置备注和标签',html,async form=>{const values=formValues(form),tags=values.tags.split(/[,，、\n]/).map(t=>t.trim()).filter(Boolean);if(tags.length>10||tags.some(t=>t.length>30))throw new Error('最多设置10个标签，每个不超过30个字');await act('role.save',{id:r.id,remark:values.remark,tags,phone:values.phone,description:values.description});if(form.isConnected){closeModal(false);refresh();}},'完成',undefined,'cancel',{lockWhileSaving:true});
    overlay.querySelector('.modal-sheet')?.classList.add('contact-remark-editor');
  }
  function plainCell(title,action,value='',extra='') {return `<button class="cell plain-cell" data-action="${esc(action)}"><span class="cell-body"><span class="cell-title">${esc(title)}</span></span>${value?`<span class="cell-value">${esc(value)}</span>`:''}${extra||icons.chevron}</button>`;}
  function toggleCell(title,action,checked=false) {return `<button class="cell plain-cell" data-action="${action}" role="switch" aria-checked="${checked}"><span class="cell-body cell-title">${esc(title)}</span><span class="native-switch ${checked?'on':''}" aria-hidden="true"></span></button>`;}
  function renderRole() {
    const r=roleById(route.arg); if(!r)return header('详细资料',{back:true})+'<div class="empty">联系人不存在</div>';
    return header('',{back:true,right:iconButton('more','role-menu','资料设置')})+`<div class="content page-content"><div class="role-hero">${avatar(r,66)}<div><h3>${esc(roleName(r))}</h3>${r.remark?`<p>昵称：${esc(r.name)}</p>`:''}<p>微信号：${esc(r.wechatId||'未设置')}</p>${r.region?`<p>地区：${esc(r.region)}</p>`:''}</div></div><section class="section"><button class="cell plain-cell friend-profile-cell" data-action="friend-profile"><span class="cell-body"><span class="cell-title">朋友资料</span><span class="cell-desc">${esc([r.remark&&'备注：'+r.remark,(r.tags||[]).length&&'标签：'+r.tags.join('、')].filter(Boolean).join('　')||'添加朋友的备注名、电话、标签、备忘、照片等，并设置朋友权限。')}</span></span>${icons.chevron}</button></section><section class="section">${plainCell('朋友圈','contact-moments')}${plainCell('更多信息','contact-more')}</section><section class="section"><button class="cell centered-cell link-cell" data-nav="chat" data-arg="${esc(r.id)}">${icons.chat} 发消息</button><button class="cell centered-cell link-cell role-call" data-action="coming-call">${nativeIcon('tool-video-call-filled')} 音视频通话</button></section></div>`;
  }
  function renderRoleConfig(){const r=roleById(route.arg);if(!r)return header('角色管理',{back:true});const refCount=(r.faceReferences?.length||0)+(r.bodyReferences?.length||0);return header(roleName(r),{back:true})+`<div class="content page-content"><section class="section">${plainCell('角色资料','edit-role')}${plainCell('共同记忆','memories',String((state.memories||[]).filter(m=>m.roleId===r.id).length)+' 条')}${plainCell('TA 的表情库','role-stickers',String((r.stickers||[]).length)+' 张')}</section><section class="section">${plainCell('日程与穿搭','edit-role-schedule',state.engine?.data?.schedule?.days?.[r.id]?.outfit?'已有日程':(r.schedulePrompt?'已设偏好':'未设置'))}${plainCell('TA 的声音','edit-role-voice',r.voiceId||'跟随全局')}${plainCell('人物参考图与自拍','edit-role-selfie',refCount?'已上传 '+refCount+' 张':'未设置')}${plainCell('日常联系','edit-role-outreach',r.outreachEnabled?'已开启':'未开启')}</section><section class="section"><button class="cell centered-cell danger" data-action="delete-role">删除角色</button></section></div>`;}
  function renderChatInfo(){const r=roleById(route.arg);if(!r)return header('聊天信息',{back:true});return header('聊天信息',{back:true})+`<div class="content page-content chat-info"><div class="chat-members"><button data-nav="role" data-arg="${esc(r.id)}">${avatar(r,54)}<span>${esc(roleName(r))}</span></button><button data-action="coming-group" aria-label="添加聊天成员"><span class="member-add">${assetIcon('add-outlined')}</span><span>&nbsp;</span></button></div><section class="section">${plainCell('查找聊天内容','chat-search')+plainCell('TA 的提醒','role-reminders')+plainCell('角色配置','open-role-config')}</section><section class="section">${toggleCell('消息免打扰','toggle-mute',!!r.muted)}${toggleCell('置顶聊天','toggle-pin',!!r.pinned)}${toggleCell('强提醒','coming-strong-alert',false)}</section><section class="section">${plainCell('设置当前聊天背景','chat-background')}</section><section class="section">${plainCell('清空聊天记录','clear-conversation')}</section><section class="section">${plainCell('投诉','coming-report')}</section></div>`;}
  function renderContactSettings(){const r=roleById(route.arg);return header('资料设置',{back:true})+`<div class="content page-content"><section class="section">${plainCell('设置备注和标签','contact-remark',(r?.tags||[]).join('、'))}${plainCell('把他推荐给朋友','coming-contact-card')}${toggleCell('设为星标朋友','toggle-star',!!r?.starred)}${plainCell('朋友权限','contact-permissions')}</section><section class="section">${toggleCell('加入黑名单','toggle-block',!!r?.permissions?.blocked)}${plainCell('投诉','coming-report')}</section><section class="section">${plainCell('角色配置','open-role-config')}</section><section class="section"><button class="cell centered-cell danger" data-action="delete-role">删除联系人</button></section></div>`;}
  function renderContactPermissions(){
    const r=roleById(route.arg);if(!r)return header('朋友权限',{back:true})+'<div class="empty">联系人不存在</div>';
    const permissions=r.permissions||{};
    return header('朋友权限',{back:true})+`<div class="content page-content"><p class="section-title">设置朋友权限</p><section class="section">${toggleCell('仅聊天','permission-onlyChat',!!permissions.onlyChat)}</section><p class="page-note">开启后，与这位朋友保留聊天，双方朋友圈互不可见。</p><p class="section-title">朋友圈</p><section class="section">${toggleCell('不让他看我的朋友圈','permission-hideMyMoments',!!permissions.hideMyMoments)}${toggleCell('不看他的朋友圈','permission-hideTheirMoments',!!permissions.hideTheirMoments)}</section><section class="section">${toggleCell('加入黑名单','toggle-block',!!permissions.blocked)}</section><p class="page-note">加入黑名单后，停止与这位朋友收发消息及主动活动；解除后恢复。</p></div>`;
  }
  function renderBlacklist(){
    const contacts=(state.roles||[]).filter(r=>r.permissions?.blocked);
    return header('通讯录黑名单',{back:true})+`<div class="content page-content"><section class="section">${contacts.map(r=>`<button class="cell" data-nav="contact-permissions" data-arg="${esc(r.id)}">${avatar(r,40)}<span class="cell-body cell-title">${esc(roleName(r))}</span>${icons.chevron}</button>`).join('')}</section>${!contacts.length?'<div class="empty">暂无黑名单联系人</div>':'<p class="page-note">点开联系人，关闭「加入黑名单」即可解除。</p>'}</div>`;
  }
  function renderChatSearch(){
    const r=roleById(route.arg),term=chatSearch.trim().toLowerCase(),searching=!!(term||chatSearchDate||chatSearchFilter!=='all');
    const messages=(state.messages||[]).filter(m=>{
      if(m.roleId!==r?.id||!searching||!String(m.meta?.transcript||m.content).toLowerCase().includes(term))return false;
      if(chatSearchFilter==='image'&&m.type!=='image'&&!safeImage(m.meta?.image))return false;
      if(chatSearchFilter==='payment'&&!['transfer','redpacket'].includes(m.type))return false;
      if(chatSearchFilter==='voice'&&m.type!=='voice')return false;
      if(chatSearchFilter==='forward'&&m.type!=='forward')return false;
      if(chatSearchFilter==='link'&&(m.type!=='text'||!/(?:https?:\/\/|www\.)[^\s]+/i.test(m.content)))return false;
      const date=new Date(m.createdAt),day=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
      return !chatSearchDate||day===chatSearchDate;
    });
    return header('查找聊天内容',{back:true})+`<div class="search-bar"><label class="search-input-wrap">${icons.search}<input id="chat-search" type="search" value="${esc(chatSearch)}" placeholder="搜索" aria-label="搜索聊天内容">${chatSearch?'<button type="button" class="search-clear" data-action="clear-chat-search" aria-label="清除搜索">×</button>':''}</label></div><div class="content"><section class="chat-search-filters" aria-label="筛选聊天记录"><p class="chat-search-caption">搜索指定内容</p><div class="chat-search-grid"><button type="button" data-chat-search-date>日期</button>${[['image','图片及视频'],['file','文件'],['link','链接'],['voice','音乐与音频'],['payment','交易'],['mini','小程序'],['forward','聊天记录']].map(([key,label])=>`<button type="button" ${['file','mini'].includes(key)?'data-action="coming-search-'+key+'"':'data-chat-search-filter="'+key+'"'} aria-pressed="${chatSearchFilter===key}">${label}</button>`).join('')}</div><input type="date" id="chat-search-date" class="chat-search-date" aria-label="按日期筛选聊天记录" value="${esc(chatSearchDate)}">${searching&&(chatSearchDate||chatSearchFilter!=='all')?`<button type="button" class="chat-search-reset" data-chat-search-reset>${esc([chatSearchDate,chatSearchFilter!=='all'?'已筛选':''].filter(Boolean).join(' · '))}　清除</button>`:''}</section>${messages.map(m=>`<button class="search-result" data-search-message="${esc(m.id)}" aria-label="查看这条消息">${avatar(m.sender==='system'?{}:m.sender==='user'?state.profile:r,40)}<span><b>${esc(m.sender==='system'?'系统消息':m.sender==='user'?state.profile?.name:roleName(r))}</b><p>${richText(m.type==='voice'&&m.meta?.transcript?m.meta.transcript:preview(m))}</p><time>${esc(shortTime(m.createdAt))}</time></span></button>`).join('')||`<div class="empty">${searching?'没有找到相关聊天记录':'搜索与这位朋友的聊天记录'}</div>`}</div>`;
  }
  function renderNewFriends(){
    const rows=(state.roles||[]).map(r=>`<button class="cell new-friend-row" data-nav="role" data-arg="${esc(r.id)}">${avatar(r,40)}<span class="cell-body"><span class="cell-title">${esc(roleName(r))}</span><span class="cell-desc">${esc(r.bio||(r.wechatId?'微信号：'+r.wechatId:''))}</span></span><span class="new-friend-status">已添加</span></button>`).join('');
    return header('新的朋友',{back:true,right:`<span class="new-friends-more" aria-hidden="true">${icons.more}</span>`})+`<button class="search-bar new-friends-search" data-action="add-friend" aria-label="搜索微信号或手机号"><span class="search-input-wrap">${icons.search}<span>微信号/手机号</span></span></button><div class="content new-friends">${rows}<button class="cell centered-cell link-cell new-friend-create" data-action="add-role">创建新朋友</button></div>`;
  }
  function renderAddFriend(){
    const term=searchTerm.trim().toLowerCase(),phone= /^[+()\d\s-]+$/.test(term)?term.replace(/\D/g,''):'';
    const matches=term?(state.roles||[]).filter(r=>`${r.name||''} ${r.remark||''} ${r.wechatId||''}`.toLowerCase().includes(term)||phone&&(r.phone||'').replace(/\D/g,'').includes(phone)):[];
    const radar='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/><path d="M12 12 19 5"/></svg>';
    const tools=[['雷达加朋友',radar,'coming-radar','添加身边的朋友','#07c160'],['面对面建群',icons.group,'coming-group','与身边的朋友进入同一个群聊','#07c160'],['扫一扫',icons.scan,'coming-scan','扫描二维码名片添加朋友','#1485e5'],['手机联系人',icons.contacts,'coming-phone-contacts','添加通讯录中的朋友','#1485e5'],['公众号',icons.book,'coming-official','获取更多资讯和服务','#1485e5'],['企业微信联系人',icons.contacts,'coming-work-contacts','通过手机号搜索企业微信用户','#1485e5']];
    return header('添加朋友',{back:true})+`<div class="content add-friend-content"><div class="search-bar"><label class="search-input-wrap">${icons.search}<input id="list-search" type="search" placeholder="微信号/手机号" value="${esc(searchTerm)}" aria-label="搜索已有朋友的名字、微信号或手机号">${searchTerm?'<button type="button" class="search-clear" data-action="clear-list-search" aria-label="清除搜索">×</button>':''}</label></div>${term?`<p class="section-title">已有朋友</p><section class="section">${matches.map(r=>`<button class="cell" data-nav="role" data-arg="${esc(r.id)}">${avatar(r,40)}<span class="cell-body"><span class="cell-title">${esc(roleName(r))}</span><span class="cell-desc">微信号：${esc(r.wechatId||'未设置')}</span></span></button>`).join('')||'<div class="empty">没有找到已有朋友<br>外部微信号和手机号搜索暂未开放</div>'}</section>`:`<div class="my-wechat-id">我的微信号：${esc(state.profile?.wechatId||'未设置')} <button data-action="coming-profile-qr" aria-label="我的二维码">${icons.qrcode}</button></div><section class="section">${tools.map(([title,icon,action,description,color])=>`<button class="cell add-friend-tool" data-action="${action}"><span class="cell-icon" style="color:${color}">${icon}</span><span class="cell-main"><span class="cell-body"><span class="cell-title">${title}</span><span class="cell-desc">${description}</span></span>${icons.chevron}</span></button>`).join('')}</section>`}</div>`;
  }

  function renderMemories() {
    const r=roleById(route.arg); const records=(state.memories||[]).filter(m=>m.roleId===route.arg);
    return header('共同记忆',{back:true,right:iconButton('plus','add-memory','添加记忆')})+`<div class="content page-content"><p class="page-note">与 ${esc(roleName(r))} 的明确记忆。这些内容会随该角色的对话提供给模型。</p>${records.map(m=>`<article class="memory-card"><p>${esc(m.content)}</p><div class="memory-meta"><span>${esc(shortTime(m.createdAt))}</span><span class="memory-tools"><button data-edit-memory="${esc(m.id)}">编辑</button><button data-delete-memory="${esc(m.id)}" class="danger">删除</button></span></div></article>`).join('') || `<div class="empty"><div class="empty-icon">${icons.book}</div><h3>记住那些小事</h3><p>一个纪念日、一种习惯，或你希望对方一直记得的约定。</p><button class="primary-btn" data-action="add-memory">添加一条记忆</button></div>`}</div>`;
  }
  function renderProfile() {
    const p=state.profile||{};return header('个人信息',{back:true})+`<div class="content page-content"><section class="section"><button class="cell plain-cell profile-avatar-row" data-action="profile-avatar"><span class="cell-body cell-title">头像</span>${avatar(p,60)}${icons.chevron}</button>${plainCell('名字','profile-name',p.name)}${plainCell('拍一拍','profile-pat',p.patText||'')}${plainCell('微信号','profile-wechatId',p.wechatId)}<button class="cell plain-cell" data-action="coming-profile-qr"><span class="cell-body cell-title">二维码名片</span><span class="profile-qr">${icons.qrcode}</span>${icons.chevron}</button>${plainCell('更多信息','profile-more')}</section><section class="section">${plainCell('微信豆','coming-beans')}${plainCell('我的地址','coming-address')}</section></div>`;
  }
  function renderProfileMore(){const p=state.profile||{};return header('更多信息',{back:true})+`<div class="content page-content"><section class="section">${plainCell('性别','profile-gender',({male:'男',female:'女'})[p.gender]||'未填写')}${plainCell('地区','profile-region',p.region||'未填写')}${plainCell('个性签名','profile-bio',p.bio||'未填写')}</section></div>`;}
  function previewProfileAvatar(){
    openPage('个人头像',`<div class="profile-avatar-preview">${safeImage(state.profile?.avatar)?`<img src="${esc(state.profile.avatar)}" alt="我的头像">`:avatar(state.profile,100)}</div><button type="button" class="secondary-btn block-btn" data-avatar-choose>选择头像</button><button type="button" class="secondary-btn block-btn" data-avatar-remove ${safeImage(state.profile?.avatar)?'':'disabled'}>移除头像</button><input type="file" accept="${profileImageAccept}" data-avatar-file hidden>`,null);
    const form=overlay.querySelector('form'),file=form.querySelector('[data-avatar-file]');
    form.querySelector('[data-avatar-choose]').onclick=()=>file.click();
    file.onchange=async()=>{if(!file.files[0])return;try{const avatar=await readProfileImage(file.files[0]);if(!form.isConnected)return;await act('profile.save',{avatar});if(form.isConnected){closeModal();refresh();}}catch(err){toast('头像：'+err.message);}finally{file.value='';}};
    form.querySelector('[data-avatar-remove]').onclick=()=>confirmDialog('移除头像？','移除后显示默认头像。',async isCurrent=>{await act('profile.save',{avatar:''});if(isCurrent()){closeModal(false);await afterOverlayBack();refresh();}},'移除');
  }
  function editProfileField(key){const labels={name:'名字',wechatId:'微信号',region:'地区',bio:'个性签名',patText:'拍一拍'},p=state.profile||{};openModal(labels[key],field(labels[key],key,p[key]||'','',key==='bio'?'textarea':'text',key==='patText'?'填写“拍了拍自己的”后面的内容。留空可恢复默认。':''),async form=>{const raw=formValues(form)[key],value=key==='wechatId'&&raw===p[key]?raw:raw.trim();if(key==='name'&&!value)throw new Error('名字不能为空');if(key==='wechatId')checkWechatId(value,p.wechatId);await act('profile.save',{[key]:value});if(form.isConnected){closeModal();refresh();}});if(key==='patText')overlay.querySelector('[name=patText]').maxLength=100;}
  function renderAbout() {
    const sourceRow=sourceUrl?`<a class="cell plain-cell" href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer"><span class="cell-body"><span class="cell-title">源代码</span></span><span class="cell-value">查看</span>${icons.chevron}</a>`:`<div class="cell plain-cell"><span class="cell-body"><span class="cell-title">源代码</span></span><span class="cell-value">随安装包提供</span></div>`;
    return header('关于屁屁机',{back:true})+`<div class="content page-content"><div class="about-logo"><div class="auth-logo">${icons.chat}</div><h3>屁屁机</h3><p>v${esc(globalThis.__pipiVersion||'0.12.1')}</p></div>${globalThis.__pipiUpdatesEnabled?(globalThis.PipiUpdates?.markup()||''):''}<div class="about-text">一个独立账号，一部只属于你的小手机。<br>聊天、日常与共同记忆，都留在你的服务器。<br><br>首次安装时，通讯录和聊天记录为空。真实回复需要配置模型服务；调用与费用由你选择的服务商决定。钱包与红包仅为虚拟互动，不涉及真实资金。<br><br>本项目为开源、非售卖项目，无付费会员或激活码。界面复用 MIT 许可的 WeUI 与 GPL-3.0-only 许可的 LiangNiang/fake-world；本项目整体以 AGPL-3.0-only 发布。原生菜单尺寸、聊天信息分组与面板分页参考 alexiscn/WeChatSwift（MIT 代码）；未复制其截图素材、头像或字体。</div><section class="section">${sourceRow}</section><p class="page-note">尚未开放：群聊、扫码、音视频通话等展示入口。不会将未完成的功能伪装为真实能力。</p></div>`;
  }
  function renderBackup() {
    return header('备份与恢复',{back:true})+`<div class="content page-content"><section class="section">${cell('导出完整备份','backupExport','download-backup','','#5382b3','包括聊天、角色、记忆、图片和日常记录')}${cell('从备份恢复','backupRestore','restore-backup','','#5382b3','恢复前会再次提示确认')}</section><p class="page-note">导出时可包含模型 API Key。恢复会覆盖当前业务资料，并保留当前登录密码。密钥只用于与备份匹配的服务商地址。</p></div>`;
  }
  function renderChat() {
    const r=roleById(route.arg); if(!r) return header('聊天',{back:true})+'<div class="empty">联系人不存在，请返回通讯录。</div>';
    const messages=(state.messages||[]).filter(m=>m.roleId===r.id);
    let previousDate='',previousTimestamp=0;
    const body=messages.map(m=>{
      const date=new Date(m.createdAt), day=Number.isFinite(date.getTime())?`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`:'';
      const timeLabel=day!==previousDate||date.getTime()-previousTimestamp>=300000 ? `<div class="message-date">${esc(shortTime(m.createdAt,true))}</div>`:''; previousDate=day;previousTimestamp=date.getTime();
      if(m.sender==='system') return timeLabel+`<div class="system-message" data-message="${esc(m.id)}" ${m.meta?.kind==='pat'&&m.meta.author==='me'?'role="button" tabindex="0" data-bubble="'+esc(m.id)+'"':''}>${esc(m.content)}${m.meta?.kind==='recalled'&&m.meta.recalledText?` <button class="recall-edit" data-reedit="${esc(m.id)}">重新编辑</button>`:''}</div>`;
      const mine=m.sender==='user', entity=mine?state.profile:r;
      const voiceSeconds=Math.max(1,Math.round((Number(m.meta?.durationMs)||1000)/1000));
      const voiceWidth=Math.min(190,67+voiceSeconds*2.2);
      let bubble=richText(m.content), imageClass='', transferClass='', paymentLabel='';
      if(m.type==='image'){
        const sticker=Boolean(m.meta?.stickerId);
        imageClass=sticker?'image-bubble sticker-bubble':'image-bubble';
        bubble=safeImage(m.content)?`<img class="message-image" src="${esc(m.content)}" alt="${sticker?'聊天表情':'聊天图片'}" loading="lazy">`:'[无法显示的图片]';
      }
      if(m.type==='voice') bubble=`<span class="voice-message ${mine?'voice-mine':''}">${icons.voiceBubbleWave}<span>${voiceSeconds}″</span></span>`;
      if(m.type==='forward'){transferClass='forward-card';bubble=`<span class="forward-title">聊天记录</span><span class="forward-summary">${(m.meta?.entries||[]).slice(0,3).map(entry=>`<span>${esc(entry.senderName)}：${esc(preview(entry))}</span>`).join('')}</span><span class="forward-footer">聊天记录 · ${(m.meta?.entries||[]).length} 条</span>`;}
      if(m.type==='transfer'||m.type==='redpacket') {
        const transaction = state.wallet?.transactions?.find(item => item.id === m.meta?.transactionId);
        const packet = m.type === 'redpacket';
        const paymentName = packet ? '红包' : '转账';
        const note = transaction?.note ?? m.meta?.note;
        const blessing = note || '恭喜发财，大吉大利';
        const cents = Number(transaction?.amountCents ?? m.meta?.amountCents);
        const amount = Number.isFinite(cents) && cents > 0 ? (cents / 100).toFixed(2) : '';
        const status = transaction?.status || m.meta?.status || (transaction ? 'received' : 'unknown');
        const receiver = mine ? '对方' : '你';
        const verb = packet ? '领取' : '收款';
        let footerState, spokenState, detail;
        if (!transaction) {
          footerState = '历史记录';
          spokenState = '历史记录，详情未保留';
          detail = '旧记录已保留';
        } else if (status === 'pending') {
          footerState = '待' + verb;
          spokenState = '待' + receiver + verb;
          detail = packet ? (mine ? '等待对方打开' : '点开领取') : (mine ? '查看转账详情' : '请收款');
        } else if (status === 'returned') {
          footerState = spokenState = '已退还';
          detail = '查看退还详情';
        } else {
          footerState = packet ? '已领取' : mine ? '已被接收' : '已收款';
          spokenState = receiver + '已' + verb;
          detail = '查看' + paymentName + '详情';
        }
        const sticker = m.meta?.stickerImage || transaction?.stickerImage;
        const senderText = mine ? '你发给' + roleName(r) + '的' : roleName(r) + '发给你的';
        paymentLabel = senderText + paymentName + '，' + (amount ? amount + '元' : '金额未记录') + '，' + spokenState;
        if (packet || note) paymentLabel += packet ? '，祝福：' + blessing : '，备注：' + note;
        if (transaction) paymentLabel += '，点按查看' + paymentName + '详情';
        const stateClass = ['pending','received','returned'].includes(status) ? status : 'unknown';
        transferClass = 'message-transfer payment-card payment-' + m.type + ' payment-state-' + stateClass;
        if (status !== 'pending') transferClass += ' payment-resolved';
        if (!transaction) transferClass += ' payment-history';
        bubble = `<span class="payment-main">${packet ? redpacketCardMark : transferCardMark}
          <span class="${packet ? 'payment-packet-mark' : 'payment-crystal-mark'}" hidden aria-hidden="true"><i></i>${packet ? '' : '<i></i><i></i>'}</span>
          <span class="payment-copy"><span class="payment-title">${packet ? esc(blessing) : amount ? '¥' + amount : '转账'}</span><span class="payment-note">${esc(!packet && note ? note : detail)}</span></span>
          ${packet && safeImage(sticker) ? `<img class="redpacket-card-sticker" src="${esc(sticker)}" alt="红包表情">` : ''}
        </span><span class="payment-footer"><span>${packet ? '微信红包' : '微信液态水晶转账'}</span><span class="payment-footer-state">${footerState}</span></span>`;
      }
      const chunks=null;
      const bubbles=chunks&&chunks.length>1?chunks.map(chunk=>`<div class="message-bubble" role="button" tabindex="0" data-bubble="${esc(m.id)}" aria-label="${esc(chunk.slice(0,80))}，长按或右键操作">${richText(chunk)}</div>`).join(''):`<div class="message-bubble ${imageClass} ${transferClass}" role="button" tabindex="0" data-bubble="${esc(m.id)}" aria-label="${m.type==='image'?(m.meta?.stickerId?'表情':'图片'):m.type==='voice'?`语音消息，${voiceSeconds}秒`:m.type==='forward'?'聊天记录':paymentLabel?esc(paymentLabel):esc(String(m.content).slice(0,80))}，长按或右键操作">${bubble}</div>`;
      const attachedImage=m.type==='text'&&safeImage(m.meta?.image)?`<div class="message-bubble image-bubble" role="button" tabindex="0" data-bubble="${esc(m.id)}"><img class="message-image" src="${esc(m.meta.image)}" alt="附带的聊天图片" loading="lazy"></div>`:'';
      return timeLabel+`<div class="message-row ${mine?'mine':''} ${chatSelection?.ids.has(m.id)?'message-selected':''}" data-message="${esc(m.id)}">${chatSelection?`<button class="message-select" data-select-message="${esc(m.id)}" aria-label="选择消息" aria-pressed="${chatSelection.ids.has(m.id)}">${chatSelection.ids.has(m.id)?'✓':''}</button>`:''}<button class="message-avatar" data-chat-avatar="${mine?'self':'contact'}" aria-label="${mine?'我的头像':'朋友头像'}：单击查看资料，双击拍一拍">${avatar(entity,43)}</button><div class="message-body ${m.type==='voice'?'voice-body':''}" ${m.type==='voice'?`style="--voice-width:${voiceWidth}px"`:''}>${bubbles}${attachedImage}${m.type==='text'&&m.sender==='assistant'&&m.status!=='demo'&&!chatSelection?speechIndicator(m.id):''}${m.meta?.quote?renderMessageQuote(m.meta.quote,r):''}${m.type==='voice'?renderVoiceTranscript(m):''}${chatSelection?`<button class="message-range" data-select-range="${esc(m.id)}">选择到这里</button>`:''}${m.status==='error'?`<button class="message-failure" data-retry="${esc(m.id)}" aria-label="发送失败，点击重试">!</button>`:''}</div></div>`;
    }).join('');
    const pending=outgoing?.roleId===r.id?`<div class="message-row mine"><span>${avatar(state.profile,43)}</span><div class="message-body">${outgoing.image?`<div class="message-bubble image-bubble"><img class="message-image" src="${esc(outgoing.image)}" alt="正在发送的图片"></div>`:''}${outgoing.text?`<div class="message-bubble">${esc(outgoing.text)}</div>`:''}<div class="message-label" style="text-align:right;margin-top:5px">发送中…</div></div></div>`:'';
    return header(chatSelection?`已选择 ${chatSelection.ids.size} 条消息`:window.PipiEngine?.isTyping(r.id)?'对方正在输入…':roleName(r),{back:true,right:chatSelection?'':iconButton('more','chat-details','聊天信息')})+`<div class="chat-messages ${chatSelection?'chat-selecting':''}" id="chat-messages" ${safeImage(r.chatBackground)?`style="background-image:url('${esc(r.chatBackground)}')"`:''}>${messages.some(m=>m.status==='demo')?'<div class="system-message demo-notice">这里保留了用于介绍界面的示例对话，非模型生成。</div>':''}${body}${pending}</div>${chatSelection?'':'<div class="chat-notice-slot"><button type="button" class="chat-new-messages" hidden></button></div>'}${chatSelection?renderMessageSelection():renderComposer()}`;
  }
  function speechIndicator(id){
    return `<button type="button" class="message-speech" data-message-speech="${esc(id)}" hidden>${icons.voiceWave}<span class="speech-spinner" aria-hidden="true"></span></button>`;
  }
  function renderMessageQuote(quote,r){
    const original=quote.messageId&&(state.messages||[]).find(m=>m.id===quote.messageId),available=original&&original.meta?.kind!=='recalled'&&!quote.unavailable;
    const name=quote.senderName||(quote.sender==='user'?state.profile?.name:roleName(r)),image=safeImage(quote.image)?quote.image:quote.type==='image'&&safeImage(quote.content)?quote.content:'';
    const text=({image:image?'':'[图片]',voice:'[语音]',forward:'[聊天记录]',transfer:'[转账]',redpacket:'[红包]'})[quote.type]??quote.content;
    const unavailable=quote.unavailable==='recalled'?'原消息已撤回':quote.unavailable==='deleted'?'原消息已删除':'';
    return `<button type="button" class="message-quote ${image?'quote-with-image':''} ${unavailable?'quote-unavailable':''}" data-quote-message="${available?esc(quote.messageId):''}" ${available?'':'disabled'} aria-label="${available?'定位被引用的消息':unavailable||(!quote.messageId?'引用快照':'原消息不可用')}"><span class="quote-copy">${esc(name)}：${richText(text)}</span>${image?`<img src="${esc(image)}" alt="引用的图片" class="quote-image">`:''}${unavailable?`<small class="quote-unavailable-note">${unavailable}</small>`:''}</button>`;
  }
  function renderVoiceTranscript(message){
    const ui=transcriptViews.get(message.id),transcript=message.meta?.transcript;
    if(!ui?.expanded)return '';
    let body;
    if(transcript){
      const demo=message.meta.transcriptSource==='demo'||ui.demo;
      body=`<span class="transcript-text">${esc(transcript)}</span>${demo?'<small class="transcript-demo">演示预设文字，非真实识别结果</small>':''}`;
    }else if(ui.phase==='loading'||(ui.phase==='waiting'&&message.status==='pending')){
      body='<span class="transcript-progress" role="status">正在识别…</span>';
    }else{
      body=`<span class="transcript-error" role="alert">${esc(ui.error||message.error||'未获得识别文字')}</span><button data-transcribe="${esc(message.id)}">重试</button>`;
    }
    return `<div class="voice-transcript transcript-content" aria-label="语音转文字">${body}</div>`;
  }
  // Adapted from fake-world ConversationFooter/{BottomPopup,EmojiPanel,EmojiList,FloatingButtons}
  // at the GPL revision above; seven-column scrolling follows the supplied iPhone reference.
  const micMark='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4"/><path d="M5.5 11v2a6.5 6.5 0 0 0 13 0v-2M12 19.5V21"/></svg>';
  function emojiEntries(){return window.PipiEmoji||[];}
  function renderEmojiBoard(){
    const entries=emojiEntries(),term=emojiSearch.trim().toLowerCase(),matches=entries.filter(e=>!term||(e.label+' '+e.token).toLowerCase().includes(term));
    const emojiButtons=items=>items.map(e=>'<button type="button" data-emoji="'+esc(e.token)+'" aria-label="'+esc(e.label||e.token)+'">'+emojiSprite(e)+'</button>').join('');
    const recent=(state.emojiRecents||[]).map(token=>entries.find(e=>e.token===token)).filter(Boolean).slice(0,7);
    const tabs=[['search','search','搜索表情'],['all','smile','所有表情'],['favorites','heart','收藏表情'],['selfie','','自拍表情']];
    const toolbar='<div class="emoji-toolbar" role="tablist" aria-label="表情分类">'+tabs.map(([tab,icon,label])=>'<button type="button" role="tab" aria-selected="'+(emojiTab===tab)+'" class="'+(emojiTab===tab?'active':'')+'" data-emoji-tab="'+tab+'" aria-label="'+label+'">'+(tab==='selfie'?'<img src="/vendor/fake-world/selfie-expression.png" alt="">':icons[icon])+'</button>').join('')+'</div>';
    let content='';
    if(emojiTab==='all')content=(recent.length?'<h3 class="recent-emoji-heading">最近使用</h3><div class="emoji-grid recent-emojis">'+emojiButtons(recent)+'</div>':'')+'<h3>所有表情</h3><div class="emoji-grid">'+emojiButtons(entries)+'</div>';
    if(emojiTab==='search')content='<label class="emoji-search">'+icons.search+'<input id="emoji-search" type="search" value="'+esc(emojiSearch)+'" placeholder="搜索表情" aria-label="搜索表情"></label><h3>'+(term?'搜索结果':'所有表情')+'</h3><div class="emoji-grid">'+emojiButtons(matches)+'</div>'+(!matches.length?'<p class="emoji-empty">没有找到相关表情</p>':'');
    if(emojiTab==='favorites')content='<div class="sticker-heading"><h3>表情库</h3><button type="button" data-action="manage-stickers">整理</button></div><div class="sticker-grid"><button type="button" class="add-sticker" data-action="add-sticker" aria-label="添加收藏表情">'+icons.add+'</button>'+(state.stickers||[]).filter(s=>safeImage(s.image)).map(s=>'<button type="button" data-sticker="'+esc(s.id)+'" aria-label="发送收藏表情"><img src="'+esc(s.image)+'" alt="收藏表情"></button>').join('')+'</div>'+(!(state.stickers||[]).length?'<p class="emoji-empty">添加图片到表情，点按即可发送</p>':'');
    if(emojiTab==='selfie')content='<div class="emoji-unavailable">'+icons.camera+'<p>自拍表情暂未开放</p></div>';
    return toolbar+'<section class="emoji-board"'+(emojiExpandedHeight?' style="height:'+emojiExpandedHeight+'px"':'')+' aria-label="表情面板"><div class="emoji-drag-handle" role="separator" aria-label="调整表情面板高度" aria-orientation="horizontal" tabindex="0"><span></span></div><div class="emoji-scroll">'+content+'</div>'+(['all','search'].includes(emojiTab)?'<div class="emoji-action-backdrop" aria-hidden="true"></div><div class="emoji-floating"><button type="button" data-action="emoji-delete" aria-label="删除上一个表情或文字" '+(!composeText?'disabled':'')+'>'+assetIcon('backspace')+'</button><button type="button" data-action="emoji-send" '+(sending||(!composeText.trim()&&!composeImage)?'disabled':'')+'>发送</button></div>':'')+'</section>';
  }
  function composeTrailingMode(){return 'more';}
  function renderComposeTrailing(){return iconButton('add','toggle-panel','展开更多功能');}
  function captureChatLayout(){const list=view.querySelector('#chat-messages');return route.name==='chat'&&list?.dataset.scrollReady==='true'?{list,roleId:route.arg,top:list.scrollTop,bottom:list.scrollHeight-list.scrollTop-list.clientHeight<=2}:null;}
  function restoreChatLayout(snapshot){if(!snapshot||!snapshot.list.isConnected||route.name!=='chat'||route.arg!==snapshot.roleId)return;const list=snapshot.list;if(snapshot.bottom){list.scrollTop=list.scrollHeight;chatScrolls.delete(snapshot.roleId);}else{list.scrollTop=snapshot.top;chatScrolls.set(snapshot.roleId,list.scrollTop);}}
  function resizeComposeInput(input){if(!input)return;const anchor=captureChatLayout();input.style.height='40px';input.style.height=Math.min(112,input.scrollHeight)+'px';restoreChatLayout(anchor);}
  function syncComposerControls(){
    const anchor=captureChatLayout();let changed=false;
    const trailing=view.querySelector('.compose-trailing'),mode=composeTrailingMode();
    if(trailing){if(trailing.dataset.mode!==mode){trailing.innerHTML=renderComposeTrailing();trailing.dataset.mode=mode;bindActionButtons(trailing);changed=true;}const send=trailing.querySelector('[type=submit]');if(send)send.disabled=!!(sending||composeComposing||recordingSession);}
    const remove=view.querySelector('[data-action=emoji-delete]'),send=view.querySelector('[data-action=emoji-send]');
    if(remove)remove.disabled=!composeText||composeComposing;if(send)send.disabled=!!(sending||composeComposing||recordingSession||(!composeText.trim()&&!composeImage));
    syncDictationState();
    if(changed)resizeComposeInput(view.querySelector('#compose-text'));restoreChatLayout(anchor);
  }
  function syncComposerDraft(){if(route.name==='chat')window.PipiEngine?.activity(route.arg);const input=view.querySelector('#compose-text');if(input&&!composeComposing){paintComposer(input,document.activeElement===input);resizeComposeInput(input);syncComposerControls();}else updateComposer();}
  function renderComposer() {
    const quote=(state.messages||[]).find(m=>m.id===quoteId);
    const tools=[['toolImage','upload-chat-image','照片'],['toolCamera','coming-camera','拍摄'],['toolVideo','coming-video','视频通话'],['toolLocation','coming-location','位置'],['toolRedpacket','chat-redpacket','红包'],['mic','dictation','语音转文字'],['toolTransfer','chat-transfer','转账'],['toolFavorites','favorites','收藏'],['toolGift','coming-gift','礼物'],['toolContact','coming-contact-card','个人名片'],['toolFile','coming-file','文件'],['toolCards','coming-cards','卡券'],['toolMusic','coming-music','音乐']];
    const more=panel==='more'?'<div class="more-pages"><div class="compose-panel">'+tools.slice(morePage*8,morePage*8+8).map(([icon,action,label])=>'<button type="button" data-action="'+action+'"'+(action==='dictation'?' class="compose-dictation" aria-label="语音转文字" aria-pressed="false"':'')+'><span class="panel-icon">'+(action==='dictation'?micMark:icons[icon]||'')+'</span><span>'+label+'</span></button>').join('')+'</div></div><div class="panel-dots">'+[0,1].map(i=>'<button type="button" class="'+(morePage===i?'active':'')+'" data-action="more-'+(i?'next':'prev')+'" aria-label="第'+(i+1)+'页" aria-current="'+(morePage===i?'page':'false')+'"></button>').join('')+'</div>':'';
    const textField=panel==='voice'?'<button type="button" class="voice-record" data-record aria-label="按住说话；左上滑取消，右上滑转文字">按住 说话</button>':'<div class="compose-field"><div id="compose-text" class="compose-input" contenteditable="true" role="textbox" enterkeyhint="send" aria-multiline="true" aria-disabled="false" inputmode="'+(panel==='emoji'?'none':'text')+'" aria-label="输入消息" spellcheck="false">'+richText(composeText,true)+'</div></div>';
    return '<footer class="chat-composer '+(panel==='emoji'?'emoji-open':'')+'">'+(quote?'<div class="composer-quote"><span>引用 '+esc(quote.sender==='user'?state.profile?.name:roleName(roleById(route.arg)))+'：'+esc(preview(quote))+'</span><button type="button" data-action="clear-quote" aria-label="取消引用">×</button></div>':'')+(composeImage?'<div class="compose-image-preview"><img src="'+esc(composeImage)+'" alt="待发送的图片"><span>'+(composeStickerId?'表情已选择':'图片已选择')+'</span><button type="button" data-action="clear-image">移除</button></div>':'')+'<div class="dictation-status" role="status" aria-live="polite" hidden><span></span><div class="dictation-actions"><button type="button" data-action="finish-dictation">完成</button><button type="button" data-action="cancel-dictation">取消</button></div></div><form id="compose-form" class="compose-row">'+iconButton(panel==='voice'?'keyboard':'voice','toggle-voice',panel==='voice'?'切换到键盘输入':'切换到按住说话')+textField+iconButton(panel==='emoji'?'keyboard':'smile','toggle-emoji',panel==='emoji'?'切换到键盘输入':'选择表情')+'<span class="compose-trailing" data-mode="'+composeTrailingMode()+'">'+renderComposeTrailing()+'</span></form>'+(panel==='emoji'||panel==='more'?'<div class="composer-extras">'+(panel==='emoji'?renderEmojiBoard():more)+'</div>':'')+'<input type="file" id="chat-image-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden><input type="file" id="sticker-file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,.bmp,.avif" hidden></footer>';
  }
  function composerPointerBusy(){return composerPointers.size>0||composerPointerSettling;}
  function resetComposerPointerState(){composerPointers.clear();composerPointerSettling=false;pointerComposerUpdatePending=false;pointerViewRefreshPending=false;if(composerPointerFrame)cancelAnimationFrame(composerPointerFrame);composerPointerFrame=0;}
  function settleComposerPointer(){
    // Keep the guard through pointerup's ensuing click. A microtask here can
    // detach the pressed node before the browser dispatches that click.
    composerPointerSettling=true;if(composerPointerFrame)return;
    const roleId=route.arg,footer=view.querySelector('.chat-composer');
    composerPointerFrame=requestAnimationFrame(()=>{
      composerPointerFrame=0;if(composerPointers.size)return;composerPointerSettling=false;
      if(route.name!=='chat'||route.arg!==roleId||footer!==view.querySelector('.chat-composer')){pointerComposerUpdatePending=false;pointerViewRefreshPending=false;return;}
      const render=pointerViewRefreshPending,compose=pointerComposerUpdatePending;pointerViewRefreshPending=false;pointerComposerUpdatePending=false;
      if(render)refresh();else if(compose)updateComposer();
    });
  }
  function releaseComposerPointer(event){if(!composerPointers.delete(event.pointerId))return;if(!composerPointers.size)settleComposerPointer();}
  document.addEventListener('pointerdown',event=>{const footer=view.querySelector('.chat-composer');if(route.name==='chat'&&footer?.contains(event.target))composerPointers.add(event.pointerId);},true);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,releaseComposerPointer,true);
  document.addEventListener('click',event=>{if(!composerPointers.size&&composerPointerSettling&&view.querySelector('.chat-composer')?.contains(event.target))composerPointerSettling=false;},true);
  const releaseAllComposerPointers=()=>{if(!composerPointerBusy())return;composerPointers.clear();settleComposerPointer();};
  window.addEventListener('blur',releaseAllComposerPointers);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseAllComposerPointers();});
  function updateComposer() {
    if(composerPointerBusy()){pointerComposerUpdatePending=true;return;}
    if(recordingSession?.mode==='hold')return;
    pointerComposerUpdatePending=false;
    if(composeComposing||searchComposing){deferredComposerUpdate=true;syncComposerControls();return;}
    deferredComposerUpdate=false;
    const old=view.querySelector('.chat-composer');if(!old)return;
    const anchor=captureChatLayout();
    const active=old.contains(document.activeElement)?document.activeElement:null,wasInput=active?.id==='compose-text',wasSearch=active?.id==='emoji-search',searchCursor=active?.selectionStart;
    const previousInput=old.querySelector('#compose-text'),previousEmoji=old.querySelector('.emoji-scroll');
    if(previousInput)composerScroll.input=previousInput.scrollTop;if(previousEmoji)composerScroll.emoji=previousEmoji.scrollTop;
    if(wasInput)composerSelection=readComposerSelection(active);
    old.outerHTML=renderComposer();bindComposer();bindActionButtons(view.querySelector('.chat-composer'));
    const from=composerPanelFrom;composerPanelFrom=null;
    if(from!==null)animateComposerPanel(from,anchor);
    const input=view.querySelector('#compose-text');if(input&&wasInput){input.focus({preventScroll:true});setComposerSelection(input,composerSelection.start,composerSelection.end);}
    if(input)input.scrollTop=composerScroll.input;
    if(wasSearch){const search=view.querySelector('#emoji-search');search?.focus({preventScroll:true});search?.setSelectionRange(searchCursor,searchCursor);}
    restoreChatLayout(anchor);
  }
  function animateComposerPanel(from,anchor){
    const extras=view.querySelector('.composer-extras');
    if(!extras||reduceMotion.matches||typeof extras.animate!=='function')return;
    const height=extras.getBoundingClientRect().height;
    if(Math.abs(height-from)<1)return;
    const animation=extras.animate([{height:from+'px'},{height:height+'px'}],{duration:200,easing:'ease-out'});
    if(!anchor?.bottom)return;
    const pin=()=>{
      if(extras.isConnected&&anchor.list.isConnected){
        anchor.list.scrollTop=anchor.list.scrollHeight;
        if(animation.playState==='running')requestAnimationFrame(pin);
      }
    };
    requestAnimationFrame(pin);
  }
  function changeComposerMode(next,focusInput=false){
    composerPanelFrom=next==='more'||next==='emoji'?(view.querySelector('.composer-extras')?.getBoundingClientRect().height||0):null;
    const input=view.querySelector('#compose-text');if(input)composerSelection=readComposerSelection(input);
    document.activeElement?.blur();panel=next;updateComposer();
    if(focusInput){const editor=view.querySelector('#compose-text');if(editor){editor.focus({preventScroll:true});setComposerSelection(editor,composerSelection.start,composerSelection.end);editor.scrollTop=composerScroll.input;}}
  }
  function insertComposerText(text){if(composeComposing||sending)return;const start=Math.min(composeText.length,composerSelection.start),end=Math.min(composeText.length,composerSelection.end);rememberComposerEdit();composeText=composeText.slice(0,start)+text+composeText.slice(end);composerSelection={start:start+text.length,end:start+text.length};syncComposerDraft();}
  function deleteComposerText(){
    if(composeComposing||sending)return;
    rememberComposerEdit();
    let {start,end}=composerSelection;start=Math.min(start,composeText.length);end=Math.min(end,composeText.length);
    if(start===end&&start>0){const before=composeText.slice(0,start),token=emojiEntries().map(e=>e.token).find(t=>before.endsWith(t));if(token)start-=token.length;else {const segments=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(before)]:Array.from(before).map(segment=>({segment}));start-=segments.at(-1)?.segment.length||1;}}
    composeText=composeText.slice(0,start)+composeText.slice(end);composerSelection={start,end:start};syncComposerDraft();
  }
  function scrollChat(messageId='') { const list=document.getElementById('chat-messages'); if(list) requestAnimationFrame(()=>{if(messageId){const target=[...list.querySelectorAll('[data-message]')].find(el=>el.dataset.message===messageId);if(target){target.scrollIntoView({block:'center'});target.classList.add('message-found');setTimeout(()=>target.classList.remove('message-found'),1800);}focusMessageId='';}else if(forceBottomRole===route.arg){list.scrollTop=list.scrollHeight;chatScrolls.delete(route.arg);forceBottomRole='';}else list.scrollTop=chatScrolls.has(route.arg)?chatScrolls.get(route.arg):list.scrollHeight;list.dataset.scrollReady='true';}); }
  function bindFilterInput(input,setValue,render=refresh){
    let composing=false,scheduled=false;
    const update=()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;if(composing||!input.isConnected)return;const cursor=input.selectionStart,id=input.id;setValue(input.value);render();const next=view.querySelector('#'+id);next?.focus({preventScroll:true});try{next?.setSelectionRange(cursor,cursor);}catch{}});};
    input.addEventListener('compositionstart',()=>{composing=true;searchComposing=true;});
    input.addEventListener('compositionend',()=>{composing=false;searchComposing=false;if(input.isConnected){setValue(input.value);update();}});
    input.oninput=event=>{if(event.isComposing){composing=true;searchComposing=true;}setValue(input.value);if(!composing&&!event.isComposing)update();};
  }
  function bindContactIndex(){
    const rail=view.querySelector('.contact-index-rail'),content=view.querySelector('.content.contacts');if(!rail||!content)return;
    const jump=letter=>{if(letter==='top'){content.scrollTop=0;return;}const group=document.getElementById('contact-group-'+letter);if(group&&content.contains(group))content.scrollTop+=group.getBoundingClientRect().top-content.getBoundingClientRect().top;};
    rail.querySelectorAll('[data-contact-index]').forEach(button=>button.onclick=()=>jump(button.dataset.contactIndex));
    const follow=event=>{const button=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-contact-index]');if(button&&rail.contains(button))jump(button.dataset.contactIndex);};
    rail.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();rail.setPointerCapture(event.pointerId);follow(event);};rail.onpointermove=event=>{if(rail.hasPointerCapture(event.pointerId))follow(event);};
  }
  function bindMain() {
    if (window.ClassicSocial) {
      window.ClassicSocial.decorate(view,route,state);
      window.ClassicSettings.decorate(view,route,state);
      if (route.name === 'chat') window.ClassicChat.decorate(view);
    }
    window.WaterdropChat?.decorate(view);
    bindActionButtons(view);
    if (route.name === 'skins') {
      view.querySelector('.skin-picker').onchange = event => {
        try {
          window.PipiSkins.select(event.target.value);
        } catch (error) {
          if (error.name !== 'SecurityError' && error.name !== 'QuotaExceededError') throw error;
          renderView();
          toast('浏览器未能保存皮肤选择', true);
        }
      };
    }
    if(route.name==='status-editor')bindStatusEditor();
    view.querySelectorAll('[data-status-preset]').forEach(button=>button.onclick=()=>{statusDraft={preset:button.dataset.statusPreset,description:statusDraft?.description||''};showView('status-editor');});
    view.querySelectorAll('[data-status-history]').forEach(button=>button.onclick=()=>{const item=state.statusHistory.find(item=>item.id===button.dataset.statusHistory),choice=statusChoice(item.preset);openPage('历史状态',`<div class="status-history-detail"><h3>${icons[choice[2]]}${esc(choice[1])}</h3><p>${esc(item.description||'未填写说明')}</p><time>${esc(new Date(item.startedAt).toLocaleString('zh-CN',{hour12:false}))}</time><p>已结束</p></div>`,null);});
    view.querySelectorAll('[data-nav]').forEach(el=>el.addEventListener('click',()=>showView(el.dataset.nav,el.dataset.arg||undefined)));
    view.querySelectorAll('[data-edit-memory]').forEach(el=>el.onclick=()=>editMemory(el.dataset.editMemory));
    view.querySelectorAll('[data-delete-memory]').forEach(el=>el.onclick=()=>confirmDialog('删除这条记忆？','删除后将不再向角色提供这条记忆。',()=>act('memory.delete',{id:el.dataset.deleteMemory}),'删除'));
    const search=view.querySelector('#list-search');
    if(search)bindFilterInput(search,value=>{if(route.name==='global-search')globalSearchTerm=value;else searchTerm=value;});
    const chatInput=view.querySelector('#chat-search');if(chatInput)bindFilterInput(chatInput,value=>{chatSearch=value;});
    view.querySelectorAll('[data-chat-search-filter]').forEach(el=>el.onclick=()=>{chatSearchFilter=el.dataset.chatSearchFilter;refresh({resetScroll:true});});
    const chatDate=view.querySelector('#chat-search-date');if(chatDate)chatDate.onchange=()=>{chatSearchDate=chatDate.value;refresh({resetScroll:true});};
    const clearChatDate=view.querySelector('[data-chat-search-reset]');if(clearChatDate)clearChatDate.onclick=()=>{chatSearchDate='';chatSearchFilter='all';refresh({resetScroll:true});};
    const pickChatDate=view.querySelector('[data-chat-search-date]');if(pickChatDate&&chatDate)pickChatDate.onclick=()=>{chatDate.style.pointerEvents='auto';if(chatDate.showPicker)chatDate.showPicker();else chatDate.focus();};
    bindContactIndex();
    view.querySelectorAll('[data-search-message]').forEach(el=>el.onclick=()=>{focusMessageId=el.dataset.searchMessage;showView('chat',route.arg);});
    view.querySelectorAll('[data-global-message]').forEach(el=>el.onclick=()=>{focusMessageId=el.dataset.globalMessage;showView('chat',el.dataset.searchRole);});
    view.querySelectorAll('[data-remove-sticker]').forEach(el=>el.onclick=()=>confirmDialog('移除这个表情？','移除后可重新添加，聊天记录中的图片不受影响。',()=>act('sticker.delete',{id:el.dataset.removeSticker}),'移除'));
    if(route.name==='stickers'){window.PipiStickers.bind(view);const file=view.querySelector('#sticker-file');if(file)file.onchange=()=>uploadStickers(file);}
  }
  let openingRequest = 0;
  async function openWhenReady(name, load, trigger) {
    if (trigger?.getAttribute('aria-busy') === 'true') return;
    const request = ++openingRequest, origin = route;
    trigger?.setAttribute('aria-busy','true');
    try {
      await load();
      if (request === openingRequest && route === origin && !modalOpen) showView(name);
    } finally {
      trigger?.removeAttribute('aria-busy');
    }
  }
  function bindActionButtons(root) { root?.querySelectorAll('[data-action]').forEach(el=>{el.addEventListener('click',event=>{event.preventDefault(); Promise.resolve(handleAction(el.dataset.action,el)).catch(err=>toast(err.message));});}); }
  async function handleAction(action,trigger) {
    const r=roleById(route.arg);
    if(action.startsWith('permission-')&&r){const key=action.slice('permission-'.length);await act('role.save',{id:r.id,permissions:{[key]:!r.permissions?.[key]}});refresh();return;}
    if(action==='engine-usage'){await window.PipiUsage.open();return;}
    if(action==='engine-home'||action==='engine-functions'){await openWhenReady(action,window.PipiEngine.refreshConfig,trigger);return;}
    if(action==='role-stickers'||action==='role-reminders'){if(r){if(action==='role-reminders')window.PipiEngine?.invalidateJobs(r.id);showView(action,r.id);}return;}
    if (['skins','settings','providers','role-personas','about','backup','moments','ledger','farm','favorites','services','wallet'].includes(action)) { showView(action); return; }
    if(action==='friend-permissions'){showView(action);return;}
    if(action==='friend-profile'&&r){showView(action,r.id);return;}
    if(action.startsWith('coming-')) { if(window.ClassicEntries?.open(action,{route,state,trigger}))return;toast(({ 'coming-channels':'视频号内容暂未开放','coming-scan':'扫一扫暂未开放','coming-group':'群聊暂未开放','coming-camera':'拍摄暂未开放，可使用「照片」上传图片','coming-call':'音视频通话暂未开放','coming-more':'更多扩展暂未开放','coming-strong-alert':'强提醒暂未开放','coming-pay':'收付款暂未开放','coming-video':'视频通话暂未开放','coming-location':'位置暂未开放','coming-contact-card':'个人名片发送暂未开放','coming-file':'文件发送暂未开放','coming-cards':'卡券暂未开放','coming-music':'音乐暂未开放','coming-gift':'礼物暂未开放','coming-radar':'雷达加朋友暂未开放','coming-phone-contacts':'手机联系人暂未开放','coming-work-contacts':'企业微信联系人暂未开放' })[action] || '此功能暂未开放', true); return; }
    switch(action) {
      case 'open-status':if(activeStatus())showView('status');else{statusDraft={preset:'',description:''};showView('status-picker');}break;
      case 'edit-status':{const current=activeStatus();statusDraft={preset:current?.preset||'',description:current?.description||''};showView(current?'status-editor':'status-picker');break;}
      case 'choose-status':showView('status-picker');break;
      case 'status-history':{const origin=route,result=await api('/api/state');setState(result.state||result);if(route===origin)showView('status-history');break;}
      case 'cancel-status':statusDraft=null;showView('me');break;
      case 'end-status':confirmDialog('结束状态？','结束后将不再展示当前状态。',async isCurrent=>{await act('status.end');if(isCurrent())showView('me');},'结束状态');break;
      case 'back': goBack(); break;
      case 'search': searchOpen=!searchOpen; searchTerm=''; refresh(); view.querySelector('#list-search')?.focus(); break;
      case 'global-search':globalSearchTerm='';showView('global-search');view.querySelector('#list-search').focus();break;
      case 'cancel-global-search':globalSearchTerm='';goBack();break;
      case 'clear-list-search': if(route.name==='global-search')globalSearchTerm='';else searchTerm='';refresh();view.querySelector('#list-search')?.focus();break;
      case 'clear-chat-search': chatSearch='';refresh();view.querySelector('#chat-search')?.focus();break;
      case 'new-menu': topMenu(); break;
      case 'new-friends': showView('new-friends'); break;
      case 'add-friend': showView('add-friend');break;
      case 'open-role-config': if(r) showView('role-config', r.id); break;
      case 'moments-settings': window.PipiFeatures?.manageMoments?.(); break;
      case 'my-moments':showView('moment-album');break;
      case 'wallet-bills':window.PipiFeatures?.walletBills?.();break;
      case 'contact-remark': if(r)editContactRemark(r);break;
      case 'contact-moments': showView('moments',{roleId:r?.id});break;
      case 'contact-more': if(r)showView('contact-more',r.id);break;
      case 'contact-permissions':if(r)showView('contact-permissions',r.id);break;
      case 'blacklist':showView('blacklist');break;
      case 'toggle-block':if(r){if(r.permissions?.blocked){await act('role.save',{id:r.id,permissions:{blocked:false}});refresh();}else confirmDialog('加入黑名单？','加入后停止与这位朋友收发消息及主动活动。',async()=>{await act('role.save',{id:r.id,permissions:{blocked:true}});refresh();},'加入黑名单');}break;
      case 'toggle-pin': if(r){await act('conversation.pin',{roleId:r.id,pinned:!r.pinned});refresh();}break;
      case 'toggle-mute': if(r){await act('conversation.mute',{roleId:r.id,muted:!r.muted});refresh();}break;
      case 'toggle-star':if(r){await act('role.save',{id:r.id,starred:!r.starred});refresh();}break;
      case 'clear-conversation': if(r)confirmDialog('清空聊天记录？',`将删除与 ${roleName(r)} 的全部消息，保留联系人和共同记忆。`,()=>act('conversation.clear',{roleId:r.id}),'清空');break;
      case 'delete-role': if(r)confirmDialog('删除这位联系人？','聊天记录和关联记忆将一并删除，无法恢复。',async isCurrent=>{await act('role.delete',{id:r.id});if(isCurrent())showView('contacts');},'删除');break;
      case 'chat-search': chatSearch='';chatSearchFilter='all';chatSearchDate='';showView('chat-search',r?.id);view.querySelector('#chat-search')?.focus();break;
      case 'compose-moment': window.PipiFeatures?.openMomentCamera?.(); break;
      case 'add-role': editRole(); break;
      case 'edit-role': editRole(r?.id); break;
      case 'edit-role-schedule':if(r)editRoleSchedule(r);break;
      case 'edit-role-voice':if(r)editRoleVoice(r);break;
      case 'edit-role-selfie':if(r)editRoleSelfie(r);break;
      case 'edit-role-outreach':if(r)editRoleOutreach(r);break;
      case 'edit-profile': showView('profile'); break;
      case 'profile-avatar': previewProfileAvatar();break;
      case 'profile-gender':editProfileGender();break;
      case 'profile-name': editProfileField('name');break;
      case 'profile-wechatId': editProfileField('wechatId');break;
      case 'profile-region': editProfileField('region');break;
      case 'profile-bio': editProfileField('bio');break;
      case 'profile-pat':editProfileField('patText');break;
      case 'profile-more': showView('profile-more');break;
      case 'memories': if(r) showView('memories',r.id); break;
      case 'add-memory': editMemory(); break;
      case 'chat-details': if(r) showView('chat-info',r.id); break;
      case 'chat-background':if(r)editChatBackground(r);break;
      case 'forward-selected':if(chatSelection)await forwardMessages([...chatSelection.ids]);break;
      case 'delete-selected':if(chatSelection){const selected=chatSelection;confirmDialog('删除选中的消息？',`将删除 ${selected.ids.size} 条聊天记录。`,async isCurrent=>{await act('message.deleteMany',{roleId:selected.roleId,ids:[...selected.ids]});if(isCurrent()){closeModal(false);await afterOverlayBack();}if(chatSelection===selected)finishMessageSelection();},'删除');}break;
      case 'role-menu': if(r) showView('contact-settings',r.id); break;
      case 'toggle-emoji': {const opening=panel!=='emoji';if(opening){emojiTab='all';emojiSearch='';emojiExpandedHeight=0;composerScroll.emoji=0;}changeComposerMode(opening?'emoji':'',!opening);break;}
      case 'toggle-panel': morePage=0;changeComposerMode(panel==='more'?'':'more');break;
      case 'toggle-voice': {if(recordingSession?.mode==='dictation'||recordingSession?.mode==='hold')stopRecording(true);const opening=panel!=='voice';changeComposerMode(opening?'voice':'',!opening);break;}
      case 'dictation': if(recordingSession?.mode==='dictation'){stopRecording(recordingSession.phase!=='recording');}else if(!recordingSession&&!dictationBusy&&!sending&&!composeComposing){await startRecording('dictation');}break;
      case 'finish-dictation':if(recordingSession?.mode==='dictation'&&recordingSession.phase==='recording')stopRecording(false);break;
      case 'cancel-dictation':if(recordingSession?.mode==='dictation')stopRecording(true);break;
      case 'record': break;
      case 'more-prev': morePage=0;updateComposer();break;
      case 'more-next': morePage=1;updateComposer();break;
      case 'emoji-prev': emojiPage=0;updateComposer();break;
      case 'emoji-next': emojiPage=1;updateComposer();break;
      case 'emoji-delete':deleteComposerText();break;
      case 'emoji-send':await sendMessage(true);break;
      case 'manage-stickers':showView('stickers');break;
      case 'contact-tags':showView('contact-tags');break;
      case 'add-sticker':view.querySelector('#sticker-file')?.click();break;
      case 'clear-quote': quoteId=''; updateComposer(); break;
      case 'clear-image': composeImage='';composeStickerId=''; updateComposer(); break;
      case 'upload-chat-image': view.querySelector('#chat-image-file')?.click(); break;
      case 'chat-transfer': showView('wallet',{roleId:r?.id,mode:'transfer'}); break;
      case 'chat-redpacket': showView('wallet',{roleId:r?.id,mode:'redpacket'}); break;
      case 'chat-pat': if(r)await patChat(r.id,'contact');break;
      case 'logout': confirmDialog('退出登录？','数据会保留在服务器，输入密码即可重新登录。',async()=>{await api('/api/logout',{}); csrf=''; state=null; window.PipiEngine?.stop(); renderAuth(false);},'退出登录'); break;
      case 'download-backup': downloadBackup(); break;
      case 'restore-backup': pickBackup(); break;
    }
  }
  function conversationMenu(r) {
    actionSheet(roleName(r),[
      {label:r.pinned?'取消置顶':'置顶聊天',icon:icons.pin,run:async()=>{await act('conversation.pin',{roleId:r.id,pinned:!r.pinned});refresh();}},
      {label:'标为未读',icon:icons.chat,run:async()=>{await act('conversation.unread',{roleId:r.id});refresh();}},
      {label:'不显示此聊天',run:async()=>{await act('conversation.hide',{roleId:r.id,hidden:true});refresh();toast('已从会话列表隐藏，通讯录中仍可找到');}},
      {label:'查看详细资料',icon:icons.contacts,run:()=>showView('role',r.id)}
    ]);if(pressActive)holdMenuUntilRelease();
  }
  function topMenu(){
    modalCloseCallback=null;modalReturnFocus=document.activeElement;modalOpen=true;trackModalHistory();
    const items=[['group','发起群聊','coming-group'],['addFriend','添加朋友','add-friend'],['scan','扫一扫','coming-scan'],['services','收付款','coming-pay']];
    overlay.innerHTML=`<div class="menu-dismiss" data-close></div><div class="top-menu" role="menu" aria-label="添加菜单">${items.map(([icon,label,action])=>`<button role="menuitem" data-menu-action="${action}">${icons[icon]}<span>${label}</span></button>`).join('')}</div>`;if(pressActive)holdMenuUntilRelease();
    const shell=document.querySelector('.phone-shell')?.getBoundingClientRect(),bar=view.querySelector('.topbar')?.getBoundingClientRect();
    if(shell&&bar)overlay.querySelector('.top-menu').style.top=Math.max(0,bar.bottom-shell.top+8)+'px';
    overlay.querySelector('[data-close]').onclick=closeModal;
    overlay.querySelectorAll('[data-menu-action]').forEach(el=>el.onclick=()=>{closeModal();Promise.resolve(handleAction(el.dataset.menuAction)).catch(err=>toast(err.message));});
    overlay.querySelector('[role=menuitem]')?.focus({preventScroll:true});
  }
  function bindConversations() {
    view.querySelectorAll('[data-open-chat]').forEach(el=>{
      const r=roleById(el.dataset.openChat); let timer, startX=0,startY=0, suppress=false;
      el.addEventListener('click',event=>{if(suppress){event.preventDefault();suppress=false;return;} if(el.classList.contains('swiped')){el.classList.remove('swiped');return;} showView('chat',r.id);});
      el.addEventListener('contextmenu',event=>{event.preventDefault();conversationMenu(r);});
      el.addEventListener('pointerdown',event=>{if(event.button!==0)return;startX=event.clientX;startY=event.clientY;suppress=false;timer=setTimeout(()=>{suppress=true;conversationMenu(r);},550);});
      el.addEventListener('pointermove',event=>{if(Math.abs(event.clientX-startX)>12||Math.abs(event.clientY-startY)>12)clearTimeout(timer);});
      el.addEventListener('pointerup',event=>{clearTimeout(timer);if(event.clientX-startX < -45 && Math.abs(event.clientY-startY)<40){suppress=true;view.querySelectorAll('.swiped').forEach(node=>node.classList.remove('swiped'));el.classList.add('swiped');}else if(event.clientX-startX>45){suppress=true;el.classList.remove('swiped');}});
      el.addEventListener('pointercancel',()=>clearTimeout(timer)); el.addEventListener('pointerleave',()=>clearTimeout(timer));
    });
    view.querySelectorAll('[data-conv]').forEach(el=>el.onclick=async()=>{
      const r=roleById(el.dataset.role);if(el.dataset.conv==='delete'){confirmDialog('删除该聊天？','聊天记录将被删除，联系人仍保留在通讯录中。',()=>act('conversation.delete',{roleId:r.id}),'删除');return;}try { await act(`conversation.${el.dataset.conv}`,{roleId:r.id,...(el.dataset.conv==='pin'?{pinned:!r.pinned}:{}),...(el.dataset.conv==='hide'?{hidden:true}:{})}); refresh(); } catch(err){toast(err.message);}
    });
  }
  function renderMessageSelection(){
    const selected=(state.messages||[]).filter(m=>chatSelection.ids.has(m.id)),canForward=selected.length>0&&selected.every(m=>m.sender!=='system'&&m.status==='sent'&&['text','image','voice','forward'].includes(m.type));
    return `<footer class="message-selection-toolbar"><button data-action="forward-selected" ${canForward?'':'disabled'}>转发</button><span>已选择 ${selected.length} 条</span><button class="danger" data-action="delete-selected" ${selected.length?'':'disabled'}>删除</button></footer>`;
  }
  async function startMessageSelection(messageId){
    await afterOverlayBack();if(route.name!=='chat')return;
    const input=view.querySelector('#compose-text');if(input){composeText=readComposerText(input);composerSelection=readComposerSelection(input);composerScroll.input=input.scrollTop;}
    const emoji=view.querySelector('.emoji-scroll');if(emoji)composerScroll.emoji=emoji.scrollTop;document.activeElement?.blur();
    chatSelection={roleId:route.arg,anchorId:messageId,ids:new Set([messageId])};history.pushState({...history.state,chatSelection:true},'');refresh();
  }
  function finishMessageSelection(fromHistory=false){
    chatSelection=null;if(!fromHistory&&history.state?.chatSelection){overlayBackPending=true;history.back();}refresh();
  }
  function toggleSelectedMessage(messageId){
    if(state.messages.find(m=>m.id===messageId)?.sender==='system')return;
    const ids=chatSelection.ids;if(ids.has(messageId))ids.delete(messageId);else{if(ids.size===100){toast('每次最多选择 100 条消息');return;}ids.add(messageId);}refresh();
  }
  function selectMessageRange(messageId){
    const messages=(state.messages||[]).filter(m=>m.roleId===chatSelection.roleId&&m.sender!=='system'),start=messages.findIndex(m=>m.id===chatSelection.anchorId),end=messages.findIndex(m=>m.id===messageId);
    if(start<0||end<0)return;
    const ids=new Set([...chatSelection.ids,...messages.slice(Math.min(start,end),Math.max(start,end)+1).map(m=>m.id)]);
    if(ids.size>100){toast('每次最多选择 100 条消息');return;}chatSelection.ids=ids;refresh();
  }
  async function forwardMessages(ids){
    await afterOverlayBack();
    const recipients=(state.roles||[]).filter(r=>!r.permissions?.blocked).map(r=>`<label class="cell forward-recipient">${avatar(r,40)}<span class="cell-body cell-title">${esc(roleName(r))}</span><input type="radio" name="targetRoleId" value="${esc(r.id)}" required></label>`).join('');
    openModal('转发给朋友',`<p class="page-note">已选择 ${ids.length} 条消息，请选择接收的朋友并确认发送。</p><section class="section forward-mode"><label class="cell"><span class="cell-body">逐条转发</span><input type="radio" name="mode" value="individual" checked></label><label class="cell"><span class="cell-body">合并转发</span><input type="radio" name="mode" value="merged"></label></section><section class="section">${recipients||'<p class="page-note">暂无可接收转发的朋友</p>'}</section>`,async form=>{
      const {targetRoleId,mode}=formValues(form);await act('message.forward',{ids,targetRoleId,mode});if(!form.isConnected)return;
      closeModal();await afterOverlayBack();if(chatSelection){finishMessageSelection();await afterOverlayBack();}refresh();toast('已转发');
    },'发送');
  }
  function editChatBackground(r){
    let draft=r.chatBackground||'';
    openModal('设置聊天背景','<div class="chat-background-preview"></div><button type="button" class="secondary-btn block-btn" id="pick-chat-background">从相册选择</button><button type="button" class="secondary-btn block-btn" id="clear-chat-background">恢复默认背景</button><input id="chat-background-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>',async form=>{await act('role.save',{id:r.id,chatBackground:draft});if(form.isConnected){closeModal(false);refresh();}},'保存',undefined,'cancel',{lockWhileSaving:true});
    overlay.querySelector('.page-editor').classList.add('chat-background-editor');
    const preview=overlay.querySelector('.chat-background-preview'),file=overlay.querySelector('#chat-background-file');
    function paint() {
      const custom = safeImage(draft);
      preview.toggleAttribute('data-skin-wallpaper', !custom);
      preview.innerHTML = custom ? `<img src="${esc(draft)}" alt="聊天背景预览">` :
        `<p data-skin-wallpaper-name>${esc(window.PipiSkins?.wallpaperName || '默认聊天背景')}</p>`;
    }
    paint();
    overlay.querySelector('#pick-chat-background').onclick=()=>file.click();overlay.querySelector('#clear-chat-background').onclick=()=>{draft='';file.value='';paint();};
    file.onchange=async()=>{if(!file.files?.[0])return;try{const image=await readImage(file.files[0]);if(file.isConnected){draft=image;paint();}}catch(err){toast(err.message);}};
  }
  async function patChat(roleId,target,messageId) {
    const key=roleId+':'+target;if(patRequests.has(key))return;patRequests.add(key);
    try{
      await act('message.pat',{roleId,target});
      if(route.name==='chat'&&route.arg===roleId){refresh();const row=[...view.querySelectorAll('[data-message]')].find(el=>el.dataset.message===messageId);row?.querySelector('[data-chat-avatar]')?.classList.add('avatar-patting');}
    }finally{patRequests.delete(key);}
  }
  function readTextMessage(content) {
    openPage('文字消息',`<article class="message-reader" aria-label="放大阅读消息"><div>${richText(content)}</div></article>`);
    overlay.querySelector('.page-editor').classList.add('text-reader-page');
    overlay.querySelector('.message-reader').onclick=()=>closeModal();
  }
  function cancelAvatarTaps(){for(const tap of avatarTaps.values())clearTimeout(tap.timer);avatarTaps.clear();}
  function chatNearBottom(list){return list.scrollHeight-list.scrollTop-list.clientHeight<100;}
  function trackNewChatMessages(previous,next){
    const list=view.querySelector('#chat-messages');
    if(!previous||route.name!=='chat'||list?.dataset.scrollReady!=='true'||chatNearBottom(list))return;
    const previousIds=new Set(previous.messages.map(message=>message.id));
    for(const message of next.messages){
      if(message.roleId===route.arg&&message.sender!=='user'&&message.meta?.author!=='me'&&!previousIds.has(message.id))newChatMessageIds.add(message.id);
    }
    paintNewChatNotice();
  }
  function paintNewChatNotice(){
    const button=view.querySelector('.chat-new-messages');
    if(button){button.hidden=!newChatMessageIds.size;button.textContent='↓ '+newChatMessageIds.size+' 条新消息';}
  }
  function bindChat() {
    bindComposer();
    const cancelReply=view.querySelector('[data-chat-cancel]');if(cancelReply)cancelReply.onclick=()=>cancelChatReply(cancelReply);
    for(const button of view.querySelectorAll('[data-message-speech]')){
      button.onclick=()=>{
        if(speechSession?.id!==button.dataset.messageSpeech)return;
        if(speechSession.phase==='ready')startSpeechAudio(speechSession);
        else stopSpeech();
      };
    }
    if(speechSession)paintSpeech(speechSession.id);
    const chatList=view.querySelector('#chat-messages'),newMessageNotice=view.querySelector('.chat-new-messages');
    if(chatList&&newMessageNotice){
      paintNewChatNotice();
      chatList.addEventListener('scroll',()=>{
        if(chatList.isConnected&&chatList.dataset.scrollReady==='true'&&newChatMessageIds.size&&chatNearBottom(chatList)){
          newChatMessageIds.clear();paintNewChatNotice();
        }
      },{passive:true});
      newMessageNotice.onclick=()=>{chatList.scrollTop=chatList.scrollHeight;chatScrolls.delete(route.arg);newChatMessageIds.clear();paintNewChatNotice();};
    }
    view.querySelectorAll('[data-select-range]').forEach(el=>el.onclick=()=>selectMessageRange(el.dataset.selectRange));
    view.querySelectorAll('[data-reedit]').forEach(el=>el.onclick=()=>reeditMessage(el.dataset.reedit));
    view.querySelectorAll('[data-transcribe]').forEach(el=>el.onclick=()=>transcribeMessage(el.dataset.transcribe));
    view.querySelectorAll('[data-chat-avatar]').forEach(el=>{
      const origin=route,roleId=route.arg,target=el.dataset.chatAvatar,key=roleId+':'+target;let pendingTap=false,suppress=false,startX=0,startY=0,pressedAt=0;
      const pending=avatarTaps.get(key);if(pending?.route===origin)pending.element=el;
      const cancelTap=()=>{const tap=avatarTaps.get(key);if(tap)clearTimeout(tap.timer);avatarTaps.delete(key);};
      el.onpointerdown=event=>{if(event.button!==0||event.isPrimary===false)return;const tap=avatarTaps.get(key);pendingTap=!!tap&&tap.route===origin&&Date.now()<tap.until;cancelAvatarTaps();suppress=false;startX=event.clientX;startY=event.clientY;pressedAt=Date.now();};
      el.onpointermove=event=>{if(Math.abs(event.clientX-startX)>12||Math.abs(event.clientY-startY)>12){suppress=true;cancelTap();}};
      el.onpointerup=()=>{if(Date.now()-pressedAt>=500){suppress=true;pendingTap=false;cancelTap();}};
      el.onpointercancel=()=>{suppress=true;pendingTap=false;cancelTap();};
      el.oncontextmenu=event=>{event.preventDefault();suppress=true;pendingTap=false;cancelTap();};
      el.onclick=event=>{
        event.preventDefault();if(suppress||modalOpen||chatSelection){pendingTap=false;return;}
        if(event.detail>2||patRequests.has(key)){cancelTap();return;}
        if(pendingTap){pendingTap=false;cancelTap();patChat(roleId,target,el.closest('[data-message]').dataset.message).catch(err=>toast(err.message));return;}
        cancelTap();const clickedPanel=panel,tap={route:origin,element:el,until:Date.now()+280,timer:0};
        const navigate=()=>{if(avatarTaps.get(key)===tap)avatarTaps.delete(key);if(tap.element.isConnected&&route===origin&&!modalOpen&&!chatSelection&&panel===clickedPanel)showView(target==='self'?'profile':'role',target==='self'?undefined:roleId);};
        if(event.detail===0)navigate();else{tap.timer=setTimeout(navigate,280);avatarTaps.set(key,tap);}
      };
      el.ondblclick=event=>event.preventDefault();
    });
    view.querySelectorAll('[data-select-message]').forEach(el=>el.onclick=()=>toggleSelectedMessage(el.dataset.selectMessage));
    view.querySelectorAll('[data-quote-message]').forEach(el=>el.onclick=()=>{if(!chatSelection&&el.dataset.quoteMessage)scrollChat(el.dataset.quoteMessage);});
    // Message-area taps dismiss input, as in the native chat references above.
    // Cards, avatars and long-press targets keep their own click behaviour.
    const list=view.querySelector('#chat-messages');
    if(list){let startX=0,startY=0,moved=false;
      list.onpointerdown=event=>{startX=event.clientX;startY=event.clientY;moved=false;};
      list.onpointermove=event=>{if(Math.abs(event.clientX-startX)>12||Math.abs(event.clientY-startY)>12)moved=true;};
      list.onpointercancel=()=>{moved=true;};
      list.onclick=event=>{
        if(moved){moved=false;return;}
        if(event.target.closest('button,a,input,textarea,select,[contenteditable],[data-bubble],[data-message-menu],[data-retry],[data-speak],[data-play],[data-nav]'))return;
        if(panel==='more'||panel==='emoji')changeComposerMode('');else if(document.activeElement?.closest('.chat-composer'))document.activeElement.blur();
      };
    }
    view.querySelectorAll('[data-bubble]').forEach(el=>{
      let timer, suppress=false, startX=0,startY=0;
      el.oncontextmenu=event=>{event.preventDefault();suppress=true;clearTimeout(timer);if(!chatSelection)messageMenu(el.dataset.bubble,el);};
      el.onpointerdown=event=>{if(event.button!==0)return;startX=event.clientX;startY=event.clientY;suppress=false;if(!chatSelection)timer=setTimeout(()=>{suppress=true;messageMenu(el.dataset.bubble,el);},500);};
      el.onpointermove=event=>{if(Math.abs(event.clientX-startX)>12||Math.abs(event.clientY-startY)>12){suppress=true;clearTimeout(timer);}};
      el.onpointerup=()=>clearTimeout(timer);el.onpointercancel=()=>{suppress=true;clearTimeout(timer);};el.onpointerleave=()=>clearTimeout(timer);
      el.onclick=()=>{if(suppress){suppress=false;return;}if(chatSelection){if(state.messages.find(x=>x.id===el.dataset.bubble)?.sender!=='system')toggleSelectedMessage(el.dataset.bubble);return;}const m=state.messages.find(x=>x.id===el.dataset.bubble);if(!m)return;if(m.type==='voice'){playAudio(m.meta?.audio,m.id);return;}if(['transfer','redpacket'].includes(m.type)){if(m.meta?.transactionId)window.PipiFeatures?.walletTransaction?.(m.meta.transactionId, undefined, { fromChat: true });else toast('未找到这笔交易的详情');return;}if(m.type==='forward'){openForwardDetails(m);return;}if(el.classList.contains('sticker-bubble'))return;if(el.classList.contains('image-bubble')){const src=m.type==='image'?m.content:m.meta?.image;if(safeImage(src)){const images=state.messages.filter(message=>message.roleId===m.roleId&&!(message.type==='image'&&message.meta?.stickerId)).map(message=>({id:message.id,src:message.type==='image'?message.content:message.meta?.image})).filter(item=>safeImage(item.src));lightbox(src,'聊天图片',{images:images.map(item=>item.src),messageIds:images.map(item=>item.id),index:images.findIndex(item=>item.id===m.id)});}}};
      el.ondblclick=event=>{const m=state.messages.find(x=>x.id===el.dataset.bubble);if(suppress||modalOpen||chatSelection||m.sender==='system'||m.type!=='text'||el.classList.contains('image-bubble'))return;event.preventDefault();readTextMessage(m.content);};
      el.onkeydown=event=>{if(chatSelection){if(['Enter',' '].includes(event.key)){event.preventDefault();toggleSelectedMessage(el.dataset.bubble);}else if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))event.preventDefault();return;}if((event.key==='Enter'||event.key===' ')&&(el.classList.contains('payment-card')||state.messages.find(m=>m.id===el.dataset.bubble)?.type==='voice')){event.preventDefault();el.click();return;}if(event.key==='Enter'||event.key===' '||event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){event.preventDefault();messageMenu(el.dataset.bubble,el);}};
    });
    view.querySelectorAll('[data-message-menu]').forEach(el=>el.onclick=()=>messageMenu(el.dataset.messageMenu));
    view.querySelectorAll('[data-retry]').forEach(el=>el.onclick=()=>{const message=state.messages?.find(m=>m.id===el.dataset.retry);confirmDialog('重新发送？',message?.error||'消息发送失败，是否重新发送？',()=>retryMessage(el.dataset.retry),'重新发送');});
    view.querySelectorAll('[data-speak]').forEach(el=>el.onclick=()=>speakMessage(el.dataset.speak,el));
    view.querySelectorAll('[data-play]').forEach(el=>el.onclick=()=>playAudio(state.messages.find(m=>m.id===el.dataset.play)?.meta?.audio,el.dataset.play));
  }
  function bindComposer() {
    if (window.ClassicSocial) window.ClassicChat.decorate(view);
    const form=view.querySelector('#compose-form'); if(!form)return;
    form.querySelectorAll('button:not([type])').forEach(button=>button.type='button');
    form.onsubmit=event=>{event.preventDefault();if(!composeComposing)sendMessage();};
    const input=view.querySelector('#compose-text');
    if(input){
      // Keep the small plain-value interface used by dictation and local checks;
      // the visible editor and Selection/Range remain the single editing surface.
      Object.defineProperties(input,{value:{get:()=>readComposerText(input),set:value=>{input.innerHTML=richText(String(value??''),true);composerSelection={start:String(value??'').length,end:String(value??'').length};if(document.activeElement===input)setComposerSelection(input,composerSelection.start,composerSelection.end);}},selectionStart:{get:()=>readComposerSelection(input).start},selectionEnd:{get:()=>readComposerSelection(input).end}});
      input.setSelectionRange=(start,end=start)=>setComposerSelection(input,start,end);
      // Empty editors already have their CSS height. Measuring them here
      // forces the newly inserted message list through layout before binding.
      if(composeText)resizeComposeInput(input);
      if(composerScroll.input)input.scrollTop=composerScroll.input;
      const rememberSelection=()=>{composerSelection=readComposerSelection(input);};
      const useKeyboard=(afterInput=false)=>{if(panel==='emoji'||panel==='more'){panel='';input.inputMode='text';if(afterInput)requestAnimationFrame(()=>{if(input.isConnected)updateComposer();});else updateComposer();}};
      input.onpointerdown=()=>useKeyboard();
      input.onselect=rememberSelection;input.onkeyup=rememberSelection;input.onclick=()=>{rememberSelection();useKeyboard();};input.onblur=rememberSelection;
      const acceptInput=()=>{composeText=readComposerText(input);rememberSelection();if(!composeComposing)paintComposer(input,document.activeElement===input);resizeComposeInput(input);syncComposerControls();};
      input.oninput=event=>{if(!input.isConnected)return;if(event.isComposing)composeComposing=true;acceptInput();if(composeComposing||composeText.trim())window.PipiEngine?.activity(route.arg);else window.PipiEngine?.stopActivity?.(route.arg);useKeyboard();};
      input.addEventListener('compositionstart',()=>{rememberSelection();rememberComposerEdit();composeComposing=true;window.PipiEngine?.activity(route.arg);syncComposerControls();});
      input.addEventListener('compositionend',()=>{if(!input.isConnected)return;composeComposing=false;composeText=readComposerText(input);rememberSelection();resizeComposeInput(input);syncComposerControls();requestAnimationFrame(()=>{if(composeComposing||!input.isConnected)return;acceptInput();if(recordingSession?.transcript)applyDictationTranscript(recordingSession);if(deferredComposerUpdate){deferredComposerUpdate=false;updateComposer();}});});
      input.onkeydown=event=>{
        if(event.isComposing||composeComposing||event.keyCode===229)return;
        const key=event.key?.toLowerCase();
        if((event.ctrlKey||event.metaKey)&&!event.altKey&&(key==='z'||key==='y')){event.preventDefault();rememberSelection();useKeyboard(true);restoreComposerEdit(key==='y'||event.shiftKey);return;}
        if(event.key==='Enter'){event.preventDefault();rememberSelection();if(event.shiftKey){useKeyboard(true);insertComposerText('\n');}else sendMessage();}
      };
      input.addEventListener('beforeinput',event=>{
        if(event.isComposing||composeComposing||!event.cancelable)return;
        rememberSelection();
        if(/^(insert|delete|history)/.test(event.inputType||''))useKeyboard(true);
        if(event.inputType==='historyUndo'||event.inputType==='historyRedo'){event.preventDefault();restoreComposerEdit(event.inputType==='historyRedo');return;}
        if(event.inputType?.startsWith('format')){event.preventDefault();return;}
        if(event.inputType==='insertParagraph'||event.inputType==='insertLineBreak'){event.preventDefault();if(event.inputType==='insertLineBreak')insertComposerText('\n');else sendMessage();return;}
        const {start,end}=composerSelection;
        if(start===end&&(event.inputType==='deleteContentBackward'||event.inputType==='deleteContentForward')){
          const backwards=event.inputType==='deleteContentBackward',token=emojiEntries().map(e=>e.token).find(t=>backwards?composeText.slice(0,start).endsWith(t):composeText.slice(end).startsWith(t));
          if(token){event.preventDefault();if(!backwards)composerSelection={start,end:end+token.length};deleteComposerText();return;}
        }
        if(/^(insert|delete)/.test(event.inputType||''))rememberComposerEdit();
      });
      input.addEventListener('paste',event=>{event.preventDefault();if(composeComposing||sending)return;rememberSelection();useKeyboard(true);insertComposerText((event.clipboardData?.getData('text/plain')||'').replace(/\r\n?/g,'\n'));});
      input.addEventListener('drop',event=>{event.preventDefault();if(composeComposing||sending)return;rememberSelection();useKeyboard(true);insertComposerText((event.dataTransfer?.getData('text/plain')||'').replace(/\r\n?/g,'\n'));});
      for(const type of ['copy','cut'])input.addEventListener(type,event=>{const selection=readComposerSelection(input);if(selection.start===selection.end)return;event.preventDefault();event.clipboardData?.setData('text/plain',readComposerText(input).slice(selection.start,selection.end));if(type==='cut'&&!composeComposing&&!sending){composerSelection=selection;useKeyboard(true);insertComposerText('');}});
    }
    const emojiScroll=view.querySelector('.emoji-scroll');if(emojiScroll)emojiScroll.scrollTop=composerScroll.emoji;
    view.querySelectorAll('[data-emoji-page]').forEach(el=>el.onclick=()=>{emojiPage=Number(el.dataset.emojiPage);updateComposer();});
    view.querySelectorAll('[data-emoji]').forEach(el=>el.onclick=()=>{const token=el.dataset.emoji;insertComposerText(token);act('emoji.use',{token}).then(()=>{if(panel==='emoji'&&route.name==='chat')updateComposer();}).catch(err=>toast(err.message));});
    view.querySelectorAll('[data-emoji-tab]').forEach(el=>el.onclick=()=>{emojiTab=el.dataset.emojiTab;updateComposer();if(emojiTab==='search')view.querySelector('#emoji-search')?.focus();});
    const emojiInput=view.querySelector('#emoji-search');if(emojiInput)bindFilterInput(emojiInput,value=>{emojiSearch=value;},updateComposer);
    view.querySelectorAll('[data-sticker]').forEach(el=>el.onclick=()=>{const sticker=state.stickers?.find(s=>s.id===el.dataset.sticker);if(sticker&&safeImage(sticker.image)){composeImage=sticker.image;composeStickerId=sticker.id;sendMessage(true);}});
    const stickerFile=view.querySelector('#sticker-file');if(stickerFile)stickerFile.onchange=()=>uploadStickers(stickerFile);
    const drag=view.querySelector('.emoji-drag-handle');if(drag){let startY=0,height=0;const resize=delta=>{const max=Math.max(220,document.querySelector('.phone-shell').clientHeight-180);emojiExpandedHeight=Math.max(220,Math.min(max,height+delta));const anchor=captureChatLayout();view.querySelector('.emoji-board').style.height=emojiExpandedHeight+'px';restoreChatLayout(anchor);};drag.onpointerdown=e=>{startY=e.clientY;height=view.querySelector('.emoji-board').clientHeight;drag.setPointerCapture(e.pointerId);};drag.onpointermove=e=>{if(drag.hasPointerCapture(e.pointerId))resize(startY-e.clientY);};drag.onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();height=view.querySelector('.emoji-board').clientHeight;resize(e.key==='ArrowUp'?30:-30);}};}
    const file=view.querySelector('#chat-image-file'); if(file)file.onchange=async()=>{if(!file.files?.[0])return;const roleId=route.arg;try{const data=await readImage(file.files[0]);if(!file.isConnected||route.name!=='chat'||route.arg!==roleId)return;composeImage=data;composeStickerId='';panel='';updateComposer();if(!composeText.trim())sendMessage();}catch(err){toast(err.message);}};
    const record=view.querySelector('[data-record]');
    if(record)window.PipiVoiceHold.bind({button:record,host:view.closest('.phone-shell'),
      begin:controls=>startRecording('hold',controls),onError:error=>toast(error.message)});
    view.querySelectorAll('.more-pages,.emoji-pages').forEach(el=>{let x=0,y=0;el.onpointerdown=e=>{x=e.clientX;y=e.clientY;};el.onpointerup=e=>{if(Math.abs(e.clientX-x)>45&&Math.abs(e.clientY-y)<40){if(el.classList.contains('more-pages'))morePage=e.clientX<x?1:0;else emojiPage=Math.max(0,Math.min(Math.ceil((window.PipiEmoji?.length||48)/24)-1,emojiPage+(e.clientX<x?1:-1)));updateComposer();}};});
    syncComposerControls();
  }
  async function sendMessage(keepEmoji=false) {
    if(composeComposing||recordingSession||(!composeText.trim()&&!composeImage))return;
    const r=roleById(route.arg);if(!r)return;
    const draft={text:composeText,image:composeImage,stickerId:composeStickerId,quote:quoteId},text=draft.text.trim(),image=draft.image,quote=state.messages?.find(m=>m.id===draft.quote);
    const restoreEmoji=keepEmoji&&panel==='emoji';
    const sendToken={},historyBeforeSend=composerHistories.get(r.id);
    pendingDraftSends.set(r.id,sendToken);
    window.PipiEngine?.resetActivity(r.id);
    composeText='';composeImage='';composeStickerId='';quoteId='';composerSelection={start:0,end:0};drafts.delete(r.id);composerHistories.delete(r.id);
    panel=restoreEmoji?'emoji':'';forceBottomRole=r.id;chatScrolls.delete(r.id);updateComposer();
    try {
      const result=await api('/api/chat',{roleId:r.id,text,image:image||undefined,stickerId:draft.stickerId||undefined,quoteId:quote?.id,requestId:crypto.randomUUID()});receiveState(result.state);if(result.notice)toast(result.notice);
    } catch(err) {
      toast(err.message);
      if(!err.state&&pendingDraftSends.get(r.id)===sendToken&&!composerHistories.has(r.id)){
        const saved=drafts.get(r.id),active=route.name==='chat'&&route.arg===r.id;
        const hasNewDraft=saved&&(saved.text||saved.image||saved.stickerId||saved.quote)||active&&(composeText||composeImage||composeStickerId||quoteId);
        if(!hasNewDraft){
          if(historyBeforeSend)composerHistories.set(r.id,historyBeforeSend);
          if(active){composeText=draft.text;composeImage=draft.image;composeStickerId=draft.stickerId;quoteId=draft.quote;composerSelection={start:draft.text.length,end:draft.text.length};updateComposer();}
          else drafts.set(r.id,{...saved,...draft});
        }
      }
      if(err.state)refresh();
    } finally {
      if(pendingDraftSends.get(r.id)===sendToken)pendingDraftSends.delete(r.id);
    }
  }
  async function retryMessage(messageId) {
    if(sending)return; sending=true;sendingRoleId=state.messages?.find(m=>m.id===messageId)?.roleId||'';refresh();
    try {const result=await api('/api/chat/retry',{messageId});setState(result.state);}catch(err){toast(err.message);if(!err.state){try{const latest=await api('/api/state');setState(latest.state||latest);}catch{}}}finally{sending=false;sendingRoleId='';refresh();}
  }
  function measureSafeInsets(shell){const probe=document.createElement('span');probe.style.cssText='position:absolute;visibility:hidden;pointer-events:none;box-sizing:content-box;width:0;height:0;padding:var(--safe-top,0px) var(--safe-right,0px) var(--safe-bottom,0px) var(--safe-left,0px)';shell.append(probe);const style=getComputedStyle(probe),insets={top:parseFloat(style.paddingTop)||0,right:parseFloat(style.paddingRight)||0,bottom:parseFloat(style.paddingBottom)||0,left:parseFloat(style.paddingLeft)||0};probe.remove();return insets;}
  // Original line drawings for the message menu (GPL-3.0-only).
  const bubbleMenuIcons={'添加到表情':'<circle cx="12" cy="12" r="8"/><path d="M8 14a4 4 0 0 0 8 0M9 9h.01M15 9h.01"/>','复制': '<path d="M8.500 8.500h10v11h-10z"/><path d="M15.500 8.500v-4h-10v11h3"/>', '转发': '<path d="M13.500 5.500 20 11l-6.500 5.500v-3.300c-4.500-.200-7.500 1.300-9.500 4.300.600-5.200 3.800-8.300 9.500-8.700Z"/>', '收藏': '<path d="m12 3.500 7.500 4.300v8.400L12 20.500l-7.500-4.300V7.800Z"/><path d="M4.500 7.800 12 12l7.500-4.200M12 12v8.500"/>', '删除': '<path d="M5 7.500h14M9.500 7.500V5h5v2.500M6.500 7.500l.800 12h9.400l.800-12M10 10.500v6M14 10.500v6"/>', '多选': '<path d="M9.500 7h10M9.500 12h10M9.500 17h10"/><path d="m4 6.800 1.200 1.200 2-2.300M4 11.800 5.200 13l2-2.300M4 16.800 5.200 18l2-2.300"/>', '引用': '<path d="M5 12.500c0-3.300 1.500-5.500 4.500-6.500M5 12.500h4.500V17H5ZM13.500 12.500c0-3.300 1.500-5.500 4.500-6.500M13.500 12.500H18V17h-4.500Z"/>', '撤回': '<path d="M9 5.500 4.500 10 9 14.500"/><path d="M4.500 10h9a5.500 5.500 0 0 1 0 11h-5"/>', '朗读': '<path d="M4.500 9.500h3.500l4.500-4v13l-4.500-4H4.500Z"/><path d="M15.500 9a4.500 4.500 0 0 1 0 6M17.800 6.500a8 8 0 0 1 0 11"/>', '播放语音': '<path d="M4.500 9.500h3.500l4.500-4v13l-4.500-4H4.500Z"/><path d="M15.500 9a4.500 4.500 0 0 1 0 6M17.800 6.500a8 8 0 0 1 0 11"/>', '停止播放':'<rect x="6" y="6" width="12" height="12" rx="2"/>', '转文字':'<path d="M3 5.5h12v10H9l-3.5 3v-3H3zM15 9h6v11h-8v-3m.5-4.5h6m-3-1v1m-1.8.5c.3 2 1.7 3.6 4 4.5m-1-4.5c0 1.8-1.6 3.6-3.6 4.5"/>', '重新发送': '<path d="M19 12a7 7 0 1 1-2.200-5.100"/><path d="M19.500 4.500v4h-4"/>'};
  function messageMenu(id,anchor) {
    const m=state.messages?.find(x=>x.id===id);if(!m)return;
    const ordinary=m.sender!=='system',actions=[];
    if(ordinary&&['text','image','voice','forward'].includes(m.type))actions.push({label:'引用',icon:icons.quote,run:()=>{quoteId=id;panel='';updateComposer();view.querySelector('#compose-text')?.focus();}});
    if(ordinary&&m.type==='text')actions.push({label:'复制',icon:icons.copy,run:()=>copyText(m.content)});
    if(ordinary&&m.status==='sent'&&['text','image','voice','forward'].includes(m.type))actions.push({label:'转发',run:()=>forwardMessages([id])});
    if(ordinary&&['text','image','voice'].includes(m.type))actions.push({label:'收藏',icon:icons.messageFavorites,run:async()=>{await act('message.favorite',{id});toast('已加入收藏');}});
    if(m.type==='image'&&m.meta?.stickerId&&safeImage(m.content))actions.push({label:'添加到表情',run:async()=>{await act('sticker.add',{image:m.content});toast('已添加到表情');}});
    if(ordinary)actions.push({label:'多选',run:()=>startMessageSelection(id)});
    if(m.type==='voice'){
      if(m.meta?.audio){
        if(speechSession?.voice&&speechSession.id===id){
          actions.push({label:'停止播放',run:()=>{if(speechSession?.id===id)stopSpeech();}});
        }else actions.push({label:'播放语音',run:()=>playAudio(m.meta.audio,id)});
      }
      const expanded=Boolean(transcriptViews.get(id)?.expanded);
      actions.push({label:expanded?'收起文字':'转文字',iconName:'转文字',run:()=>transcribeMessage(id,!expanded)});
    }
    if(m.type==='text'&&m.sender==='assistant'&&m.status!=='demo')actions.push({label:'朗读',icon:icons.voice,run:()=>speakMessage(id)});
    if(m.status==='error'&&m.sender==='user')actions.push({label:'重新发送',icon:icons.send,run:()=>retryMessage(id)});
    if(Date.now()-Number(m.createdAt)<=120000&&((m.sender==='user'&&m.status==='sent'&&['text','image','voice','forward'].includes(m.type))||(m.meta?.kind==='pat'&&m.meta.author==='me')))actions.push({label:'撤回',run:async()=>{await act('message.recall',{id});refresh();}});
    actions.push({label:'删除',icon:icons.trash,danger:true,run:()=>confirmDialog('删除这条消息？','删除后无法恢复。',()=>act('message.delete',{id}),'删除')});
    const menuOrder=['播放语音','停止播放','转文字','收起文字','复制','转发','收藏','添加到表情','删除','多选','引用','撤回','朗读','重新发送'];actions.sort((x,y)=>menuOrder.indexOf(x.label)-menuOrder.indexOf(y.label));
    const target=anchor||[...view.querySelectorAll('[data-bubble]')].find(el=>el.dataset.bubble===id);if(!target||!actions.length)return;
    modalReturnFocus=target;modalOpen=true;trackModalHistory();const rect=target.getBoundingClientRect(),shellElement=document.querySelector('.phone-shell'),shell=shellElement.getBoundingClientRect(),insets=measureSafeInsets(shellElement);
    overlay.innerHTML=`<div class="menu-dismiss" data-close></div><div class="bubble-menu" role="menu" aria-label="消息操作">${actions.map((a,i)=>`<button role="menuitem" class="${a.danger?'danger':''}" data-bubble-action="${i}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${bubbleMenuIcons[a.iconName||a.label]||''}</svg><span>${esc(a.label)}</span></button>`).join('')}</div>`;
    const menu=overlay.querySelector('.bubble-menu'),width=Math.min(Math.min(actions.length,5)*60+16,shell.width-insets.left-insets.right-24);menu.style.width=Math.max(1,width)+'px';menu.style.setProperty('--menu-columns',Math.min(actions.length,5));if(pressActive)holdMenuUntilRelease();menu.style.left=Math.max(insets.left+12,Math.min(shell.width-insets.right-width-12,rect.left-shell.left+rect.width/2-width/2))+'px';
    if(m.type==='voice')menu.style.setProperty('--bubble-tip',Math.max(12,Math.min(width-12,rect.left-shell.left+rect.width/2-parseFloat(menu.style.left)))+'px');
    menu.style.maxHeight=Math.max(44,shell.height-insets.top-insets.bottom-16)+'px';menu.style.overflowY='visible';
    if(menu.scrollHeight>menu.clientHeight)menu.style.overflowY='auto';const h=menu.getBoundingClientRect().height,minTop=insets.top+8,maxTop=shell.height-insets.bottom-h-8,above=rect.top-shell.top-h-12,below=above<minTop;menu.dataset.placement=below?'below':'above';menu.style.top=Math.max(minTop,Math.min(maxTop,below?rect.bottom-shell.top+12:above))+'px';
    overlay.querySelector('[data-close]').onclick=closeModal;overlay.querySelectorAll('[data-bubble-action]').forEach(el=>el.onclick=async()=>{const a=actions[Number(el.dataset.bubbleAction)];closeModal();try{await a.run();}catch(err){toast(err.message);}});menu.querySelector('button')?.focus({preventScroll:true});
  }
  async function copyText(value) {
    try{await navigator.clipboard.writeText(String(value));toast('已复制');}
    catch{const input=document.createElement('textarea');input.value=String(value);input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();const copied=document.execCommand('copy');input.remove();toast(copied?'已复制':'浏览器不支持复制，请手动选择文本');}
  }
  function reeditMessage(id){
    const message=state.messages.find(m=>m.id===id);if(!message?.meta?.recalledText)return;
    const restore=()=>{rememberComposerEdit();composeText=message.meta.recalledText;composerSelection={start:composeText.length,end:composeText.length};panel='';syncComposerDraft();view.querySelector('#compose-text')?.focus();};
    if(composeText.trim())confirmDialog('替换当前草稿？','把撤回的文字放回输入框，之后可修改再发送。',restore,'替换');else restore();
  }
  function paintTranscript(message){
    if(!message||route.name!=='chat'||route.arg!==message.roleId||message.type!=='voice')return;
    const body=view.querySelector(`[data-message="${CSS.escape(message.id)}"] .voice-body`);
    if(!body)return;
    const anchor=captureChatLayout();
    body.querySelector('.voice-transcript')?.remove();
    const html=renderVoiceTranscript(message);
    if(html){
      const next=body.querySelector('.message-range,.message-failure');
      if(next)next.insertAdjacentHTML('beforebegin',html);else body.insertAdjacentHTML('beforeend',html);
      const retry=body.querySelector('[data-transcribe]');if(retry)retry.onclick=()=>transcribeMessage(message.id);
    }
    restoreChatLayout(anchor);
  }
  async function transcribeMessage(id,expanded=true){
    await afterOverlayBack();
    const message=state.messages.find(m=>m.id===id);
    if(message?.type!=='voice'||route.name!=='chat'||route.arg!==message.roleId)return;
    const ui=transcriptViews.get(id)||{};
    transcriptViews.set(id,ui);ui.expanded=expanded;
    if(!expanded||message.meta?.transcript||ui.phase==='loading'){paintTranscript(message);return;}
    if(message.sender==='user'&&message.status==='pending'){
      // The reply engine is already responsible for understanding this recording.
      ui.phase='waiting';delete ui.error;paintTranscript(message);return;
    }
    if(!window.PipiEngine?.serviceReady('voiceUnderstanding')){ui.phase='error';ui.error='请先在模型设置中选择语音条理解模型。';paintTranscript(message);return;}
    ui.phase='loading';delete ui.error;paintTranscript(message);
    try{
      const result=await api('/api/voice/transcribe',{messageId:id});
      if(result.state)setState(result.state);
      ui.phase='success';ui.demo=!!result.demo;
    }catch(err){ui.phase='error';ui.error=err.message;}
    paintTranscript(state.messages.find(m=>m.id===id));
  }
  function openForwardDetails(message){
    const entries=message.meta?.entries||[];
    openNestedPage('聊天记录',`<div class="forward-detail">${entries.map((entry,index)=>`<article class="forward-entry"><div class="forward-entry-author">${esc(entry.senderName)}</div>${entry.type==='image'&&safeImage(entry.content)?`<button type="button" class="forward-entry-image" data-forward-image="${index}"><img src="${esc(entry.content)}" alt="转发的图片"></button>`:entry.type==='voice'?`<button type="button" class="forward-entry-voice" data-forward-voice="${index}">${icons.voiceWave} ${Math.max(1,Math.round((entry.meta?.durationMs||1000)/1000))}″</button>${entry.meta?.transcript?`<p>${esc(entry.meta.transcript)}</p>${entry.meta.transcriptSource==='demo'?'<small class="transcript-demo">演示预设文字，非真实识别结果</small>':''}`:''}`:entry.type==='forward'?`<button type="button" class="forward-entry-nested" data-forward-nested="${index}">聊天记录 · ${entry.meta?.entries?.length||0} 条 ${icons.chevron}</button>`:`<p>${richText(entry.content)}</p>${safeImage(entry.meta?.image)?`<button type="button" class="forward-entry-image" data-forward-image="${index}"><img src="${esc(entry.meta.image)}" alt="转发的附图"></button>`:''}`}${entry.meta?.quote?renderMessageQuote({...entry.meta.quote,messageId:''},{}):''}</article>`).join('')}</div>`,null);
    overlay.querySelectorAll('[data-forward-image]').forEach(el=>el.onclick=()=>{const selectedIndex=Number(el.dataset.forwardImage),entry=entries[selectedIndex],images=entries.map((item,entryIndex)=>({entryIndex,src:item.type==='image'?item.content:item.meta?.image})).filter(item=>safeImage(item.src)),src=entry.type==='image'?entry.content:entry.meta.image;lightbox(src,'转发的图片',{images:images.map(item=>item.src),index:images.findIndex(item=>item.entryIndex===selectedIndex)});});
    overlay.querySelectorAll('[data-forward-voice]').forEach(el=>el.onclick=()=>playAudio(entries[Number(el.dataset.forwardVoice)].meta?.audio));
    overlay.querySelectorAll('[data-forward-nested]').forEach(el=>el.onclick=()=>openForwardDetails(entries[Number(el.dataset.forwardNested)]));
  }
  function lightbox(src,alt='图片',options={}) {
    if(!safeImage(src))return;
    let images=(options.images||[src]).filter(safeImage);if(!images.includes(src))images=[src];
    let index=Number.isInteger(options.index)&&images[options.index]===src?options.index:images.indexOf(src),downloadName='',scale=1,x=0,y=0,startX=0,startY=0,startPanX=0,startPanY=0,pinchStart=0,pinchScale=1,pinched=false;
    const pointers=new Map(),parent=captureModalParent();modalCloseCallback=parent?()=>restoreModalParent(parent):null;modalReturnFocus=document.activeElement;modalOpen=true;trackModalHistory(!!parent);
    overlay.innerHTML=`<div class="lightbox image-viewer" role="dialog" aria-modal="true" aria-label="查看图片"><div class="image-stage" tabindex="0" aria-label="图片，可双击放大或用下方按钮缩放"><img alt="${esc(alt)}" draggable="false"></div><button class="lightbox-close" aria-label="关闭图片">${icons.close}</button><button class="image-more" aria-label="图片操作" aria-expanded="false" aria-controls="image-actions">${icons.more}</button><div id="image-actions" class="image-actions" role="menu" hidden><button type="button" data-image-forward role="menuitem" hidden>转发给朋友</button><button type="button" data-image-favorite role="menuitem" hidden>收藏</button><button type="button" class="image-save" role="menuitem">保存图片</button><button type="button" data-image-menu-cancel role="menuitem">取消</button></div><span class="image-counter" aria-live="polite"></span><div class="lightbox-controls"><div class="image-gallery-controls"><button type="button" data-image-prev aria-label="上一张图片">‹</button><button type="button" data-image-next aria-label="下一张图片">›</button></div><div class="image-zoom-controls"><button type="button" data-image-out aria-label="缩小图片">−</button><button type="button" data-image-reset aria-label="恢复原始大小">100%</button><button type="button" data-image-in aria-label="放大图片">＋</button></div></div></div>`;
    mountModalParent(parent);
    const box=overlay.querySelector(':scope > .image-viewer'),stage=box.querySelector('.image-stage'),img=stage.querySelector('img'),reset=box.querySelector('[data-image-reset]'),save=box.querySelector('.image-save');
    const menu=box.querySelector('.image-actions'),more=box.querySelector('.image-more'),forward=box.querySelector('[data-image-forward]'),favorite=box.querySelector('[data-image-favorite]');
    const hideMenu=()=>{menu.hidden=true;more.setAttribute('aria-expanded','false');};
    more.onclick=()=>{menu.hidden=!menu.hidden;more.setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden)menu.querySelector('button:not([hidden])').focus({preventScroll:true});};
    box.querySelector('[data-image-menu-cancel]').onclick=()=>{hideMenu();more.focus({preventScroll:true});};stage.onclick=hideMenu;
    const transform=()=>{img.style.transform=`translate(${x}px,${y}px) scale(${scale})`;reset.textContent=Math.round(scale*100)+'%';};
    const zoom=value=>{scale=Math.max(1,Math.min(4,value));if(scale===1){x=0;y=0;}transform();};
    const paint=()=>{scale=1;x=0;y=0;hideMenu();img.src=images[index];box.querySelector('.image-counter').textContent=images.length>1?`${index+1} / ${images.length}`:'';box.querySelector('[data-image-prev]').disabled=index===0;box.querySelector('[data-image-next]').disabled=index===images.length-1;const message=state.messages?.find(m=>m.id===options.messageIds?.[index]);forward.hidden=!message||message.sender==='system'||message.status!=='sent';favorite.hidden=!message||message.sender==='system';const extMatch=/^data:image\/([^;]+)/.exec(images[index])||/\.([a-z0-9]+)$/i.exec(images[index]);downloadName=`pipi-image-${index+1}.${({png:'png',jpeg:'jpg',jpg:'jpg',webp:'webp',gif:'gif'})[extMatch?.[1]?.toLowerCase()]||'png'}`;transform();};
    save.onclick=async()=>{hideMenu();const data=images[index];let blob;if(data.startsWith('data:')){const comma=data.indexOf(','),binary=atob(data.slice(comma+1)),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);blob=new Blob([bytes],{type:data.slice(5,data.indexOf(';'))});}else{const resp=await fetch(data,{credentials:'same-origin'});blob=await resp.blob();}const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=downloadName;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    forward.onclick=async()=>{const id=options.messageIds[index];closeModal(false);await afterOverlayBack();await forwardMessages([id]);};
    favorite.onclick=async()=>{hideMenu();try{await act('message.favorite',{id:options.messageIds[index]});toast('已加入收藏');}catch(err){toast(err.message);}};
    const move=step=>{const next=index+step;if(next>=0&&next<images.length){index=next;paint();}};
    box.querySelector('.lightbox-close').onclick=closeModal;box.querySelector('[data-image-prev]').onclick=()=>move(-1);box.querySelector('[data-image-next]').onclick=()=>move(1);box.querySelector('[data-image-in]').onclick=()=>zoom(scale+.5);box.querySelector('[data-image-out]').onclick=()=>zoom(scale-.5);reset.onclick=()=>zoom(1);
    stage.ondblclick=()=>zoom(scale>1?1:2);
    box.onkeydown=event=>{if(event.key==='ArrowLeft'){event.preventDefault();move(-1);}if(event.key==='ArrowRight'){event.preventDefault();move(1);}if(event.key==='+'||event.key==='='){event.preventDefault();zoom(scale+.5);}if(event.key==='-'){event.preventDefault();zoom(scale-.5);}};
    stage.addEventListener('wheel',event=>{event.preventDefault();zoom(scale+(event.deltaY<0?.25:-.25));},{passive:false});
    const distance=()=>{const [a,b]=[...pointers.values()];return Math.hypot(a.x-b.x,a.y-b.y);};
    stage.onpointerdown=event=>{if(event.button!==0)return;stage.setPointerCapture(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(pointers.size===1){startX=event.clientX;startY=event.clientY;startPanX=x;startPanY=y;pinched=false;}else if(pointers.size===2){pinchStart=distance();pinchScale=scale;pinched=true;}};
    stage.onpointermove=event=>{if(!pointers.has(event.pointerId))return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(pointers.size===2){zoom(pinchScale*distance()/pinchStart);}else if(scale>1){x=startPanX+event.clientX-startX;y=startPanY+event.clientY-startY;transform();}};
    stage.onpointerup=event=>{pointers.delete(event.pointerId);if(pointers.size===1){const remaining=[...pointers.values()][0];startX=remaining.x;startY=remaining.y;startPanX=x;startPanY=y;}if(!pointers.size&&!pinched&&scale===1&&Math.abs(event.clientX-startX)>45&&Math.abs(event.clientY-startY)<70)move(event.clientX>startX?-1:1);};
    stage.onpointercancel=()=>pointers.clear();paint();box.querySelector('.lightbox-close').focus({preventScroll:true});
  }
  async function readImage(file,convertSticker=false) {
    if(!file)throw new Error('请选择一张图片');
    const native=['image/png','image/jpeg','image/webp','image/gif'].includes(file.type);
    if(!native&&!(convertSticker&&['image/bmp','image/x-ms-bmp','image/avif'].includes(file.type)))throw new Error(convertSticker?'支持 PNG、JPG、WebP、GIF、BMP 和 AVIF 图片':'支持 PNG、JPEG、WebP 和 GIF 图片，不支持 SVG');
    if(file.size>(convertSticker?20:5)*1024*1024)throw new Error('图片不能超过 '+(convertSticker?'20':'5')+' MB');
    let result=file,animated=file.type==='image/gif';
    if(convertSticker&&['image/png','image/webp','image/avif'].includes(file.type)){
      const bytes=await file.arrayBuffer(),data=new DataView(bytes),tag=at=>String.fromCharCode(...new Uint8Array(bytes,at,4));
      if(file.type==='image/avif'){
        if(data.byteLength>=8&&tag(4)==='ftyp')for(let at=8;at+4<=Math.min(data.byteLength,data.getUint32(0));at+=4)if(tag(at)==='avis')animated=true;
      }else{
        const webp=file.type==='image/webp';
        for(let at=webp?12:8;at+8<=data.byteLength;){
          if(tag(at+(webp?0:4))===(webp?'ANIM':'acTL')){animated=true;break;}
          const size=data.getUint32(at+(webp?4:0),webp);at+=size+(webp?8+(size%2):12);
        }
      }
    }
    if(convertSticker&&!animated){
      let bitmap;
      try{bitmap=await createImageBitmap(file);}catch{throw new Error('无法读取 '+file.name+'，请换用 PNG、JPG、WebP 或 GIF');}
      try{
        const ratio=Math.min(1,1024/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
        canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
        const compressed=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.9));
        if(!compressed)throw new Error(file.name+' 压缩失败，请重新选择图片');
        if(!native||compressed.size<file.size)result=compressed;
      }finally{bitmap.close();}
    }
    if(animated&&!native)throw new Error('动态 AVIF 暂不支持，请换用 GIF 或动态 WebP');
    if(result.size>5*1024*1024)throw new Error(animated?'动图不能超过 5 MB':file.name+' 压缩后仍超过 5 MB，请缩小图片后上传');
    return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>safeImage(reader.result)?resolve(reader.result):reject(new Error('图片格式无法读取'));reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(result);});
  }
  const profileImageAccept='image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,.bmp,.avif';
  async function readProfileImage(file){
    if(!file)throw new Error('请选择一张图片');
    if(file.size>5*1024*1024)throw new Error('图片不能超过 5 MB');
    const header=new Uint8Array(await file.slice(0,32).arrayBuffer());
    const tag=(start,end)=>String.fromCharCode(...header.subarray(start,end));
    let mime;
    if(header.length>=24&&tag(0,8)==='\x89PNG\r\n\x1a\n'&&tag(12,16)==='IHDR')mime='image/png';
    else if(header[0]===255&&header[1]===216)mime='image/jpeg';
    else if(header.length>=13&&['GIF87a','GIF89a'].includes(tag(0,6)))mime='image/gif';
    else if(header.length>=16&&tag(0,4)==='RIFF'&&tag(8,12)==='WEBP')mime='image/webp';
    else if(tag(0,2)==='BM')mime='image/bmp';
    else if(tag(4,8)==='ftyp'&&(/^(avif|avis)$/.test(tag(8,12))||file.type==='image/avif'))mime='image/avif';
    else throw new Error('无法识别这张图片，请选择 PNG、JPG、WebP、GIF、BMP 或 AVIF');
    const typed=new File([file],file.name,{type:mime});
    if(mime==='image/avif'||mime==='image/bmp')return readImage(typed,true);
    if(mime!=='image/jpeg'||new DataView(await file.slice(-2).arrayBuffer()).getUint16(0)===0xffd9){
      const source=await readImage(typed),preview=new Image();
      preview.src=source;
      try{await preview.decode();}catch{throw new Error('无法读取这张 '+mime.slice(6).toUpperCase()+' 图片，请重新选图');}
      return source;
    }

    // A browser may preview a JPEG with extra bytes after its end marker.
    let bitmap;
    try{bitmap=await createImageBitmap(typed);}catch{throw new Error('这张图片无法读取，请重新选图');}
    try{
      const ratio=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(bitmap.width*ratio));
      canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
      canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
      const converted=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));
      if(!converted)throw new Error('图片转换失败，请重新选图');
      return await readImage(converted);
    }finally{bitmap.close();}
  }
  async function uploadStickers(file){
    if(file.disabled||!file.files.length)return;
    const origin=route;
    file.disabled=true;
    try{
      const files=[...file.files],images=[];
      for(const item of files)images.push(await readImage(item,true));
      await act('sticker.add',{images,names:files.map(item=>item.name.replace(/\.[^.]+$/,'').slice(0,100))});
      if(route===origin){if(route.name==='stickers')refresh();else if(route.name==='chat')updateComposer();}
      toast('表情已添加');
    }catch(err){toast(err.message);}finally{file.disabled=false;file.value='';}
  }
  function paintSpeech(id){
    if(!id)return;
    const selector=CSS.escape(id),voice=view.querySelector(`.voice-body > [data-bubble="${selector}"]`);
    const phase=speechSession?.id===id?speechSession.phase:'';
    if(voice){
      const playing=phase==='playing';
      voice.classList.toggle('voice-playing',playing);
      voice.setAttribute('aria-pressed',String(playing));
    }
    const button=view.querySelector(`[data-message-speech="${selector}"]`);if(!button)return;
    button.hidden=!phase;
    button.dataset.phase=phase;
    button.setAttribute('aria-label',({synthesizing:'合成中，点击取消朗读',playing:'停止朗读',ready:'播放朗读'})[phase]||'朗读');
  }
  function stopSpeech(){
    const session=speechSession;if(!session)return;
    speechSession=null;
    session.audio?.pause();
    session.audio?.remove();
    paintSpeech(session.id);
  }
  async function startSpeechAudio(session){
    if(!safeAudio(session.data)){stopSpeech();toast('没有可播放的安全音频');return;}
    const audio=session.audio??=new Audio(session.data);
    if(!audio.isConnected){audio.hidden=true;document.body.append(audio);}
    audio.onended=()=>{if(speechSession===session)stopSpeech();};
    audio.onplaying=()=>{if(speechSession===session){session.phase='playing';paintSpeech(session.id);}};
    audio.onerror=()=>{if(speechSession===session){stopSpeech();toast('这条音频无法解码，可能已损坏或格式不受支持');}};
    try{await audio.play();}
    catch(error){
      if(speechSession!==session)return;
      if(error.name==='NotAllowedError'&&!session.voice){session.phase='ready';paintSpeech(session.id);return;}
      stopSpeech();toast(error.name==='NotAllowedError'?'浏览器阻止了播放，请允许此网页播放声音':'音频播放失败，请重试');
    }
  }
  async function speakMessage(id) {
    const m=state.messages?.find(x=>x.id===id);if(!m)return;
    if(speechSession?.id===id){stopSpeech();return;}
    if(!m.meta?.audio&&!window.PipiEngine?.serviceReady('tts')){toast('请先在「设置 → 小手机 → 模型」配置文字转语音');return;}
    stopSpeech();
    const session={id,phase:'synthesizing',data:m.meta?.audio};speechSession=session;paintSpeech(id);
    try{
      if(!session.data){
        const result=await api('/api/voice/speak',{messageId:id});
        if(result.state)setState(result.state);
        if(speechSession!==session)return;
        session.data=result.audio;
      }
      await startSpeechAudio(session);
    }catch(error){if(speechSession===session){stopSpeech();toast(error.message);}}
  }
  function playAudio(data,id) {
    if(!safeAudio(data)){toast('这条语音没有可播放的音频');return;}
    if(speechSession?.voice&&speechSession.id===id&&speechSession.data===data){stopSpeech();return;}
    stopSpeech();
    const session={id,data,voice:true};speechSession=session;
    return startSpeechAudio(session);
  }
  function syncDictationState(){
    const session=recordingSession?.mode==='dictation'?recordingSession:null,phase=session?.phase||'',button=view.querySelector('.compose-dictation'),status=view.querySelector('.dictation-status');
    const hold=view.querySelector('[data-record]');
    if(hold){
      hold.disabled=!!(sending||(recordingSession&&recordingSession.mode!=='hold'));
      hold.classList.toggle('recording',recordingSession?.mode==='hold'&&recordingSession.phase==='recording');
      hold.textContent=recordingSession?.mode==='text'?'正在转文字…':'按住 说话';
    }
    if(button){button.classList.toggle('recording',phase==='recording');button.classList.toggle('transcribing',!!dictationBusy);button.classList.toggle('requesting',phase==='requesting');button.setAttribute('aria-pressed',String(phase==='recording'));button.disabled=!!(sending||dictationBusy);button.setAttribute('aria-label',phase==='recording'?'停止录音并转换为文字':phase==='requesting'?'取消语音输入':dictationBusy?'正在转换为文字':'语音转文字');}
    if(status){status.hidden=!session;const text=status.querySelector('span');if(text)text.textContent=phase==='requesting'?'正在请求麦克风…':phase==='recording'?'正在听，点完成转换为文字':phase==='awaiting-composition'?'识别完成，结束文字输入后加入草稿':'正在转换为文字…';status.querySelector('[data-action=finish-dictation]').disabled=phase!=='recording';}
  }
  function releaseMicrophone(session){
    clearTimeout(session.timer);
    session.stream?.getTracks().forEach(track=>track.stop());
    session.stream=null;
    if(session.volumeContext){void session.volumeContext.close();session.volumeContext=null;}
  }
  function releaseRecordingSession(session){
    releaseMicrophone(session);
    session.hold?.dismiss();
    if(recordingSession!==session)return;
    recordingSession=null;dictationBusy=false;syncComposerControls();
    if(session.hold&&pendingRender)requestAnimationFrame(()=>{
      if(pendingRender&&!recordingSession&&!modalOpen&&route.name==='chat'&&route.arg===session.roleId)refresh();
    });
  }
  function applyDictationTranscript(session){
    if(recordingSession!==session||session.cancelled||!session.transcript)return;
    if(route.name!=='chat'||route.arg!==session.roleId||document.hidden){session.cancelled=true;releaseRecordingSession(session);return;}
    if(composeComposing){session.phase='awaiting-composition';syncDictationState();return;}
    insertComposerText(session.transcript);releaseRecordingSession(session);
  }
  async function finishRecording(session){
    if(session.cancelled||recordingSession!==session)return;
    const durationMs=session.durationMs,chunks=session.chunks;
    if(!chunks.length){releaseRecordingSession(session);return;}
    if(durationMs<500){toast('说话时间太短');releaseRecordingSession(session);return;}
    const blob=new Blob(chunks,{type:session.recorder.mimeType.split(';')[0]});
    if(blob.size>8*1024*1024){toast('录音过大，请缩短后重试');releaseRecordingSession(session);return;}
    session.phase=session.mode==='voice'?'sending':'transcribing';dictationBusy=session.mode==='dictation';
    syncComposerControls();
    try{
      const wav=await window.PipiAudio.recordingWav(blob);
      if(session.cancelled||recordingSession!==session)return;
      const audio=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('无法读取录音'));reader.readAsDataURL(wav);});
      if(session.cancelled||recordingSession!==session)return;
      const body={roleId:session.roleId,requestId:crypto.randomUUID(),quoteId:session.quoteId||undefined};
      if(session.mode==='voice'){Object.assign(body,{audio,durationMs});}
      else{
        const result=await api('/api/voice/transcribe',{audio,roleId:session.roleId});
        if(session.cancelled||recordingSession!==session)return;
        const text=String(result.text||'').trim();
        if(!text){toast('没有识别到文字，请重试');return;}
        if(session.mode==='dictation'){session.transcript=text;applyDictationTranscript(session);return;}
        body.text=text;
      }
      window.PipiEngine?.resetActivity(session.roleId);
      const result=await api(session.mode==='voice'?'/api/chat/send':'/api/chat',body);
      if(recordingSession===session&&route.name==='chat'&&route.arg===session.roleId){
        if(!composeText&&!composeImage&&quoteId===session.quoteId)quoteId='';
        forceBottomRole=session.roleId;
      }
      receiveState(result.state);
      if(result.notice&&recordingSession===session)toast(result.notice);
    }catch(err){if(!session.cancelled&&recordingSession===session){toast(err.message);if(err.state)receiveState(err.state);}}
    finally{
      if(recordingSession===session&&session.phase!=='awaiting-composition'){
        releaseRecordingSession(session);
        if(session.mode!=='dictation'&&route.name==='chat'&&route.arg===session.roleId)refresh();
      }
    }
  }
  async function startRecording(mode,hold) {
    if(recordingSession||dictationBusy||sending)return;
    if(mode==='dictation'&&!window.PipiEngine?.serviceReady('stt')){toast('请先在模型设置中选择录音转文字模型');return;}
    if(!window.MediaRecorder||!navigator.mediaDevices?.getUserMedia){toast('当前浏览器不支持录音，请使用 HTTPS 或本机 localhost');return;}
    const input=view.querySelector('#compose-text');if(input){composerSelection=readComposerSelection(input);}
    const session={mode,hold,roleId:route.arg,quoteId,phase:'requesting',cancelled:false,chunks:[]};
    recordingSession=session;syncComposerControls();
    hold?.signal.addEventListener('abort',()=>{if(recordingSession===session)stopRecording(true);},{once:true});
    try{
      session.stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(session.cancelled||recordingSession!==session||route.name!=='chat'||route.arg!==session.roleId||document.hidden){releaseRecordingSession(session);return;}
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
      session.recorder=new MediaRecorder(session.stream,mime?{mimeType:mime}:undefined);
      session.recorder.ondataavailable=event=>{if(!session.cancelled&&event.data.size)session.chunks.push(event.data);};
      session.recorder.onerror=()=>{if(recordingSession===session){stopRecording(true);toast('录音中断，请重新按住说话');}};
      session.recorder.onstop=()=>{
        releaseMicrophone(session);
        if(recordingSession!==session||session.cancelled)return;
        session.durationMs??=Math.min(60000,Date.now()-session.startedAt);
        session.phase='recorded';
        if(session.mode==='hold')session.hold.capped();else void finishRecording(session);
      };
      session.recorder.start();session.startedAt=Date.now();session.phase='recording';
      session.timer=setTimeout(()=>{if(recordingSession===session)stopRecording(false);},60000);
      syncComposerControls();
      if(!hold)return;
      let level;
      if(window.AudioContext){
        const context=new AudioContext(),analyser=context.createAnalyser();
        session.volumeContext=context;analyser.fftSize=512;
        context.createMediaStreamSource(session.stream).connect(analyser);
        const samples=new Float32Array(analyser.fftSize);
        level=()=>{
          if(!session.volumeContext)return 0;
          analyser.getFloatTimeDomainData(samples);
          let power=0;for(const sample of samples)power+=sample*sample;
          return Math.min(1,Math.sqrt(power/samples.length)*6);
        };
      }
      return {level,stop(choice){
        if(recordingSession!==session)return;
        if(!window.PipiEngine?.serviceReady(choice==='text'?'stt':'voiceUnderstanding')){
          stopRecording(true);toast(choice==='text'?'请先在模型设置中选择录音转文字模型':'请先在模型设置中选择语音条理解模型');return;
        }
        session.mode=choice;
        if(session.phase==='recorded')void finishRecording(session);else stopRecording(false);
      }};
    }catch(err){if(recordingSession===session&&!session.cancelled){releaseRecordingSession(session);toast(err.name==='NotAllowedError'?'麦克风权限未开启，请在浏览器设置中允许录音':'无法开始录音：'+err.message);}else session.stream?.getTracks().forEach(track=>track.stop());}
  }
  function stopRecording(cancel=false) {
    const session=recordingSession;
    if(!session)return;
    if(cancel||session.phase==='requesting'){
      session.cancelled=true;session.chunks=[];
      if(session.recorder&&session.recorder.state!=='inactive'){session.recorder.ondataavailable=null;session.recorder.onstop=null;session.recorder.stop();}
      releaseRecordingSession(session);
    }else if(session.recorder&&session.recorder.state!=='inactive'){
      session.durationMs=Math.min(60000,Date.now()-session.startedAt);
      session.phase='stopping';if(session.mode==='dictation')dictationBusy=true;session.recorder.stop();syncComposerControls();
    }
  }
  function avatarForm(entity) {
    avatarDraft=safeImage(entity?.avatar)?entity.avatar:'';
    return `<div class="avatar-picker"><button type="button" id="pick-avatar" aria-label="上传头像">${avatar({...entity,avatar:avatarDraft},72)}</button><small>点击上传头像</small><input type="file" id="avatar-file" accept="${profileImageAccept}" hidden>${avatarDraft?'<button type="button" id="remove-avatar" class="text-btn">移除头像</button>':''}</div>`;
  }
  function bindProfileImage(pick,file,label,render){
    const form=file.form,submit=form.querySelector('.modal-submit');
    pick.onclick=()=>file.click();
    file.onchange=async()=>{
      if(!file.files.length)return;
      file.disabled=pick.disabled=submit.disabled=true;
      try{
        const image=await readProfileImage(file.files[0]);
        if(file.isConnected){render(image);form.querySelector('.modal-error').textContent='';}
      }catch(err){if(file.isConnected)toast(`${label}：${err.message}`);}
      finally{
        file.value='';file.disabled=pick.disabled=false;
        submit.disabled=!!form.querySelector('input[type=file]:disabled');
      }
    };
  }
  function bindAvatar(entity) {
    const pick=overlay.querySelector('#pick-avatar'),file=overlay.querySelector('#avatar-file');if(!pick||!file)return;
    const renderDraft=value=>{
      avatarDraft=value;pick.innerHTML=avatar({...entity,avatar:value},72);
      let remove=file.closest('.avatar-picker').querySelector('#remove-avatar');
      if(!value){remove?.remove();return;}
      if(!remove){remove=document.createElement('button');remove.type='button';remove.id='remove-avatar';remove.className='text-btn';remove.textContent='移除头像';file.after(remove);}
      remove.onclick=()=>{if(!file.disabled)renderDraft('');};
    };
    renderDraft(avatarDraft);bindProfileImage(pick,file,'头像',renderDraft);
  }
  function editProfile() {
    const profile=state.profile||{};
    const html=avatarForm(profile)+field('名字','name',profile.name,'怎么称呼你')+field('微信号','wechatId',profile.wechatId,'设置一个个人标识')+field('个性签名','bio',profile.bio,'写一点此刻的心情','textarea')+field('地区','region',profile.region,'例如 中国 · 杭州');
    openModal('个人资料',html,async form=>{const values=formValues(form);if(!values.name.trim())throw new Error('请填写名字');checkWechatId(values.wechatId,profile.wechatId);await act('profile.save',{...values,avatar:avatarDraft});if(form.isConnected){closeModal();refresh();}toast('个人资料已保存');});bindAvatar(profile);
  }
  function editProfileGender(){
    const gender=state.profile?.gender;
    openPage('性别',`<section class="section gender-picker" role="radiogroup" aria-label="性别">${[['male','男'],['female','女']].map(([value,label])=>`<label class="cell"><span class="cell-body cell-title">${label}</span><input type="radio" name="gender" value="${value}" ${gender===value?'checked':''}><span class="gender-check" aria-hidden="true">${icons.check}</span></label>`).join('')}</section>`,async form=>{
      const selected=formValues(form).gender;if(selected)await act('profile.save',{gender:selected});
      if(form.isConnected){closeModal();refresh();}
    },'完成');
  }
  function editRole(id) {
    const r=roleById(id)||{};
    const cover=safeImage(r.cover)?r.cover:'';
    const html=avatarForm(r)+field('名字','name',r.name,'给这位朋友起个名字')+field('备注','remark',r.remark,'备注只显示在你的通讯录里')+field('微信号','wechatId',r.wechatId,'为角色设置一个标识')+field('个性签名','bio',r.bio,'TA 的一句话介绍','textarea')+field('拍一拍','patText',r.patText||'','填写拍了拍后面的内容')+'<span class="rp-pat-preview" id="role-pat-preview"></span>'+`<div class="form-field role-cover-picker"><span class="field-label">朋友圈背景图</span><button type="button" id="pick-role-cover" aria-label="上传朋友圈背景图">${cover?`<img src="${esc(cover)}" alt="朋友圈背景图预览">`:'<span>点击上传朋友圈背景图</span>'}</button><input type="hidden" name="cover" value="${esc(cover)}"><input type="file" id="role-cover-file" accept="${profileImageAccept}" hidden></div>`;
    openModal(id?'编辑角色资料':'添加新的朋友',html,async form=>{
      const values=formValues(form);if(!values.name.trim())throw new Error('请填写角色名字');
      checkWechatId(values.wechatId,r.wechatId);
      await act('role.save',{...(id?{id}:{}),...values,avatar:avatarDraft});if(!form.isConnected){toast('角色资料已保存');return;}closeModal();
      if(!id&&route.name!=='new-friends')showView('new-friends');else refresh();toast('角色资料已保存');
    },id?'保存':'添加朋友');bindAvatar(r);
    const pat=overlay.querySelector('[name=patText]'),patPreview=overlay.querySelector('#role-pat-preview'),roleNameInput=overlay.querySelector('[name=name]');pat.maxLength=100;const previewPat=()=>{patPreview.textContent='我拍了拍“'+(overlay.querySelector('[name=remark]').value||roleNameInput.value||'朋友')+'”'+(pat.value?'的'+pat.value:'');};pat.oninput=previewPat;roleNameInput.oninput=previewPat;overlay.querySelector('[name=remark]').oninput=previewPat;previewPat();
    const pick=overlay.querySelector('#pick-role-cover'),file=overlay.querySelector('#role-cover-file'),value=overlay.querySelector('[name=cover]');
    bindProfileImage(pick,file,'朋友圈背景图',image=>{value.value=image;pick.innerHTML=`<img src="${esc(image)}" alt="朋友圈背景图预览">`;});
  }
  function checkWechatId(value,previous){
    if(value!==previous&&/\p{Script=Han}/u.test(value))throw new Error('微信号不能包含中文');
  }
  function editRoleSchedule(r) {
    if(!r)return;
    showView('role-schedule',r.id);
  }
  function editRoleVoice(r) {
    if(!r)return;
    const availability=state.voiceAvailability,available=availability.enabled;
    const enabled=r.voiceMode!=='off'&&(r.voiceMode!=='global'||state.settings.modules?.voice?.defaultMode!=='off');
    const hint=!availability.modelReady?'请先在模型设置中添加并选择语音合成模型。':available?'':'请先在「发现 → 功能 → 发语音」开启总开关。';
    const html=`<label class="form-field check-row"><input type="checkbox" name="voiceEnabled" ${available&&enabled?'checked':''} ${available?'':'disabled'}>启用语音</label>${hint?`<p class="page-note">${esc(hint)}</p>`:''}<fieldset id="role-voice-controls" ${available&&enabled?'':'disabled'}><div class="form-field"><span class="field-label">从音色库选一个声音</span><button type="button" class="secondary-btn" id="role-voice-refresh">刷新音色</button><select id="role-voice-picker"><option value="">点击刷新读取已配置账号的音色</option></select></div>`+field('专属音色 ID（留空跟随全局）','voiceId',r.voiceId||'','例如 voice_id')+'</fieldset>';
    openModal('TA 的声音',html,async form=>{
      if(!available){closeModal();return;}
      await act('role.save',{id:r.id,voiceId:form.elements.voiceId.value,voiceMode:form.elements.voiceEnabled.checked?'on':'off'});
      if(form.isConnected){closeModal();refresh();}toast('语音设置已保存');
    });
    const picker=overlay.querySelector('#role-voice-picker'),idInput=overlay.querySelector('[name=voiceId]'),btn=overlay.querySelector('#role-voice-refresh');
    overlay.querySelector('[name=voiceEnabled]').onchange=({target})=>{overlay.querySelector('#role-voice-controls').disabled=!target.checked;};
    if(picker&&idInput)picker.onchange=()=>{if(picker.value)idInput.value=picker.value;};
    const loadVoices=async(quiet=false)=>{
      if(!btn||!picker)return;
      btn.disabled=true;picker.innerHTML='<option value="">正在读取音色列表…</option>';
      try{
        const res=await api('/api/engine/voices',{voiceType:'all'});
        const voices=res.voices||[];
        if(!picker.isConnected)return;
        picker.innerHTML=`<option value="">${voices.length?'请选择音色（也可在下方手动填）':'账号里暂无音色，请在下方手填'}</option>`+voices.map(v=>`<option value="${esc(v.voice_id)}" ${v.voice_id===idInput?.value?'selected':''}>${esc(v.name)} (${esc(v.voice_id)})</option>`).join('');
      }catch(err){
        if(picker.isConnected)picker.innerHTML=`<option value="">${esc(err.message||'暂未读取到音色列表')}</option>`;
        if(!quiet)toast(err.message);
      }finally{if(btn.isConnected)btn.disabled=false;}
    };
    if(btn)btn.onclick=()=>loadVoices(false);
    if(available&&enabled)loadVoices(true);
  }
  function editRoleSelfie(r) {
    if(!r)return;
    showView('role-references',r.id);
  }
  function editRoleOutreach(r) {
    if(!r)return;
    const html=`<label class="form-field" style="display:flex;align-items:center;justify-content:space-between;gap:12px"><span class="field-label" style="margin:0">允许 TA 平时主动联系我</span><input type="checkbox" name="outreachEnabled" ${r.outreachEnabled?'checked':''}></label><label class="form-field" style="display:flex;align-items:center;justify-content:space-between;gap:12px"><span class="field-label" style="margin:0">允许 TA 每天按作息发朋友圈</span><input type="checkbox" name="momentsAutoEnabled" ${r.momentsAutoEnabled!==false?'checked':''}></label>`+field('免打扰开始时间','quietStart',r.quietStart||'01:00','HH:mm')+field('免打扰结束时间','quietEnd',r.quietEnd||'07:00','HH:mm')+`<details class="engine-details" style="margin-top:8px"><summary>联系节奏微调（一般保持默认即可）</summary>`+field('聊天停下后至少等多久再找你（分钟）','proactiveMinutes',String(r.proactiveMinutes||60),'默认 60 分钟','number')+'</details>';
    openModal('日常联系',html,async form=>{
      const v=formValues(form),mins=Number(v.proactiveMinutes||60);
      if(!Number.isInteger(mins)||mins<5||mins>10080)throw new Error('等待时长须为 5 到 10080 之间的整数');
      await act('role.save',{id:r.id,outreachEnabled:!!form.elements.outreachEnabled.checked,momentsAutoEnabled:!!form.elements.momentsAutoEnabled.checked,proactiveMinutes:mins,quietStart:v.quietStart,quietEnd:v.quietEnd});
      if(form.isConnected){closeModal();refresh();}toast('日常联系设置已保存');
    });
  }
  function editMemory(id) {
    const m=(state.memories||[]).find(x=>x.id===id)||{}, roleId=m.roleId||route.arg;
    openModal(id?'编辑记忆':'添加一条记忆',field('记忆内容','content',m.content,'例如：我们第一次见面是在秋天，我最喜欢热拿铁。','textarea')+'<p class="page-note" style="padding-left:0">保存后，下次聊天会将这条明确记忆提供给角色。</p>',async form=>{const content=formValues(form).content.trim();if(!content)throw new Error('写下一点想记住的事吧');await act('memory.save',{...(id?{id}:{}),roleId,content});if(form.isConnected){closeModal();refresh();}toast('记忆已保存');});
  }
  function roleMenu(r) {
    actionSheet(roleName(r),[
      {label:'编辑角色资料',icon:icons.edit,run:()=>editRole(r.id)},
      {label:r.pinned?'取消置顶聊天':'置顶聊天',icon:icons.pin,run:async()=>{await act('conversation.pin',{roleId:r.id,pinned:!r.pinned});refresh();}},
      {label:r.hidden?'重新显示此聊天':'不显示此聊天',run:async()=>{await act('conversation.hide',{roleId:r.id,hidden:!r.hidden});refresh();}},
      {label:'清空聊天记录',icon:icons.trash,danger:true,run:()=>confirmDialog('清空聊天记录？',`将删除与 ${roleName(r)} 的全部消息，保留角色资料与共同记忆。`,()=>act('conversation.clear',{roleId:r.id}),'清空记录')},
      {label:'删除联系人',danger:true,run:()=>confirmDialog('删除这位联系人？',`与 ${roleName(r)} 的聊天记录和关联记忆将一并删除。`,async isCurrent=>{await act('role.delete',{id:r.id});if(isCurrent())showView('contacts');},'删除联系人')}
    ]);
  }
  function downloadBackup() {
    openModal('导出备份',`<label class="check-row"><input type="checkbox" name="includeModelKeys" checked>包含模型 API Key</label><p class="page-note">勾选后，备份文件会包含可用的模型密钥，请妥善保管。</p>`,async form=>{
      const result=await api('/api/backup',{includeModelKeys:form.elements.includeModelKeys.checked});
      if(!form.isConnected)return;
      const hasKeys=result.modelKeys?.length>0;
      const blob=new Blob([JSON.stringify(result)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;
      link.download=`pipi-phone-backup-${new Date().toISOString().slice(0,10)}${hasKeys?'-with-model-keys':''}.json`;
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      closeModal(false);toast('备份已开始下载');
    },'下载');
    overlay.querySelector(':scope > .page-editor').classList.add('model-sheet');
  }
  function pickBackup() {
    const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
    input.onchange=async()=>{
      const file=input.files?.[0];if(!file)return;if(file.size>88*1024*1024){toast('备份不能超过 88 MB');return;}
      try{
        const backup=JSON.parse(await file.text());
        const hasKeys=Array.isArray(backup?.modelKeys)&&backup.modelKeys.length>0;
        const keyNote=hasKeys?'这份备份包含模型 API Key，会按服务商地址恢复。':'这份备份未包含模型 API Key。相同服务商地址的现有密钥可继续使用。';
        openModal('恢复这份备份？',`<div class="inline-note" style="margin:12px 0">文件：${esc(file.name)}<br>恢复会覆盖当前业务资料，保留登录密码。${keyNote}</div><label class="check-row"><input type="checkbox" name="confirmed" required>我已导出需要保留的数据，确认恢复</label>`,async form=>{
          if(!form.elements.confirmed.checked)throw new Error('请先勾选确认');
          const result=await api('/api/restore',{backup,confirm:true});
          setState(result.state);
          if(form.isConnected){closeModal(false);void afterOverlayBack().then(()=>showView('chats'));}
          const restored=result.restoredModelKeys?`，已恢复 ${result.restoredModelKeys} 个模型密钥`:'';
          const skipped=result.skippedModelKeys?`，${result.skippedModelKeys} 个密钥地址不匹配`:'';
          const checkKeys=Boolean(result.skippedModelKeys||result.clearedModelKeys);
          toast('数据已恢复'+restored+skipped+(checkKeys?'，请在模型页检查密钥':''),checkKeys);
        },'恢复备份',undefined,'cancel',{lockWhileSaving:true});
        overlay.querySelector(':scope > .page-editor').classList.add('model-sheet');
      }
      catch(err){toast(err instanceof SyntaxError?'这不是有效的 JSON 备份文件':err.message);}
    };input.click();
  }
  function renderAuth(setup, connectionError = '') {
    stopSpeech();authSetup=setup;authEpoch++;state=null;window.PipiEngine?.stop();view.dataset.route='auth';
    view.innerHTML=`<div class="auth-content"><div class="auth-logo">${icons.chat}</div><h1>屁屁机</h1>${setup?'':'<p class="auth-subtitle">熟悉的人和日常，都在这里等你。</p>'}${connectionError?`<div class="inline-note">${esc(connectionError)}</div><button class="primary-btn weui-btn weui-btn_primary" id="retry-boot">重新连接</button>`:`<form id="auth-form">${setup?field('你的名字','displayName','','怎么称呼你'):''}${field(setup?'设置访问密码':'访问密码','password','',setup?'至少 8 个字符':'','password')}${setup?field('再次输入密码','confirmPassword','','再输入一次','password')+field('首次设置令牌（仅远程部署需要）','setupToken','','本机访问可留空','password'):''}<div class="auth-error" role="alert"></div><button type="submit" class="primary-btn weui-btn weui-btn_primary">${setup?'开启我的小手机':'进入小手机'}</button></form>`}<div class="auth-bottom">${setup?'一个账号 · 一部独立小手机<br>请保存好密码，当前版本不提供邮箱找回':'你的数据保存在当前服务器<br>密码仅用于访问这部小手机'}<br>开源 · 非售卖 · 无内置模型密钥</div></div>`;
    view.querySelector('#retry-boot')?.addEventListener('click',boot);
    const form=view.querySelector('#auth-form');if(!form)return;
    form.querySelector('[name=password]').autocomplete=setup?'new-password':'current-password';
    form.onsubmit=async event=>{
      event.preventDefault();const values=formValues(form),button=form.querySelector('[type=submit]'),error=form.querySelector('.auth-error');if(button.disabled)return;
      if(!values.password||(setup&&values.password.length<8)){error.textContent=setup?'请设置至少 8 个字符的密码':'请输入访问密码';return;}
      if(setup&&values.password!==values.confirmPassword){error.textContent='两次输入的密码不一致';return;}
      button.disabled=true;error.textContent='';button.textContent='正在进入…';
      try{const result=await api(setup?'/api/setup':'/api/login',{password:values.password,...(setup?{displayName:values.displayName,setupToken:values.setupToken}:{})});setState(result.state);if(!state){const next=await api('/api/state');setState(next.state||next);}showView(initialView);}
      catch(err){error.textContent=err.message;button.textContent=setup?'开启我的小手机':'进入小手机';}
      finally{button.disabled=false;}
    };
  }
  async function boot() {
    try{const status=await api('/api/status');sourceUrl=status.sourceUrl;rolePanelAvailable=status.rolePanel===true;globalThis.__pipiVersion=status.version;globalThis.__pipiUpdatesEnabled=status.softwareUpdates===true;if(status.authenticated){const result=await api('/api/state');setState(result.state||result);await restoreBrowserPage();}else renderAuth(status.setupRequired);}
    catch(err){renderAuth(false,`暂时无法连接这部小手机。${err.message}`);}
  }
  window.Pipi={getState:()=>state,api,apiRaw,act,receiveState,updateTyping,syncChatProgress,readImage,readProfileImage,showView,goBack,openWhenReady,openChatMessage:(roleId,messageId)=>{focusMessageId=messageId;showView('chat',roleId);},preserveChatLayout:callback=>{const snapshot=captureChatLayout();callback();restoreChatLayout(snapshot);},scrollChatToBottom:(roleId)=>{forceBottomRole=roleId;chatScrolls.delete(roleId);if(route.name==='chat'&&route.arg===roleId)scrollChat();},openModal,closeModal,openPage,openNestedPage,openChildDialog,closeChildDialog,closePage:closeModal,openPhoto:lightbox,actionSheet,confirmDialog,toast,esc,avatar,icons,refresh,setState,registerRoute:(name,renderer)=>routes.set(name,renderer)};
  document.addEventListener('keydown', event => {
    if (event.isComposing || composeComposing) return;
    if (event.key === 'Tab' && modalOpen) {
      if (modalSaveInProgress) { event.preventDefault(); return; }
      if (childDialog) return; // Native showModal() contains its own keyboard focus.
      const items = [...overlay.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')]
        .filter(el => el.getClientRects().length && !el.closest('[inert]'));
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items.at(-1), outside = !overlay.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || outside)) {
        event.preventDefault(); first.focus();
      }
      return;
    }
    const menu = overlay.querySelector('[role=menu]');
    if (menu && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      const items = [...menu.querySelectorAll('[role=menuitem]')], current = items.indexOf(document.activeElement);
      let index = current + (['ArrowUp','ArrowLeft'].includes(event.key) ? -1 : 1);
      if (event.key === 'Home') index = 0;
      if (event.key === 'End') index = items.length - 1;
      event.preventDefault();
      items[(index + items.length) % items.length]?.focus({preventScroll:true});
    }
    if (event.key === 'Escape') {
      if (recordingSession) stopRecording(true);
      else if (childDialog) { event.preventDefault(); closeChildDialog(); }
      else if (modalOpen) closeModal();
      else if (chatSelection) finishMessageSelection();
      else if (panel) { panel=''; updateComposer(); }
    }
  });
  for(const type of ['input','compositionstart'])document.addEventListener(type,event=>{if(event.target.closest('.chat-composer'))cancelAvatarTaps();},true);
  history.replaceState({pipi:true,route:{...route},stack:[...navStack]},'');window.addEventListener('popstate',event=>{if(overlayBackPending){overlayBackPending=false;if(overlayCloseQueued){const discardAll=overlayCloseQueued==='all';overlayCloseQueued=false;if(history.state?.overlay){overlayBackPending=true;if(discardAll)history.go(-(history.state.overlayDepth||1));else history.back();return;}}if(queuedView){const next=queuedView;queuedView=null;queuedBack=false;if(modalOpen&&history.state?.overlay){closeModal(false);queuedView=next;return;}if(modalOpen)closeModal(false,true);showView(next.name,next.arg,next.fromBack);}else if(queuedBack){queuedBack=false;goBack();}else if(modalOpen)trackModalHistory();if(!overlayBackPending&&!modalOpen)window.PipiFeatures?.handleBack?.('history');if(!overlayBackPending)overlayBackWaiters.splice(0).forEach(resolve=>resolve());return;}if(childDialog){closeChildDialog(true);return;}if(modalOpen){closeModal(true,true);return;}if(window.PipiFeatures?.handleBack?.('history'))return;if(chatSelection&&!event.state?.chatSelection){finishMessageSelection(true);return;}if(event.state?.overlay)history.replaceState({...event.state,overlay:false,childDialog:undefined},'');const previous=event.state?.route||{name:'chats',arg:null};navStack.splice(0,navStack.length,...(event.state?.stack||[]));showView(previous.name,previous.arg,true);});
  const viewport=window.visualViewport;const sizeViewport=()=>{const anchor=captureChatLayout(),height=viewport?.height||innerHeight;document.documentElement.style.setProperty('--app-height',height+'px');document.documentElement.style.setProperty('--viewport-top',(viewport?.offsetTop||0)+'px');restoreChatLayout(anchor);};viewport?.addEventListener('resize',sizeViewport);viewport?.addEventListener('scroll',sizeViewport);window.addEventListener('resize',sizeViewport);sizeViewport();
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&(recordingSession))stopRecording(true);else if(!document.hidden)syncVisibleChatRead();});window.addEventListener('pagehide',()=>{saveBrowserPosition();if(recordingSession)stopRecording(true);});
  let polling=false;
  setInterval(async()=>{
    if(!state||sending||polling||recordingSession||composeComposing||searchComposing||document.hidden)return;
    polling=true;
    try{
      const next=await api('/api/state'),incoming=next.state||next;
      if(incoming.revision!==state.revision){receiveState(incoming);}
      if(pendingRender){
        const active=document.activeElement,editing=active&&(active.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)),list=view.querySelector('#chat-messages'),nearBottom=!list||list.scrollHeight-list.scrollTop-list.clientHeight<100;
        if(!modalOpen&&!editing&&!composeText&&!composeImage&&!['providers'].includes(route.name)&&nearBottom)refresh();
      }
    }catch(err){if(err.status!==401)console.debug('Background refresh unavailable');}finally{polling=false;}
  },6500);
  window.Pipi.rolePanelAvailable=()=>rolePanelAvailable;
  bindSheetBackdrop();
  boot();
})();
