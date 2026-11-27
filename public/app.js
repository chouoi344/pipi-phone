'use strict';
(() => {
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
  const iconVersion = '0.13.13';
  const assetIcon = (name, color = false, cls = '') => color
    ? `<img class="icon asset-icon ${cls}" src="/vendor/fake-world/icons/${name}.svg?v=${iconVersion}" alt="" aria-hidden="true">`
    : `<span class="icon mask-icon ${cls}" style="--icon-url:url('/vendor/fake-world/masks/${name}.svg?v=${iconVersion}')" aria-hidden="true"></span>`;
  const nativeIcon = name => `<span class="icon mask-icon" style="--icon-url:url('/vendor/native-icons/${name}.svg?v=${iconVersion}')" aria-hidden="true"></span>`;
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
  const androidInboxEntry=Boolean(window.PipiAndroidPage && new URLSearchParams(location.search).get('android_entry')==='chats');
  if(androidInboxEntry){
    const url=new URL(location.href);
    url.searchParams.delete('android_entry');
    history.replaceState(null,'',url);
  }
  const restoredPage=history.state?.pipi&&typeof history.state.route?.name==='string'?history.state:null;
  let state = null, csrf = '', authEpoch = 0, route = restoredPage?{...restoredPage.route}:{name:initialView,arg:null}, authSetup = false, modalOpen = false, searchTerm = '', searchOpen = false;
  let sourceUrl = '',binaryMedia=false,imageVariants=false,storageMaintenance=false,streamingBackup=false,accountSecurity=false,setupTokenRequired=false,momentExclusions=false;
  let composeText = '', composeImage = '', composeImageMeta=null, composeStickerId = '', quoteId = '', panel = '', avatarDraft = '', toastTimer, pendingRender = false, modalReturnFocus = null;
  let recordingSession=null,dictationBusy=false,composeComposing=false,searchComposing=false,deferredComposerUpdate=false;
  const routes = new Map();
  const navStack = restoredPage?.stack?.slice()||[], drafts = new Map(), chatScrolls = new Map();
  const chatHistoryPageSize=120, chatHistoryWindows=new Map();
  let chatPageTask=null,chatJump=null;
  const androidReadings=new Map();
  const newChatMessageIds=new Set();
  let speechSession=null,syncImageViewer=null;
  const forwardDetails=new Map();
  let slowReplyRole='',chatProgressSequence=0,activeChatProgress=null,chatProgressTimer=0;
  const composerHistories=new Map();
  const composerPointers=new Map();
  const pendingSends=new Map(),pendingStickers=new Set(),retryingMessages=new Set();
  const patRequests=new Set();
  const avatarTaps=new Map();
  const readRequests=new Set();
  let composerPointerSettling=false,composerPointerFrame=0,pointerComposerUpdatePending=false,pointerViewRefreshPending=false;
  let focusMessageId = '', forceBottomRole='', composerSelection = {start:0,end:0};
  let composerScroll={input:0,emoji:0};
  let chatImageSequence=0, processingImage=null, systemFilePicker, stickerUploadEpoch=-1;
  let morePage=0, emojiPage=0, chatSearch='',chatSearchFilter='all',chatSearchDate='';
  let emojiTab='all',emojiSearch='',emojiExpandedHeight=0;
  let composerPanelFrom=null;
  let modalCloseCallback=null,modalSaveInProgress=false;
  let statusDraft=null,statusSaving=false,statusExpiryTimer;
  let chatSelection=null;
  let globalSearchTerm='';
  let contactsReturn=null,chatsReturn=0;
  const transcriptViews=new Map(),thumbnailAttempts=new Set(),thumbnailQueue=[],chatImageSizes=new Map(),chatPreviewStatus=new Map();
  let thumbnailWorkers=0;
  const previewWarmups=new Map();
  let previewWarmupTimer=0;
  const chatDraftKey='pipi.chat-drafts',failedSends=new Map(),pressTimers=new Set(),avatarSources=new Map(),avatarKeys=new Map(),profileAvatarImages=new Map();
  const roleRoutes=new Set(['chat','role','memories','role-memories','role-schedule','role-references','chat-info','role-config','contact-settings','contact-more','contact-permissions','chat-search','friend-profile','role-stickers','role-reminders']);
  let avatarSequence=0,renderTimer=0,bootStale=Boolean(restoredPage&&(restoredPage.overlay||restoredPage.chatSelection||restoredPage.childDialog||restoredPage.featureSelection));
  const statusChoices=[['happy','美滋滋','statusHappy'],['daze','发呆','statusDaze'],['busy','忙','statusBusy'],['focus','学习','statusFocus'],['fish','摸鱼','statusFish'],['work','搬砖','statusWork'],['travel','出差','statusTravel'],['exercise','运动','statusExercise'],['coffee','喝咖啡','statusCoffee'],['rest','休息','statusRest'],['music','听歌','statusMusic'],['game','玩游戏','statusGame'],['sleep','睡觉','statusSleep'],['other','其他','statusOther']];
  const statusGroups=[['心情想法',['happy','daze']],['工作学习',['busy','focus','fish','work','travel']],['活动',['exercise','coffee']],['休息',['rest','music','game','sleep']],['其他',['other']]];
  const statusThemes={happy:'#8c9364',daze:'#747f92',busy:'#797b69',focus:'#657f91',fish:'#6d8f8b',work:'#a6a46d',travel:'#687f95',exercise:'#9c8270',coffee:'#9b8275',rest:'#7d7f9a',music:'#7e7e9a',game:'#738989',sleep:'#6c718d',other:'#718c83'};
  let overlayBackPending=false,overlayCloseQueued=false,queuedView=null,queuedBack=false;
  let childDialog=null,childDialogSequence=0;
  const overlayBackWaiters=[];
  const afterOverlayBack=()=>overlayBackPending?new Promise(resolve=>overlayBackWaiters.push(resolve)):Promise.resolve();
  const featureNames = new Set(['moments','moment-album','ledger','wallet','farm','favorites','services']);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeImage = value => typeof value === 'string' && ((/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-zA-Z0-9+/=\s]+$/i.test(value.trim()) && value.length <= 4*Math.ceil(64*1024*1024/3)+128) || /^\/api\/media\/[a-f0-9]{32,64}\.(?:png|jpg|jpeg|webp|gif)$/i.test(value.trim()));
  const safeAudio = value => typeof value === 'string' && (/^\/api\/media\/[a-f0-9]{32,64}\.(?:webm|ogg|mp3|m4a|mp4|wav|aac|flac)$/i.test(value.trim())||/^data:audio\/(?:mpeg|mp3|wav|x-wav|ogg|webm|mp4|m4a|x-m4a|aac|flac|x-flac)(?:\s*;\s*codecs=[^;]+)?;base64,[a-zA-Z0-9+/=\s]+$/i.test(value.trim()));
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
  function richText(value,editable=false){const {map,expression}=compiledEmoji(),text=String(value??'');if(!expression)return esc(text);return text.split(expression).map(part=>{if(!map.has(part))return esc(part);const html=emojiSprite(map.get(part),true);return editable?html.replace('<span ','<span contenteditable="false" data-compose-token="'+esc(part)+'" ')+'\u200b':html;}).join('');}
  // Reuse the licensed sprite and token renderer above. A real editing host lets
  // the browser place the caret around atomic pictures, including wrapped lines;
  // the server and drafts continue to receive the existing plain token format.
  function composerDOM(input){
    let text='';const units=[],boundaries=new Map(),tokens=compiledEmoji().map;
    const visit=node=>{
      if(node.nodeType===Node.TEXT_NODE){const value=node.data.replace(/\u200b/g,'').replace(/\u00a0/g,' '),start=text.length;text+=value;units.push({node,start,end:text.length});return;}
      if(node.nodeType!==Node.ELEMENT_NODE)return;
      const token=node.dataset.composeToken;
      if(token&&tokens.has(token)){const start=text.length;text+=token;units.push({node,start,end:text.length,atomic:true});return;}
      if(node.tagName==='BR'){if(!(node.parentNode===input&&input.childNodes.length===1)){const start=text.length;text+='\n';units.push({node,start,end:text.length,atomic:true});}return;}
      const points=[];boundaries.set(node,points);let previousBlock=false;
      [...node.childNodes].forEach((child,index)=>{const block=child.nodeType===1&&/^(DIV|P|LI)$/.test(child.tagName);if((block||previousBlock)&&text&&!text.endsWith('\n'))text+='\n';points[index]=text.length;visit(child);previousBlock=block;});points[node.childNodes.length]=text.length;
    };visit(input);
    const offset=(node,index)=>{const unit=units.find(item=>item.node===node);if(unit)return unit.atomic?(index?unit.end:unit.start):unit.start+node.data.slice(0,index).replace(/\u200b/g,'').length;return boundaries.get(node)?.[index];};
    const point=value=>{value=Math.max(0,Math.min(text.length,value));for(const unit of units){if(value<=unit.end){if(!unit.atomic){let index=0,count=0;while(index<unit.node.length&&(count<value-unit.start||unit.node.data[index]==='\u200b')){if(unit.node.data[index]!=='\u200b')count++;index++;}return [unit.node,index];}if(value===unit.end&&unit.node.nextSibling?.nodeType===Node.TEXT_NODE&&unit.node.nextSibling.data.startsWith('\u200b'))return [unit.node.nextSibling,1];const parent=unit.node.parentNode,index=[...parent.childNodes].indexOf(unit.node);return [parent,index+(value>unit.start?1:0)];}}return [input,input.childNodes.length];};
    return {text,offset,point};
  }
  function readComposerSelection(input){const selection=getSelection();if(!selection?.rangeCount)return composerSelection;const range=selection.getRangeAt(0);if(!input.contains(range.startContainer)||!input.contains(range.endContainer))return composerSelection;const model=composerDOM(input),start=model.offset(range.startContainer,range.startOffset),end=model.offset(range.endContainer,range.endOffset);return Number.isFinite(start)&&Number.isFinite(end)?{start,end}:composerSelection;}
  function setComposerSelection(input,start,end=start){if(!input)return;const model=composerDOM(input),range=document.createRange(),a=model.point(start),b=model.point(end);range.setStart(...a);range.setEnd(...b);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);composerSelection={start:model.offset(...a)??0,end:model.offset(...b)??model.text.length};}
  function readComposerText(input){return input?.isContentEditable||input?.hasAttribute('contenteditable')?composerDOM(input).text:input?.value||'';}
  function paintComposer(input,restoreSelection=false){if(!input)return;const html=richText(composeText,true);if(input.innerHTML!==html)input.innerHTML=html;if(restoreSelection)setComposerSelection(input,composerSelection.start,composerSelection.end);}
  function rememberComposerEdit(text=composeText,selection=composerSelection){if(route.name!=='chat')return;let history=composerHistories.get(route.arg);if(!history){history={undo:[],redo:[]};composerHistories.set(route.arg,history);}const previous=history.undo.at(-1);if(!previous||previous.text!==text)history.undo.push({text,selection:{...selection}});if(history.undo.length>100)history.undo.shift();history.redo.length=0;}
  function restoreComposerEdit(redo=false){if(composeComposing)return;const history=composerHistories.get(route.arg),from=history?.[redo?'redo':'undo'],to=history?.[redo?'undo':'redo'];if(!from?.length)return;const next=from.pop();to.push({text:composeText,selection:{...composerSelection}});composeText=next.text;composerSelection={...next.selection};syncComposerDraft();}
  const roleById = id => state?.roles?.find(r => r.id === id);
  const roleName = r => r?.remark || r?.name || '联系人';
  function avatarKey(src){if(typeof src!=='string'||!src)return '';let key=avatarKeys.get(src);if(key===undefined){if(!safeImage(src))return '';key=String(++avatarSequence);}else avatarKeys.delete(src);avatarKeys.set(src,key);avatarSources.set(key,src);if(avatarKeys.size>512){const [oldSrc,oldKey]=avatarKeys.entries().next().value;avatarKeys.delete(oldSrc);avatarSources.delete(oldKey);}return key;}
  function paintAvatars(root){
    if(root?.nodeType!==1)return;
    for(const img of root.matches('img[data-avatar-key]')?[root]:root.querySelectorAll('img[data-avatar-key]')){
      const key=img.dataset.avatarKey,src=avatarSources.get(key);if(!src)continue;
      if(img.loading==='eager'&&!img.closest('.navigation-snapshot')){
        const previous=profileAvatarImages.get(key);
        if(previous&&previous!==img&&!previous.isConnected){previous.width=img.width;previous.height=img.height;previous.alt=img.alt;img.replaceWith(previous);}
        else profileAvatarImages.set(key,img);
        if(profileAvatarImages.size>4)profileAvatarImages.delete(profileAvatarImages.keys().next().value);
      }
      if(!img.hasAttribute('src'))img.src=src;
    }
  }
  new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)paintAvatars(node);}).observe(document.body,{childList:true,subtree:true});
  function avatar(entity = {}, size = 48, eager = false) {
    eager = eager || entity===state?.profile&&['me','profile'].includes(route.name);
    const name = String(entity.name || entity.remark || '我'), key = avatarKey(entity.avatar);
    return `<span class="avatar ${key?'':'avatar-empty'}" style="--avatar-size:${Math.max(20,Math.min(100,Number(size)||48))}px">${key ? `<img data-avatar-key="${key}"${eager?` src="${esc(entity.avatar)}" fetchpriority="high"`:''} alt="${esc(name)}的头像" width="${size}" height="${size}" loading="${eager?'eager':'lazy'}" decoding="async">` : assetIcon('people-filled')}</span>`;
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
  function setState(next) { if (next && typeof next === 'object') {if(state&&next.revision<state.revision&&!globalThis.window?.PipiStateSync?.replaces(next))return;const foreign=state&&next.revision>state.revision+1;const sync=globalThis.window?.PipiStateSync,live=sync?.newMessages?.(next);
    if(!sync?.isHistory?.(next)||live?.length){
      const candidates=live??next.messages;
      globalThis.window?.WaterdropChat?.observeState(state,next,view,candidates);globalThis.window?.PipiMotion?.observeChatState(state,next,view,candidates);globalThis.window?.PipiChatNotice?.observeState(state,next,candidates);trackNewChatMessages(state,next,candidates);
    }else if(!state||sync.replaces(next)){globalThis.window?.PipiChatNotice?.rebase(next);}

    globalThis.window?.PipiAndroidPage?.updateReadings?.(androidReadings,globalThis.window?.PipiStateSync?.client?.paging?.delta(next));
    if(state&&pendingSends.size){
      const ids=new Set(state.messages.map(m=>m.id));
      for(const message of next.messages){
        if(message.sender!=='user'||ids.has(message.id))continue;
        for(const pending of pendingSends.values()){
          if(pending.observed||pending.roleId!==message.roleId||pending.text!==(message.type==='text'?message.content:'')||pending.uploadedImage!==(message.type==='image'?message.content:message.meta?.image||'')||pending.quote!==(message.meta?.quote?.messageId||'')||pending.stickerId!==(message.meta?.stickerId||''))continue;
          pending.observed=true;view.querySelector('[data-pending-id="'+pending.requestId+'"]')?.remove();break;
        }
      }
    }
    state = next;globalThis.window?.PipiStateSync?.observe(next);globalThis.window?.PipiMessageLimit?.check(state);globalThis.window?.PipiStickers?.syncDetail();globalThis.window?.PipiExpiry?.sync();syncVisibleChatRead();globalThis.window?.PipiEngine?.start();if(foreign)scheduleRender();} }
  function receiveState(next) {
    if(!state||next.revision<=state.revision&&!globalThis.window?.PipiStateSync?.replaces(next))return;
    setState(next);pendingRender=true;flushRender(true);
  }
  // A revision gap means a response also carried changes made elsewhere; draw them
  // even when the caller only updates its own part of the page.
  function scheduleRender(){pendingRender=true;clearTimeout(renderTimer);renderTimer=setTimeout(flushRender);}
  // Every deferred redraw leaves through here: composer text, caret and scroll survive.
  function flushRender(force=false){
    if(!pendingRender||!state||document.hidden||modalOpen||searchComposing||(!force&&route.name==='providers'))return;
    if(route.name==='moments'&&document.querySelector('.moment-comment-bar'))return;
    if(route.name==='chat'&&view.dataset?.chatRole===route.arg&&!chatSelection&&!focusMessageId&&roleById(route.arg)&&view.querySelector('#chat-messages')&&!view.querySelector('.chat-selecting')){
      refresh();syncVisibleChatRead();globalThis.window?.PipiChatNotice?.navigated();return;
    }
    if(composeComposing||recordingSession)return;
    const active=document.activeElement,input=view.querySelector('#compose-text');
    if(active&&active!==input&&(active.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)))return;
    if(roleRoutes.has(route.name)&&!roleById(route.arg)){showView(route.name==='chat'?'chats':'contacts');return;}
    const focused=!!input&&active===input,anchor=captureChatLayout();
    if(input){composeText=readComposerText(input);composerSelection=readComposerSelection(input);composerScroll.input=input.scrollTop;}
    refresh();restoreChatLayout(anchor);
    syncVisibleChatRead();globalThis.window?.PipiChatNotice?.navigated();
    if(focused){const nextInput=view.querySelector('#compose-text');if(nextInput){nextInput.focus({preventScroll:true});setComposerSelection(nextInput,composerSelection.start,composerSelection.end);}}
  }
  function chatProgressLabel(progress){
    if(!progress?.phase)return '';
    const label={queued:'正在等待回复',preparing:'正在整理对话',model:'正在生成回复',tool:'正在处理操作',media:progress.operation==='voice'?'正在生成语音':progress.operation==='image'?'正在生成图片':'正在准备媒体',delivering:'正在发送回复'}[progress.phase];
    if(!label)return '';
    const at=progress.phase==='queued'?progress.enqueuedAt:progress.startedAt;
    if(!Number.isFinite(at))return label;
    const seconds=Math.max(0,Math.floor((Date.now()-at)/1000));
    return label+' · '+(seconds<60?seconds+'秒':Math.floor(seconds/60)+'分'+seconds%60+'秒');
  }
  function paintChatProgress(roleId){
    if(route.name!=='chat'||route.arg!==roleId)return;
    const slow=slowReplyRole===roleId,progress=activeChatProgress?.roleId===roleId?activeChatProgress:null;
    const title=view.querySelector('[data-chat-title]'),status=view.querySelector('.chat-retry-status'),typing=Boolean(window.PipiEngine?.isTyping(roleId));
    if(title)title.textContent=typing?'对方正在输入':roleName(roleById(roleId));
    view.querySelector(':scope > .topbar h2')?.classList.toggle('is-typing',typing);
    if(status){
      status.hidden=!slow&&!progress?.phase;
      const text=status.querySelector('[data-chat-progress-text]');if(text)text.textContent=slow?'网络较慢，正在重试…':chatProgressLabel(progress);
      const cancel=status.querySelector('[data-chat-cancel]');if(cancel)cancel.hidden=!slow;
    }
    window.WaterdropChat?.updateTyping(view);
  }
  function updateTyping(roleId=route.arg,slow=false,progress) {
    if(progress===null||progress?.phase===null&&activeChatProgress?.roleId===roleId){activeChatProgress=null;clearInterval(chatProgressTimer);chatProgressTimer=0;}
    if(progress===null){chatProgressSequence++;slowReplyRole='';if(route.name==='chat')paintChatProgress(route.arg);return;}
    if(route.name!=='chat'||route.arg!==roleId)return;
    chatProgressSequence++;slowReplyRole=slow?roleId:'';
    if(progress!==undefined)activeChatProgress=progress.phase?{...progress,roleId}:null;
    clearInterval(chatProgressTimer);chatProgressTimer=0;paintChatProgress(roleId);
    if(activeChatProgress?.roleId===roleId&&activeChatProgress.phase){
      const timer=setInterval(()=>{
        if(route.name!=='chat'||route.arg!==roleId||!view.querySelector('.chat-retry-status')){clearInterval(timer);if(chatProgressTimer===timer)chatProgressTimer=0;return;}
        if(!document.hidden)paintChatProgress(roleId);
      },1000);chatProgressTimer=timer;
    }
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
    const roleId=route.name==='chat'&&!document.hidden&&!modalOpen&&!childDialog?route.arg:null;
    if(!roleId||!roleById(roleId)?.unread||readRequests.has(roleId))return;
    readRequests.add(roleId);
    act('conversation.read',{roleId}).then(()=>{readRequests.delete(roleId);pendingRender=true;flushRender(true);syncVisibleChatRead();}).catch(err=>{readRequests.delete(roleId);toast(err.message);});
  }
  async function api(path, body, method, internal=false,requestOptions={}) {
    const requestEpoch=authEpoch,verb = method || (body === undefined ? 'GET' : 'POST');
    const sync=internal?null:globalThis.window?.PipiStateSync?.client;
    if(sync&&verb==='GET'&&/^\/api\/state(?:\?|$)/.test(path))return sync.refresh(state?.revision??null);
    const headers={...(body!==undefined?{'Content-Type':'application/json'}:{}),...(verb!=='GET'&&csrf?{'X-CSRF-Token':csrf}:{}),...(sync?sync.headers():{})};
    if(path==='/api/engine/models')headers['X-Pipi-Model-Page']='card-save';
    let response;try{response=await window.PipiNetwork.request(path, {method:verb,credentials:'same-origin',headers,...(body===undefined?{}:{body:JSON.stringify(body)}),...requestOptions});}catch(cause){if(cause.code==='NETWORK_TIMEOUT'||cause.name==='AbortError')throw cause;throw new Error('网络连接失败，请检查网络后重试',{cause});}
    let result; try { result = await response.json(); } catch(error) { if(error.code==='NETWORK_TIMEOUT'||error.name==='AbortError')throw error;throw new Error('服务器返回了无法读取的响应，请稍后重试'); }
    if(requestEpoch!==authEpoch){const error=new Error('登录状态已变化，请重新操作');error.stale=true;throw error;}
    if (result.csrfToken) csrf = result.csrfToken;
    if(sync&&response.status!==401)result=await sync.accept(result);
    if(requestEpoch!==authEpoch){const error=new Error('登录状态已变化，请重新操作');error.stale=true;throw error;}
    if (!response.ok) {
      if (result.state) setState(result.state);
      if (response.status === 401 && !['/api/login','/api/setup'].includes(path) && !(path==='/api/account/password'&&result.code==='INVALID_PASSWORD')) { globalThis.window?.PipiStateSync?.reset();csrf = ''; state = null; window.PipiEngine?.stop(); closeModal(false); renderAuth(false); }
      const error = new Error(result.error || `请求失败（${response.status}）`); error.status = response.status; error.state = result.state;
      error.code = result.code;
      error.retryAfter = result.retryAfter;
      if (result.code === 'PROVIDER_KEY_CHANGED') error.keyRevisions = result.keyRevisions;
      throw error;
    }
    if(path==='/api/logout')globalThis.window?.PipiStateSync?.reset();
    return result;
  }
  async function apiRaw(path, body, contentType='application/octet-stream', method='POST') {
    const requestEpoch=authEpoch;
    const sync=globalThis.window?.PipiStateSync?.client;
    let response;try{response=await window.PipiNetwork.request(path, {method,credentials:'same-origin',headers:{'Content-Type':contentType,...(csrf?{'X-CSRF-Token':csrf}:{}),...(sync?sync.headers():{})},body});}catch(cause){if(cause.code==='NETWORK_TIMEOUT'||cause.name==='AbortError')throw cause;throw new Error('网络连接失败，请检查网络后重试',{cause});}
    let result;
    try { result = await response.json(); }
    catch (error) {
      if(error.code==='NETWORK_TIMEOUT'||error.name==='AbortError')throw error;
      if (response.status === 413) throw Object.assign(new Error('上传文件超过服务器或反向代理大小限制（HTTP 413），请缩小文件或调大代理体积上限'), {status: 413});
      throw new Error('服务器返回了无法读取的响应，请稍后重试');
    }
    if(requestEpoch!==authEpoch){const error=new Error('登录状态已变化，请重新操作');error.stale=true;throw error;}
    if (result.csrfToken) csrf = result.csrfToken;
    if(sync&&response.status!==401)result=await sync.accept(result);
    if(requestEpoch!==authEpoch){const error=new Error('登录状态已变化，请重新操作');error.stale=true;throw error;}
    if (!response.ok) {
      if (result.state) setState(result.state);
      if (response.status === 401) { globalThis.window?.PipiStateSync?.reset();csrf = ''; state = null; window.PipiEngine?.stop(); closeModal(false); renderAuth(false); }
      const error = new Error(result.error || `请求失败（${response.status}）`); error.status = response.status; throw error;
    }
    return result;
  }
  function readBlobData(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('媒体读取失败，请重新选择'));reader.readAsDataURL(blob);});}
  function mediaLimits(){return globalThis.window?.__pipiMediaLimits||{imageBytes:(binaryMedia?20:5)*1024*1024,animatedImageBytes:(binaryMedia?10:5)*1024*1024,audioBytes:8*1024*1024,profileImageBytes:(binaryMedia?20:5)*1024*1024,preserveOriginal:false};}
  function configureMediaLimits(status){
    const binary=status.binaryMedia===true,declared=status.mediaLimits,legacy={imageBytes:(binary?20:5)*1024*1024,animatedImageBytes:(binary?10:5)*1024*1024,audioBytes:8*1024*1024,profileImageBytes:(binary?20:5)*1024*1024,preserveOriginal:false};
    if(declared===undefined){window.__pipiMediaLimits=legacy;return;}
    const ceilings={imageBytes:64*1024*1024,animatedImageBytes:10*1024*1024,audioBytes:8*1024*1024,profileImageBytes:20*1024*1024};
    if(!declared||typeof declared!=='object'||Array.isArray(declared)||Object.entries(ceilings).some(([key,max])=>!Number.isSafeInteger(declared[key])||declared[key]<=0||declared[key]>max))throw new Error('服务器媒体上限声明无效，请更新后重试');
    window.__pipiMediaLimits={...Object.fromEntries(Object.keys(ceilings).map(key=>[key,binary?declared[key]:Math.min(declared[key],legacy[key])])),preserveOriginal:binary&&declared.imageBytes>20*1024*1024};
  }
  async function uploadMedia(blob,{requireUrl=false}={}){if(binaryMedia)return (await apiRaw('/api/media/upload',blob)).url;const source=await readBlobData(blob);return requireUrl?(await api('/api/media/upload',{image:source})).url:source;}
  function imageBlob(source){const comma=source.indexOf(','),data=atob(source.slice(comma+1)),bytes=new Uint8Array(data.length);for(let i=0;i<data.length;i++)bytes[i]=data.charCodeAt(i);return new Blob([bytes],{type:source.slice(5,source.indexOf(';'))});}
  async function uploadImageData(source,{requireUrl=false}={}){return source.startsWith('data:')&&(binaryMedia||requireUrl)?uploadMedia(imageBlob(source),{requireUrl}):source;}
  async function uploadImage(file,convertSticker=false){
    const epoch=authEpoch,blob=await readImage(file,convertSticker,true);
    if(epoch!==authEpoch)throw new Error('登录状态已变化，请重新选图');
    return uploadMedia(blob);
  }
  async function uploadProfileImage(file,options){
    const epoch=authEpoch,blob=await readProfileImage(file,true);
    if(epoch!==authEpoch)throw new Error('登录状态已变化，请重新选图');
    return uploadMedia(blob,options);
  }
  async function imageVariant(source,longEdge,quality,thumbnail=false){
    const width=source.naturalWidth||source.width,height=source.naturalHeight||source.height,ratio=Math.min(1,longEdge/Math.max(width,height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
    const context=canvas.getContext('2d');context.drawImage(source,0,0,canvas.width,canvas.height);
    const mime=thumbnail?thumbnailFormat(context,canvas.width,canvas.height):'image/jpeg';
    if(!mime)return null;
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,mime,quality));if(!blob)throw new Error('图片副本生成失败');return blob;
  }
  function thumbnailFormat(context,width,height){
    const pixels=context.getImageData(0,0,width,height).data;
    let hasAlpha=false,visible=false,hasColor=false;
    for(let i=0;i<pixels.length;i+=4){
      const alpha=pixels[i+3];
      if(alpha<255)hasAlpha=true;
      if(alpha>0){
        visible=true;
        if(Math.max(pixels[i],pixels[i+1],pixels[i+2])>3)hasColor=true;
      }
      if(hasAlpha&&visible&&hasColor)break;
    }
    // A transparent first frame or a blank black raster is better served by the original.
    if(!visible||(!hasAlpha&&!hasColor))return null;
    if(!hasAlpha)return 'image/jpeg';
    let webp=true;
    try{const probe=document.createElement('canvas');probe.width=probe.height=1;if(typeof probe.toDataURL==='function')webp=probe.toDataURL('image/webp').startsWith('data:image/webp');}catch{webp=false;}
    return webp?'image/webp':'image/png';
  }
  function checkStoredThumbnail(img){
    const sample=document.createElement('canvas');sample.width=sample.height=16;
    try{
      const context=sample.getContext('2d');
      context.drawImage(img,0,0,16,16);
      return Boolean(thumbnailFormat(context,16,16));
    }catch{return false;} // A device that blocks pixel reads can still display the original.
  }
  function rememberChatPreview(source,usable){
    chatPreviewStatus.set(source,usable);
    if(chatPreviewStatus.size>256)chatPreviewStatus.delete(chatPreviewStatus.keys().next().value);
  }
  // Read JPEG/PNG headers before asking the decoder for a bounded model-size bitmap.
  async function encodedPhotoSize(blob){
    if(blob.type!=='image/jpeg'&&blob.type!=='image/png')return null;
    const bytes=new DataView(await blob.slice(0,256*1024).arrayBuffer());
    if(bytes.byteLength<24)return null;
    if(blob.type==='image/png')return bytes.getUint32(0)===0x89504e47?{width:bytes.getUint32(16),height:bytes.getUint32(20)}:null;
    if(bytes.getUint16(0)!==0xffd8)return null;
    for(let offset=2;offset+9<bytes.byteLength;){
      if(bytes.getUint8(offset++)!==255)break;
      const marker=bytes.getUint8(offset++);if(marker===255){offset--;continue;}
      if(marker===0xda||marker===0xd9)break;
      const length=bytes.getUint16(offset);if(length<2)break;
      if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker))return {width:bytes.getUint16(offset+5),height:bytes.getUint16(offset+3)};
      offset+=length;
    }
    return null;
  }
  async function prepareChatImage(file, stillCurrent = () => true){
    const blob=await readImage(file,false,true);
    if(!stillCurrent())return;
    const image=await uploadMedia(blob),result={image};
    if(!stillCurrent())return;
    if(!imageVariants)return result;
    const dimensions=await encodedPhotoSize(blob);
    let bitmap,needsModel=blob.size>4*1024*1024;
    if(dimensions){
      const longest=Math.max(dimensions.width,dimensions.height);needsModel=needsModel||longest>2560;
      if(longest>2560){const byWidth=dimensions.width>=dimensions.height;
        try{bitmap=await createImageBitmap(blob,byWidth?{resizeWidth:2048}:{resizeHeight:2048});}catch{}
      }
    }
    if(!bitmap)try{bitmap=await createImageBitmap(blob);}catch{return result;}
    try{
      try{const thumb=await imageVariant(bitmap,320,.78,true);if(!stillCurrent())return;if(thumb)result.thumb=await uploadMedia(thumb);}catch{}
      if(!stillCurrent())return;
      if(needsModel||Math.max(bitmap.width,bitmap.height)>2560)try{const model=await imageVariant(bitmap,2048,.88);if(!stillCurrent())return;result.modelImage=await uploadMedia(model);}catch{}
      return result;
    }finally{bitmap.close();}
  }
  async function backfillThumbnail(img){
    if(!imageVariants||!img.isConnected||!img.naturalWidth)return;
    const messageId=img.closest('[data-bubble]').dataset.bubble,message=state.messages.find(item=>item.id===messageId),originalImage=message?.type==='image'?message.content:message?.meta?.image;
    if(!message||message.meta?.thumb||message.meta?.stickerId||message.meta?.expired||thumbnailAttempts.has(messageId)||!safeImage(originalImage)||img.getAttribute('src')!==originalImage)return;
    thumbnailAttempts.add(messageId);
    const epoch=authEpoch;
    try{
      const variant=await imageVariant(img,320,.78,true);
      if(!variant||epoch!==authEpoch)return;
      const thumb=await uploadMedia(variant);
      if(epoch!==authEpoch)return;
      const current=state.messages.find(item=>item.id===messageId),image=current?.type==='image'?current.content:current?.meta?.image;
      if(!current||current.meta?.thumb||image!==originalImage)return;
      const result=await api('/api/chat/media/thumbnail',{messageId,thumb,originalImage});if(result.state)setState(result.state);
    }catch{} // Missing previews are best effort; each message is attempted once per page load.
  }
  function queueChatThumbnail(img){
    if(img.dataset.thumbnailQueued)return;
    img.dataset.thumbnailQueued='true';thumbnailQueue.push(img);drainChatThumbnails();
  }
  function drainChatThumbnails(){
    while(thumbnailWorkers<2&&thumbnailQueue.length){const img=thumbnailQueue.shift();if(!img.isConnected)continue;thumbnailWorkers++;void backfillThumbnail(img).finally(()=>{thumbnailWorkers--;drainChatThumbnails();});}
  }
  function chatImageMarkup(message,original,alt,sticker=false,prioritize=false){
    const thumb=message.meta?.thumb,source=!sticker&&safeImage(thumb)&&chatPreviewStatus.get(thumb)!==false?thumb:original,size=chatImageSizes.get(source);
    const loading=prioritize&&source!==original?'loading="eager" fetchpriority="high"':'loading="lazy"';
    return `<img class="message-image${sticker?'':' chat-photo'}" data-media-preview="${source===original?'original':'thumbnail'}" src="${esc(source)}" alt="${alt}" ${loading} decoding="async"${sticker?' width="112" height="112" style="object-fit:contain"':` width="${size?.width||120}" height="${size?.height||120}" style="width:${size?.width||120}px;height:${size?.height||120}px"`}>`;
  }
  function scheduleChatPreviewWarmup(roleIds){
    const connection=navigator.connection;
    if(previewWarmupTimer||previewWarmups.size>=4||connection?.saveData||['slow-2g','2g','3g'].includes(connection?.effectiveType))return;
    previewWarmupTimer=setTimeout(()=>{
      const warm=()=>{
        previewWarmupTimer=0;if(route.name!=='chats'||document.hidden)return;
        const counts=new Map(),recent=state.messages.slice(-200);
        for(let index=recent.length-1;index>=0&&previewWarmups.size<4;index--){
          const message=recent[index],source=message.meta?.thumb;
          if(!roleIds.includes(message.roleId)||(counts.get(message.roleId)||0)>=2||message.meta?.expired||message.meta?.stickerId||!safeImage(source)||chatPreviewStatus.get(source)===false)continue;
          counts.set(message.roleId,(counts.get(message.roleId)||0)+1);if(previewWarmups.has(source))continue;
          const image=new Image();image.decoding='async';image.fetchPriority='low';previewWarmups.set(source,image);image.src=source;
          // Optional warming failures leave the normal visible image request in charge.
          void image.decode().then(()=>{const scale=Math.min(150/image.naturalWidth,186/image.naturalHeight);chatImageSizes.set(source,{width:Math.round(image.naturalWidth*scale),height:Math.round(image.naturalHeight*scale)});if(chatImageSizes.size>256)chatImageSizes.delete(chatImageSizes.keys().next().value);},()=>{});
        }
      };
      if(window.requestIdleCallback)window.requestIdleCallback(warm,{timeout:1000});else warm();
    },400);
  }
  function bindChatThumbnails(root=view){
    for(const img of root.querySelectorAll('.chat-photo')){
      const useOriginal=()=>{
        if(!img.isConnected||img.dataset.mediaPreview!=='thumbnail')return;
        const messageId=img.closest('[data-bubble]').dataset.bubble,message=state.messages.find(item=>item.id===messageId);
        const original=message?.type==='image'?message.content:message?.meta?.image;
        if(message?.meta?.expired||!safeImage(original)||img.getAttribute('src')!==message?.meta?.thumb)return;
        rememberChatPreview(message.meta.thumb,false);
        img.dataset.mediaPreview='original';img.src=original;
      };
      const loaded=()=>{
        if(!img.isConnected||!img.naturalWidth)return;
        const source=img.getAttribute('src');
        if(img.dataset.mediaPreview==='thumbnail'){
          if(!chatPreviewStatus.has(source))rememberChatPreview(source,checkStoredThumbnail(img));
          if(!chatPreviewStatus.get(source)){useOriginal();return;}
        }
        const scale=Math.min(150/img.naturalWidth,186/img.naturalHeight),width=Math.round(img.naturalWidth*scale),height=Math.round(img.naturalHeight*scale);
        chatImageSizes.delete(source);chatImageSizes.set(source,{width,height});if(chatImageSizes.size>256)chatImageSizes.delete(chatImageSizes.keys().next().value);
        const list=img.closest('#chat-messages'),bottom=list.dataset.scrollReady==='true'&&list.dataset.pinned!=='false'&&chatNearBottom(list),top=list.getBoundingClientRect().top;
        let low=0,high=list.children.length;while(low<high){const middle=(low+high)>>1;if(list.children[middle].getBoundingClientRect().bottom<=top)low=middle+1;else high=middle;}
        const anchor=list.children[low],before=anchor?.getBoundingClientRect().top;
        img.style.width=width+'px';img.style.height=height+'px';img.width=width;img.height=height;
        if(list.dataset.scrollReady==='true'){if(bottom)list.scrollTop=list.scrollHeight;else if(anchor)list.scrollTop+=anchor.getBoundingClientRect().top-before;}
        if(imageVariants)queueChatThumbnail(img);
      };
      img.addEventListener('load',loaded);
      img.addEventListener('error',useOriginal);
      if(img.complete){if(img.naturalWidth)loaded();else useOriginal();}
    }
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
    const hadModal=modalOpen,callback=modalCloseCallback,childDepth=childDialog&&history.state?.childDialog===childDialog.id?1:0;closeChildDialog(true);modalCloseCallback=null;if(hadModal)globalThis.window?.PipiMotion?.captureOverlayExit(overlay);overlay.classList.remove('has-contact-remark','has-chat-background');overlay.replaceChildren(); modalOpen = false; if(modalReturnFocus?.isConnected)modalReturnFocus.focus({preventScroll:true}); modalReturnFocus=null;if(hadModal&&!fromHistory&&history.state?.overlay){if(overlayBackPending)overlayCloseQueued=notifyClose===false?'all':true;else{overlayBackPending=true;const depth=(notifyClose===false?(history.state.overlayDepth||1):1)+childDepth;if(depth>1)history.go(-depth);else history.back();}}if(notifyClose!==false&&typeof callback==='function')callback();if(hadModal&&state)scheduleRender();globalThis.window?.PipiExpiry?.sync();
  }
  function bindSheetBackdrop() {
    let pressedSheet=null;
    overlay.addEventListener('pointerdown',event=>{
      const sheets = window.ClassicSocial ? ':scope > .model-sheet,:scope > .usage-sheet,:scope > .contact-remark-editor,:scope > .chat-background-editor' : ':scope > .model-sheet,:scope > .usage-sheet';
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
    overlay.classList.remove('has-contact-remark','has-chat-background');
    trackModalHistory();
    const isPage = navigation === 'back';
    const headerAction = onSubmit && submitLabel !== null
      ? `<button type="submit" class="primary-btn modal-submit">${esc(submitLabel)}</button>`
      : '<span></span>';
    overlay.innerHTML = `<section class="modal-sheet page-editor" data-navigation="${isPage ? 'back' : 'cancel'}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><form class="modal-form"><div class="modal-header"><button type="button" class="modal-close${isPage ? ' modal-back' : ''}" data-close aria-label="${isPage ? '返回' : '取消'}">${isPage ? icons.back : '取消'}</button><h3>${esc(title)}</h3>${headerAction}</div><div class="modal-body">${html}</div><div class="modal-error" role="alert"></div></form></section>`;
    overlay.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeModal));
    const form = overlay.querySelector('form');
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!onSubmit) return;
      const button = form.querySelector('[type=submit]'); if (button.disabled) return;
      const closeButton=lockWhileSaving?form.querySelector('[data-close]'):null;
      if(closeButton){modalSaveInProgress=true;closeButton.disabled=true;form.setAttribute('aria-busy','true');}
      button.disabled = true; const oldText = button.textContent; button.textContent = lockWhileSaving?'保存中':'处理中';const body=form.querySelector('.modal-body');if(body)body.inert=true;
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
  function changedFields(original, values) {
    return Object.fromEntries(Object.entries(values).filter(([key, value]) => original[key] !== value));
  }
  function cell(title, icon, action, value = '', color = '', description = '') {
    return `<button class="cell list-item" data-action="${esc(action)}"><span class="cell-icon" style="color:${color || '#555'}">${icons[icon] || icons.services}</span><span class="cell-main"><span class="cell-body"><span class="cell-title">${esc(title)}</span>${description ? `<span class="cell-desc">${esc(description)}</span>` : ''}</span>${value ? `<span class="cell-value">${esc(value)}</span>` : ''}${icons.chevron}</span></button>`;
  }
  function visibleUnreadCount(exceptRoleId) {
    return (state?.roles || []).reduce((total, role) =>
      role.hidden || role.muted || role.id === exceptRoleId ? total : total + (Number(role.unread) || 0), 0);
  }
  function header(title, {back = false, right = '', centered = true} = {}) {
    const otherUnread=route.name==='chat'?visibleUnreadCount(route.arg):0;
    const chatProgress=route.name==='chat'&&!chatSelection;
    const progress=activeChatProgress?.roleId===route.arg?activeChatProgress:null,slow=slowReplyRole===route.arg;
    const heading=chatProgress?`<span data-chat-title>${esc(title)}</span><span class="chat-retry-status" ${slow||progress?.phase?'':'hidden'}><span data-chat-progress-text>${esc(slow?'网络较慢，正在重试…':chatProgressLabel(progress))}</span><button type="button" data-chat-cancel ${slow?'':'hidden'}>取消</button></span>`:esc(title);
    const barClass=route.name==='moments'?'moments-topbar':route.name==='chat'&&chatSelection?'chat-selection-head':'';
    return `<header class="topbar ${barClass}"><div class="header-leading">${back ? `<button class="back-btn" data-action="back" aria-label="返回">${icons.back}${otherUnread?`<span class="chat-back-count">${otherUnread>99?'99+':otherUnread}</span>`:`<span>${back === true ? '' : esc(back)}</span>`}</button>` : ''}</div><h2 class="${centered?'title-centered':''}">${heading}</h2><div class="header-actions">${right}</div></header>`;
  }
  const iconButton = (icon, action, label) => `<button class="icon-btn" data-action="${esc(action)}" aria-label="${esc(label)}">${icons[icon] || ''}</button>`;
  function tabbar(active) {
    const unread = visibleUnreadCount();
    return `<nav class="bottom-tabs" aria-label="主要导航">${[['chats','chat','消息'],['contacts','contacts','通讯录'],['discover','discover','发现'],['me','me','我']].map(([name,icon,label]) => `<button class="tab ${active===name?'active':''}" data-nav="${name}" ${active===name?'aria-current="page"':''}>${name==='chats'?icons.chat:assetIcon(({contacts:'address-book',discover:'discover',me:'people'})[name]+(active===name?'-filled':'-outlined'))}${name==='chats'&&unread ? `<span class="tab-dot">${unread>99?'99+':unread}</span>`:''}<span class="tab-label">${label}</span></button>`).join('')}</nav>`;
  }
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let navigationAnimation,navigationCleanup;
  function startPageTransition(name,arg,fromBack){
    if(globalThis.window?.PipiMotion?.preparePageTransition)return globalThis.window.PipiMotion.preparePageTransition(view,route,name,arg,fromBack);
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
    if(name==='account-security'&&!accountSecurity)name='settings';
    if(name==='account-security'&&route.name!=='account-security')window.PipiAccount.enter();
    if(name==='storage'&&!storageMaintenance)name='settings';
    if(name==='storage'&&route.name!=='storage')window.PipiStorage.enter();
    if(state&&roleRoutes.has(name)&&!roleById(arg?.roleId||arg?.id||arg)){if(fromBack&&navStack.length){history.back();return;}const list=name==='chat'?'chats':'contacts';if(fromBack)history.replaceState({pipi:true,route:{name:list,arg:null},stack:[]},'');name=list;arg=undefined;navStack.length=0;}
    if(overlayBackPending){queuedView={name,arg,fromBack};return;}
    if(chatSelection&&(name!=='chat'||(arg?.roleId||arg?.id||arg)!==chatSelection.roleId)){finishMessageSelection();if(overlayBackPending){queuedView={name,arg,fromBack};return;}}
    if(modalOpen&&history.state?.overlay&&!fromBack){closeModal(false);queuedView={name,arg,fromBack};return;}
    globalThis.window?.PipiAndroidPage?.leaving(route);
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
      drafts.set(route.arg,{text:composeText,image:composeImage,imageMeta:composeImageMeta,stickerId:composeStickerId,quote:quoteId,panel,selection:{...composerSelection},scroll:{...composerScroll},morePage,emojiPage,emojiTab,emojiSearch,emojiExpandedHeight});
      const list=view.querySelector('#chat-messages');if(list?.dataset.scrollReady==='true'){if(list.dataset.pinned==='true'&&chatNearBottom(list))chatScrolls.delete(route.arg);else chatScrolls.set(route.arg,list.scrollTop);}
    }
    persistChatDrafts();
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
    if(route.name==='farm'&&!fromBack){
      const content=view.querySelector('.content');
      if(content)history.replaceState({...history.state,route:{...route,farmPosition:capturePagePosition(content)}},'');
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
      composeText=draft?.text||'';composeImage=draft?.image||'';composeImageMeta=draft?.imageMeta||null;composeStickerId=draft?.stickerId||'';quoteId=draft?.quote||'';
      composerSelection=draft?.selection?{...draft.selection}:{start:composeText.length,end:composeText.length};composerScroll=draft?.scroll?{...draft.scroll}:{input:0,emoji:0};
      const returningFromPayment=fromBack&&route.name==='wallet'&&route.arg?.roleId===nextArg&&['transfer','redpacket'].includes(route.arg?.mode);
      panel=draft?.panel==='voice'?'voice':returningFromPayment&&draft?.panel==='more'?'more':'';morePage=draft?.morePage||0;emojiPage=draft?.emojiPage||0;emojiTab=draft?.emojiTab||'all';emojiSearch=draft?.emojiSearch||'';emojiExpandedHeight=draft?.emojiExpandedHeight||0;
    }
    route = {name,arg:nextArg,...(name==='settings'&&fromBack?{scrollTop:history.state?.route?.scrollTop||0}:{})};
    if(!fromBack&&['chats','contacts','discover','me'].includes(name))globalSearchTerm='';
    if(!fromBack)history.pushState({pipi:true,route:{...route},stack:[...navStack]},'');
    searchOpen = false; searchTerm = name==='contacts'&&fromBack?contactsReturn?.term||'':'';if(name==='contacts'&&!fromBack&&contactsReturn?.term)contactsReturn=null;
    const momentsPosition=name==='moments'&&fromBack?history.state?.route?.momentsPosition:null;
    const farmPosition=name==='farm'&&fromBack?history.state?.route?.farmPosition:null;
    refresh({resetScroll:Boolean(momentsPosition||farmPosition)});
    if(momentsPosition)restorePagePosition(view.querySelector('.moments-content'),momentsPosition);
    if(farmPosition)restorePagePosition(view.querySelector('.content'),farmPosition);
    playTransition?.();
    if(name==='skins')refreshSkinActivation();
    activateChatPages();
    if(name==='chat'){syncVisibleChatRead();syncChatProgress();}
    globalThis.window?.PipiAndroidPage?.navigated();
    globalThis.window?.PipiChatNotice?.navigated();
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
  // Leaving the status picker/editor returns to the page that opened the flow
  // (for example 我 or 我的状态) as a real history step, so the transition runs
  // backwards and the system back button does not reopen the editor.
  function leaveStatusFlow(includeStatusPage=false){
    const flow=new Set(['status-picker','status-editor',...(includeStatusPage?['status']:[])]);
    if(!flow.has(route.name)){refresh();return;}
    let depth=1;
    for(let i=navStack.length-1;i>=0&&flow.has(navStack[i].name);i--)depth++;
    if(depth>navStack.length||overlayBackPending||modalOpen||childDialog){showView('me');return;}
    history.go(-depth);
  }
  function goBack(){if(overlayBackPending){queuedBack=true;return;}if(childDialog){closeChildDialog();return;}if(modalOpen){closeModal();return;}if(window.PipiFeatures?.handleBack?.('button'))return;if(chatSelection){finishMessageSelection();return;}if(navStack.length){history.back();}else showView('chats',undefined,true);}
  function refresh({resetScroll=false}={}) {
    const pageKey=JSON.stringify([route.name,route.arg]);
    const preserve=!resetScroll&&!['chat','contacts','settings','role-config','life-workbench'].includes(route.name)&&view.dataset.pageKey===pageKey;
    const content=preserve?view.querySelector('.content'):null;
    const position=content?capturePagePosition(content):null;
    const active=document.activeElement;
    const conversation = view.contains(active) ? active.closest('.conversation-wrap')?.querySelector('[data-open-chat]') : null;
    let focusSelector='';
    if(view.dataset.pageKey===pageKey&&view.contains(active)&&active.matches('button,a[href],summary')){
      if(conversation)focusSelector='[data-open-chat="'+CSS.escape(conversation.dataset.openChat)+'"]';
      else if(active.id)focusSelector='#'+CSS.escape(active.id);
      else{
        const attributes=[...active.attributes].filter(a=>a.name.startsWith('data-')||a.name==='aria-label');
        if(attributes.length)focusSelector=active.localName+attributes.map(a=>'['+CSS.escape(a.name)+'='+(a.value?CSS.escape(a.value):'""')+']').join('');
      }
      if(focusSelector&&view.querySelectorAll(focusSelector).length!==1)focusSelector='';
    }
    renderView();
    view.dataset.pageKey=JSON.stringify([route.name,route.arg]);
    if(position&&view.dataset.pageKey===pageKey)restorePagePosition(view.querySelector('.content'),position);
    if(focusSelector&&document.activeElement===document.body&&view.dataset.pageKey===pageKey){
      const targets=view.querySelectorAll(focusSelector);
      if(conversation && (!targets.length || targets[0].closest('[hidden]'))){
        view.querySelector('.classic-chat-filters [aria-pressed="true"]')?.focus({preventScroll:true});
      }else if(targets.length===1)targets[0].focus({preventScroll:true});
    }
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
    if(route.name==='chat'){
      const historyWindow=chatHistoryWindows.get(route.arg);
      position.bottom=!historyWindow?.endId&&chatNearBottom(content);
      if(!position.bottom&&historyWindow)position.chatHistoryWindow=historyWindow;
      if(!position.bottom&&window.PipiStateSync?.client?.paging){
        const rect=content.getBoundingClientRect(),rows=[...content.querySelectorAll('[data-message]')],anchor=rows.find(row=>row.getBoundingClientRect().bottom>rect.top);
        if(anchor){position.anchor=anchor.dataset.message;position.offset=anchor.getBoundingClientRect().top-rect.top;position.afterAnchor=(rows.find(row=>row.getBoundingClientRect().top>=rect.bottom)||rows[rows.length-1]).dataset.message;}
      }
    }
    if(route.name==='providers'){
      position.modelCategory=window.PipiModels.getCategory();
      position.modelProvider=window.PipiModels.getExpanded();
      position.modelAdvanced=content.querySelector('.inline-provider-options')?.open;
    }
    if(route.name==='engine-usage')position.usage=window.PipiUsage.getView();
    try{sessionStorage.setItem(browserPositionKey,JSON.stringify({route:[route.name,route.arg],position,modelDrafts:window.PipiModels?.captureDrafts()}));}catch{}
  }
  function persistChatDrafts(){if(!state)return;const saved={};for(const [roleId,draft] of drafts)if(draft.text||draft.quote)saved[roleId]={text:draft.text||'',quote:draft.quote||''};if(route.name==='chat'){delete saved[route.arg];if(composeText||quoteId)saved[route.arg]={text:composeText,quote:quoteId};}try{if(Object.keys(saved).length)sessionStorage.setItem(chatDraftKey,JSON.stringify(saved));else sessionStorage.removeItem(chatDraftKey);}catch{}}
  function restoreChatDrafts(){let saved;try{saved=JSON.parse(sessionStorage.getItem(chatDraftKey)||'{}');}catch{return;}for(const [roleId,draft] of Object.entries(saved||{}))if(roleById(roleId)&&typeof draft?.text==='string'&&!drafts.has(roleId))drafts.set(roleId,{text:draft.text,quote:typeof draft.quote==='string'?draft.quote:''});const draft=route.name==='chat'?drafts.get(route.arg):null;if(draft&&!composeText&&!quoteId){composeText=draft.text;quoteId=draft.quote;composerSelection={start:composeText.length,end:composeText.length};}}
  function captureAndroidPage(){
    const paged=Boolean(globalThis.window?.PipiStateSync?.client?.paging);
    if(route.name==='chat'&&view.dataset.chatRole===route.arg){
      const input=view.querySelector('#compose-text');if(input)composeText=readComposerText(input);
      const list=view.querySelector('#chat-messages'),role=roleById(route.arg);
      if(list?.dataset.scrollReady==='true'&&role){
        const rect=list.getBoundingClientRect(),allRows=[...list.querySelectorAll('[data-message]')],rows=allRows.filter(row=>{const box=row.getBoundingClientRect();return box.bottom>rect.top&&box.top<rect.bottom;}),anchor=rows[0],historyWindow=chatHistoryWindows.get(route.arg);
        const ids=new Set(rows.map(row=>row.dataset.message)),previous=androidReadings.get(route.arg)?.messages||[];
        const visible=state.messages.filter(message=>ids.has(message.id)&&message.type==='text'&&['user','assistant'].includes(message.sender)).map(message=>({id:message.id,sender:message.sender,content:message.content}));
        const rememberedIds=new Set([...previous,...visible].map(message=>message.id));
        const messages=state.messages.filter(message=>rememberedIds.has(message.id)&&message.type==='text'&&['user','assistant'].includes(message.sender)).map(message=>({id:message.id,sender:message.sender,content:message.content})).slice(-100);
        androidReadings.delete(route.arg);androidReadings.set(route.arg,{roleId:route.arg,name:roleName(role),top:list.scrollTop,bottom:!historyWindow?.endId&&chatNearBottom(list),anchor:anchor?.dataset.message||'',afterAnchor:(allRows.find(row=>row.getBoundingClientRect().top>=rect.bottom)||allRows[allRows.length-1])?.dataset.message||'',offset:anchor?anchor.getBoundingClientRect().top-rect.top:0,limit:historyWindow?.limit||chatHistoryPageSize,endId:historyWindow?.endId||'',messages});
        if(androidReadings.size>8)androidReadings.delete(androidReadings.keys().next().value);
      }
    }
    const savedDrafts=[...drafts].map(([roleId,draft])=>({roleId,text:draft.text||''})).filter(draft=>draft.roleId!==route.arg||route.name!=='chat');
    if(route.name==='chat')savedDrafts.push({roleId:route.arg,text:composeText});
    const currentMessages=new Map(state.messages.map(message=>[message.id,message]));
    const chats=[...androidReadings.values()].filter(chat=>roleById(chat.roleId)).map(chat=>({...chat,name:roleName(roleById(chat.roleId)),messages:chat.messages.map(message=>currentMessages.get(message.id)||(paged?{...message,type:'text'}:null)).filter(message=>message&&message.type==='text'&&['user','assistant'].includes(message.sender)).map(message=>({id:message.id,sender:message.sender,content:message.content}))}));
    return {route,stack:navStack,drafts:savedDrafts.filter(draft=>roleById(draft.roleId)),chats,contacts:state.roles.filter(role=>!role.deleted).map(role=>({roleId:role.id,name:roleName(role)})),chatsTop:route.name==='chats'?view.querySelector('.content')?.scrollTop||0:chatsReturn,contactsTop:route.name==='contacts'?view.querySelector('.content')?.scrollTop||0:contactsReturn?.top||0};
  }
  function restoreAndroidPage(){
    const saved=window.PipiAndroidPage?.restore();if(!saved)return null;
    for(const draft of drafts.values()){draft.text='';draft.quote='';}
    composeText='';quoteId='';
    for(const draft of saved.drafts)if(roleById(draft.roleId))drafts.set(draft.roleId,{text:draft.text,quote:''});
    for(const chat of saved.chats)if(roleById(chat.roleId)){
      androidReadings.set(chat.roleId,chat);
      if(window.PipiStateSync?.client?.paging&&chat.messages.length)recheckAndroidReading(chat);
      if(!chat.bottom){chatScrolls.set(chat.roleId,chat.top);chatHistoryWindows.set(chat.roleId,{limit:chat.limit,endId:chat.endId});}
    }
    chatsReturn=saved.chatsTop;contactsReturn={top:saved.contactsTop,term:''};
    if(!restoredPage&&!androidInboxEntry){
      route=saved.route;navStack.splice(0,navStack.length,...saved.stack);if(route.name==='chat'&&!navStack.length)navStack.push({name:'chats',arg:null});
      const pages=[...navStack,route];pages.forEach((page,index)=>{const entry={pipi:true,route:{...page},stack:pages.slice(0,index)};if(index)history.pushState(entry,'');else history.replaceState(entry,'');});
    }
    const draft=route.name==='chat'?drafts.get(route.arg):null;
    if(draft&&!composeText){composeText=draft.text;composerSelection={start:composeText.length,end:composeText.length};}
    persistChatDrafts();
    return route.name==='chat'?androidReadings.get(route.arg):null;
  }
  async function recheckAndroidReading(saved){
    const epoch=authEpoch;
    try{
      const ids=saved.messages.map(message=>message.id).join(',');
      const page=await api('/api/messages/by-id?roleId='+encodeURIComponent(saved.roleId)+'&ids='+encodeURIComponent(ids));
      if(epoch!==authEpoch||androidReadings.get(saved.roleId)!==saved)return;
      const messages=page.messages.filter(m=>m.type==='text'&&['user','assistant'].includes(m.sender)).map(m=>({id:m.id,sender:m.sender,content:m.content}));
      androidReadings.set(saved.roleId,{...saved,messages});window.PipiAndroidPage.checkpoint();
    }catch(error){if(epoch===authEpoch&&!error.stale)console.warn('未能核对本机保存的聊天文字',error.message);}
  }
  function restoreAndroidAnchor(reading){
    if(!reading||reading.bottom)return;
    requestAnimationFrame(()=>{const list=view.querySelector('#chat-messages');if(route.name!=='chat'||route.arg!==reading.roleId||!list)return;const anchor=[...list.querySelectorAll('[data-message]')].find(row=>row.dataset.message===reading.anchor);list.dataset.pinned='false';list.dataset.scrollReady='true';if(anchor)list.scrollTop+=anchor.getBoundingClientRect().top-list.getBoundingClientRect().top-reading.offset;chatScrolls.set(reading.roleId,list.scrollTop);});
  }
  async function restoreBrowserPage(){
    const androidReading=restoreAndroidPage();
    if(roleRoutes.has(route.name)&&!roleById(route.arg)){route={name:route.name==='chat'?'chats':'contacts',arg:null};navStack.length=0;history.replaceState({pipi:true,route:{...route},stack:[]},'');}
    restoreChatDrafts();
    if(route.name==='account-security'){if(accountSecurity)window.PipiAccount.enter();else route={name:'settings',arg:null};}
    if(route.name==='storage'){if(storageMaintenance)window.PipiStorage.enter();else route={name:'settings',arg:null};}
    let saved=null,snapshot=null;
    try{saved=sessionStorage.getItem(browserPositionKey);sessionStorage.removeItem(browserPositionKey);}catch{}
    try{snapshot=saved?JSON.parse(saved):null;}catch{snapshot=null;}
    const position=restoredPage&&JSON.stringify(snapshot?.route)===JSON.stringify([route.name,route.arg])?snapshot.position:null;
    if(snapshot?.modelDrafts)window.PipiModels?.restoreDrafts(snapshot.modelDrafts);
    if(['engine-home','providers','engine-functions','engine-module'].includes(route.name))await window.PipiEngine.refreshConfig();
    if(route.name==='providers'&&position?.modelCategory)window.PipiModels.restoreCategory(position.modelCategory,position.modelProvider);
    if(route.name==='engine-usage')await window.PipiUsage.restoreView(position?.usage);
    if(position&&route.name==='chat'&&!position.bottom){
      chatScrolls.set(route.arg,position.top);
      if(Number.isSafeInteger(position.chatHistoryWindow?.limit)&&position.chatHistoryWindow.limit>=chatHistoryPageSize)chatHistoryWindows.set(route.arg,position.chatHistoryWindow);
    }
    refresh();
    if(route.name==='providers'&&position?.modelAdvanced){const details=view.querySelector('.inline-provider-options');if(details)details.open=true;}
    if(position&&route.name===restoredPage.route.name&&route.name!=='chat'&&route.name!=='role-config'){
      restorePagePosition(view.querySelector('.content'),position);
    }
    const reading=androidReading||position?.anchor&&{roleId:route.arg,anchor:position.anchor,afterAnchor:position.afterAnchor,offset:position.offset,bottom:false};
    const paging=window.PipiStateSync?.client?.paging;
    if(paging&&route.name==='chat'&&reading?.anchor&&!reading.bottom){paging.setActive(route.arg);await requestChatPage('restore',route.arg,reading.anchor,reading);}
    else{await activateChatPages();restoreAndroidAnchor(reading);}
    window.PipiAndroidPage?.ready();
  }
  function pressTimer(run,delay){const id=setTimeout(()=>{pressTimers.delete(id);run();},delay);pressTimers.add(id);return id;}
  function renderView() {
    if (!state) return;
    const list=view.querySelector('#chat-messages');
    if(route.name==='chat'&&view.dataset.route==='chat'&&view.dataset.chatRole===route.arg&&list&&roleById(route.arg)&&!focusMessageId&&!chatSelection&&!list.classList.contains('chat-selecting')){
      pendingRender=false;patchChatRows(list);return;
    }
    if(route.name==='chat'&&view.dataset.route==='chat'&&composerPointerBusy()){pointerViewRefreshPending=true;pendingRender=true;return;}
    if(recordingSession?.mode==='hold'){pendingRender=true;return;}
    if(searchComposing||(route.name==='chat'&&composeComposing&&view.dataset.route==='chat')){pendingRender=true;return;}
    for(const timer of pressTimers)clearTimeout(timer);pressTimers.clear();
    const previousInput=view.querySelector('#compose-text'),previousEmoji=view.querySelector('.emoji-scroll');
    if(route.name==='chat'&&view.dataset.chatRole===route.arg){if(previousInput)composerScroll.input=previousInput.scrollTop;if(previousEmoji)composerScroll.emoji=previousEmoji.scrollTop;}
    window.PipiFeatures?.cleanup?.();
    const previousContacts=route.name==='contacts'&&view.dataset.route==='contacts'?view.querySelector('.content.contacts'):null;
    if(previousContacts)contactsReturn={top:view.dataset.contactsTerm===searchTerm?previousContacts.scrollTop:0,term:searchTerm};
    if(route.name==='settings'&&view.dataset.route==='settings')route.scrollTop=view.querySelector('.settings-content').scrollTop;
    const previousChat=view.querySelector('#chat-messages');
    previousChat?.rowObserver?.disconnect();previousChat?.rowMutations?.disconnect();
    if(previousChat?.dataset.scrollReady==='true'&&view.dataset.chatRole===route.arg&&route.name==='chat'&&forceBottomRole!==route.arg){if(!chatHistoryWindows.get(route.arg)?.endId&&chatNearBottom(previousChat))chatScrolls.delete(route.arg);else chatScrolls.set(route.arg,previousChat.scrollTop);}
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
      view.innerHTML = header(titles[name],{back:true,right:name==='moments'&&(!route.arg?.roleId||route.arg?.roleId==='me')?iconButton('camera','compose-moment','发表朋友圈')+iconButton('more','moments-settings','朋友圈管理'):name==='moments'?iconButton('more','moments-settings','朋友圈管理'):name==='wallet'?'<button class="nav-text" data-action="wallet-bills">账单</button>':''}) + `<div class="content page-content feature-content ${name==='moments'?'moments-content':''}">${window.PipiFeatures?.render(name,route.arg) || '<div class="empty">这个页面暂未开放</div>'}</div>`;
      window.PipiFeatures?.bind(name,route.arg); bindMain(); return;
    }
    if (routes.has(name)) { view.innerHTML=routes.get(name)(route.arg); bindMain(); return; }
    if(name==='contact-more'){view.innerHTML=renderContactMore();bindMain();return;}
    if(['stickers','contact-tags','tag-contacts'].includes(name)){view.innerHTML=name==='stickers'?renderStickers():renderContactTags();bindMain();return;}
    const renderers = {chats:renderChats,'global-search':renderGlobalSearch,contacts:renderContacts,discover:renderDiscover,me:renderMe,skins:renderSkins,chat:renderChat,role:renderRole,settings:renderSettings,memories:renderMemories,profile:renderProfile,about:renderAbout,backup:renderBackup,'chat-info':renderChatInfo,'role-config':renderRoleConfig,'contact-settings':renderContactSettings,'contact-permissions':renderContactPermissions,blacklist:renderBlacklist,'chat-search':renderChatSearch,'new-friends':renderNewFriends,'add-friend':renderAddFriend,'profile-more':renderProfileMore,'status':renderStatus,'status-history':renderStatusHistory,'status-picker':renderStatusPicker,'status-editor':renderStatusEditor};
    if (!renderers[name]) { route = {name:'chats',arg:null}; }
    paintMainView((renderers[route.name] || renderChats)()); bindMain();
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
  function paintMainView(html) {
    const tabs=view.querySelector(':scope > .bottom-tabs');
    view.innerHTML=html;
    const nextTabs=view.querySelector(':scope > .bottom-tabs');
    if(tabs&&nextTabs){
      for(const next of nextTabs.querySelectorAll('[data-nav]')){
        const button=tabs.querySelector(`[data-nav="${next.dataset.nav}"]`);
        button.classList.toggle('active',next.classList.contains('active'));
        if(next.hasAttribute('aria-current'))button.setAttribute('aria-current','page');
        else button.removeAttribute('aria-current');
        const icon=button.querySelector('.mask-icon'),nextIcon=next.querySelector('.mask-icon');
        if(icon&&icon.style.cssText!==nextIcon.style.cssText)icon.style.cssText=nextIcon.style.cssText;
        const dot=button.querySelector('.tab-dot'),nextDot=next.querySelector('.tab-dot');
        if(nextDot){if(dot)dot.textContent=nextDot.textContent;else button.append(nextDot);}
        else dot?.remove();
      }
      nextTabs.replaceWith(tabs);
    }
    paintAvatars(view);
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
    if(message.meta?.expired&&message.type!=='text')return message.meta.expired.kind==='voice'?'[语音已过期]':'[图片已过期]';
    const text = ({image:'[图片]',voice:'[语音]',forward:'[聊天记录]',transfer:'[转账]',redpacket:'[红包]'})[message.type] || String(message.content || '');
    return text;
  }
  function renderChats() {
    const unread=visibleUnreadCount();
    const lastMessages=new Map();
    for(const message of state.messages)lastMessages.set(message.roleId,message);
    const visible = (state.roles||[]).filter(r=>!r.hidden).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned) || new Date(lastMessages.get(b.id)?.createdAt || 0)-new Date(lastMessages.get(a.id)?.createdAt || 0));
    scheduleChatPreviewWarmup(visible.slice(0,2).map(role=>role.id));
    return header(unread?`微信 (${unread>99?'99+':unread})`:'微信', {right:iconButton('plus','new-menu','添加')}) + `<div class="search-bar"><button class="search-input-wrap search-entry" data-action="global-search" aria-label="搜索联系人与消息">${icons.search}<span>搜索</span></button></div><div class="content"><div class="conversation-list">${visible.map(r=>{
      const msg=lastMessages.get(r.id); return `<div class="conversation-wrap"><div class="conversation-actions" aria-hidden="true"><button type="button" tabindex="-1" class="unread-action" data-conv="${r.unread?'read':'unread'}" data-role="${esc(r.id)}">${r.unread?'标为已读':'标为未读'}</button><button type="button" tabindex="-1" class="hide-action" data-conv="hide" data-role="${esc(r.id)}">不显示</button><button type="button" tabindex="-1" class="delete-action" data-conv="delete" data-role="${esc(r.id)}">删除</button></div><button class="conversation ${r.pinned?'pinned':''}" data-role="${esc(r.id)}" data-open-chat="${esc(r.id)}"><span class="conversation-avatar">${avatar(r,48)}${r.unread?(r.muted?'<span class="unread-dot"></span>':`<span class="unread-badge">${r.unread>99?'99+':r.unread}</span>`):''}</span><span class="conversation-copy"><span class="conversation-line"><span class="conversation-name">${esc(roleName(r))}</span><time class="conversation-time">${esc(shortTime(msg?.createdAt))}</time></span><span class="conversation-preview">${msg?.status==='error'?'<span class="failed">!</span>':''}${r.muted&&r.unread>1?'['+r.unread+'条] ':''}${esc(preview(msg))}</span></span>${r.muted?assetIcon('muted',false,'conversation-muted'):''}</button></div>`;
    }).join('') || `<div class="empty"><h3>暂无聊天</h3><p>创建朋友后，就可以开始聊天。</p><button class="primary-btn" data-action="add-role">创建新朋友</button></div>`}</div></div>${tabbar('chats')}`;
  }
  function loadedSearchMessages(roleId,term,type,dateFilter) {
    return (state.messages||[]).filter(m=>{
      if((roleId&&m.roleId!==roleId)||!String(m.type==='image'?'[图片]':m.meta?.transcript||m.content).toLowerCase().includes(term))return false;
      if(type==='image'&&m.type!=='image'&&!safeImage(m.meta?.image))return false;
      if(type==='payment'&&!['transfer','redpacket'].includes(m.type))return false;
      if(type==='voice'&&m.type!=='voice')return false;
      if(type==='forward'&&m.type!=='forward')return false;
      if(type==='link'&&(m.type!=='text'||!/(?:https?:\/\/|www\.)[^\s]+/i.test(m.content)))return false;
      const date=new Date(m.createdAt),day=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
      return !dateFilter||day===dateFilter;
    });
  }
  function bindHistorySearch() {
    const area=view.querySelector('[data-history-results]');
    if(!area){window.PipiHistorySearch.reset();return;}
    const global=route.name==='global-search',roleId=global?'':route.arg,r=roleById(roleId);
    const term=(global?globalSearchTerm:chatSearch).trim().toLowerCase();
    const type=global?'all':chatSearchFilter,date=global?'':chatSearchDate;
    if(!term&&type==='all'&&!date){
      window.PipiHistorySearch.reset();
      if(!global)area.innerHTML='<div class="empty">搜索与这位朋友的聊天记录</div>';
      return;
    }
    window.PipiHistorySearch.bind({roleId,term,type,date,area,
      local:()=>{
        const matches=loadedSearchMessages(roleId,term,type,date);
        return global?matches.reverse():matches;
      },
      request:(url,signal)=>api(url,undefined,'GET',false,{signal}),
      jump:(id,message)=>window.Pipi.jumpToMessage(id,message),
      render:(messages,loading)=>{
        if(global)return messages.filter(m=>roleById(m.roleId)).map(m=>{const r=roleById(m.roleId);return `<button class="search-result" data-global-message="${esc(m.id)}" data-search-role="${esc(r.id)}">${avatar(m.sender==='user'?state.profile:r,40)}<span><b>${esc(roleName(r))}</b><p>${richText(preview(m))}</p><time>${esc(shortTime(m.createdAt))}</time></span></button>`;}).join('')||(loading?'':'<p class="search-empty">没有找到聊天记录</p>');
        return messages.map(m=>`<button class="search-result" data-search-message="${esc(m.id)}" aria-label="查看这条消息">${avatar(m.sender==='system'?{}:m.sender==='user'?state.profile:r,40)}<span><b>${esc(m.sender==='system'?'系统消息':m.sender==='user'?state.profile?.name:roleName(r))}</b><p>${richText(m.type==='voice'&&m.meta?.transcript?m.meta.transcript:preview(m))}</p><time>${esc(shortTime(m.createdAt))}</time></span></button>`).join('')||(loading?'':'<div class="empty">没有找到相关聊天记录</div>');
      }
    });
  }
  function renderGlobalSearch() {
    const term=globalSearchTerm.trim().toLowerCase();
    const contacts=term?(state.roles||[]).filter(r=>`${roleName(r)} ${r.name} ${r.wechatId||''}`.toLowerCase().includes(term)):[];
    return `<div class="search-bar global-search-bar"><label class="search-input-wrap">${icons.search}<input id="list-search" type="search" placeholder="搜索" value="${esc(globalSearchTerm)}" aria-label="搜索联系人与全部聊天记录">${globalSearchTerm?'<button type="button" class="search-clear" data-action="clear-list-search" aria-label="清除搜索">×</button>':''}</label><button class="nav-text" data-action="cancel-global-search">取消</button></div><div class="content global-search-results">${term?`<h3>联系人</h3><section class="section">${contacts.map(r=>`<button class="cell" data-nav="role" data-arg="${esc(r.id)}">${avatar(r,40)}<span class="cell-body cell-title">${esc(roleName(r))}</span></button>`).join('')||'<p class="search-empty">没有找到联系人</p>'}</section><h3>聊天记录</h3><section class="section" data-history-results></section>`:'<p class="search-empty">搜索联系人与聊天记录</p>'}</div>`;
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
    return header('通讯录',{right:iconButton('addFriend','add-friend','添加朋友')})+`<div class="search-bar"><label class="search-input-wrap">${icons.search}<input id="list-search" type="search" value="${esc(searchTerm)}" placeholder="搜索" aria-label="搜索联系人">${searchTerm?'<button type="button" class="search-clear" data-action="clear-list-search" aria-label="清除搜索">×</button>':''}</label></div><div class="content contacts${rail?' contacts-has-index':''}">${!searchTerm?tools.map(([title,icon,action,color])=>`<button class="cell" data-action="${action}"><span class="contact-tool" style="background:${color}">${icons[icon]}</span><span class="cell-body"><span class="cell-title">${title}</span></span></button>`).join(''):''}${rows}<div class="contacts-count">${contacts.length}个朋友</div></div>${rail}${tabbar('contacts')}`;
  }
  function renderDiscover() {
    const unreadMoments=(state.momentNotifications||[]).some(n=>{const p=roleById(n.actorId)?.permissions||{};return !n.read&&!p.blocked&&!p.onlyChat&&!p.hideTheirMoments;});
    const momentsCell=unreadMoments?cell('朋友圈','moments','moments').replace('</span><span class="cell-main">','<span class="discover-dot" aria-hidden="true"></span></span><span class="cell-main">'):cell('朋友圈','moments','moments');
    return header('发现')+`<div class="content discover"><section class="section">${momentsCell}</section><section class="section">${cell('小农场','farm','farm')}${cell('功能','settings','engine-functions','','#1485e5')}</section><section class="section">${cell('扫一扫','scan','coming-scan','','#1485e5')}${cell('听一听','music','coming-listen','','#fa5151')}</section><section class="section">${cell('看一看','book','coming-news','','#f3ac32')}${cell('搜一搜','search','coming-search','','#fa5151')}</section><section class="section">${cell('附近','nearby','coming-nearby','','#1485e5')}</section><section class="section">${cell('购物','shopping','coming-shopping','','#fa5151')}${cell('游戏','games','coming-games')}</section><section class="section">${cell('小程序','miniProgram','coming-mini','','#7d7eea')}</section></div>${tabbar('discover')}`;
  }
  function renderSkins() {
    const current = document.documentElement.dataset.skin;
    const { installed, appearance, glassChoices, glassChoice } = window.PipiSkins;
    function card({id, name, wallpaper}, locked = false) {
      return `${locked ? '<article class="skin-option skin-option-locked">' : `<label class="skin-option">
        <input type="radio" name="appearance-skin" value="${esc(id)}" aria-label="${esc(name)}" ${wallpaper ? `aria-describedby="skin-wallpaper-${esc(id)}"` : ''} ${id === current ? 'checked' : ''}>`}
        <span class="skin-sample" data-preview-skin="${esc(id)}" aria-hidden="true">
          <span class="skin-sample-row"><span class="skin-sample-avatar">${icons.me}</span><span class="skin-sample-bubble">早上好！</span></span>
          <span class="skin-sample-row outgoing"><span class="skin-sample-avatar">${icons.me}</span><span class="skin-sample-bubble">早呀</span></span>
        </span>
        <span class="skin-option-caption"><span class="skin-option-title"><span class="skin-option-name">${esc(name)}</span>${wallpaper ? `<span id="skin-wallpaper-${esc(id)}" class="skin-option-wallpaper">内测股东专属美化，不售卖</span>` : ''}</span>
          ${locked ? '<button type="button" class="skin-option-activate" data-action="activate-waterdrop" aria-label="激活水滴皮肤"><span>激活</span></button>' : `<span class="skin-option-state" aria-hidden="true">${icons.check}使用中</span>${id === 'waterdrop' ? '<span class="skin-option-unlocked">已激活</span>' : ''}`}
        </span>${locked ? '</article>' : '</label>'}`;
    }
    const options = installed.filter(skin => skin.id !== 'waterdrop' || appearance?.waterdropActivated);
    const locked = appearance?.waterdropActivated ? '' : card(installed.find(skin => skin.id === 'waterdrop'), true);
    return header('皮肤', {back:true}) + `<div class="content skin-picker"><div class="skin-picker-options" role="radiogroup" aria-label="选择皮肤">${options.map(skin => card(skin)).join('')}</div>${locked}<section class="section">${plainCell('玻璃效果','glass-mode',glassChoices.find(choice => choice.value === glassChoice).label)}</section></div>`;
  }
  function refreshSkinActivation() {
    const opened = route;
    const previous = window.PipiSkins.appearance;
    if (previous?.waterdropActivated) return;
    api('/api/appearance').then(appearance => {
      if (route !== opened || window.PipiSkins.appearance !== previous) return;
      if (window.PipiSkins.configure(appearance)) scheduleRender();
    }).catch(error => {
      if (!error.stale && state && route === opened) toast(error.message, true);
    });
  }
  function selectSkin(id) {
    try {
      window.PipiSkins.select(id);
      return true;
    } catch (error) {
      if (error.name !== 'SecurityError' && error.name !== 'QuotaExceededError') throw error;
      toast('浏览器未能保存皮肤选择', true);
      return false;
    }
  }
  async function activateWaterdrop(trigger) {
    const opened = route;
    let appearance = window.PipiSkins.appearance;
    if (!appearance?.installationId) {
      appearance = await api('/api/appearance');
      if (route !== opened || modalOpen) return;
      window.PipiSkins.configure(appearance);
      if (appearance.waterdropActivated) { refresh(); return; }
    }
    const { installationId } = appearance;
    if (!installationId) throw new Error('暂时无法获取安装编号，请重试');
    trigger.focus({preventScroll:true});
    openModal('激活水滴皮肤', `<div class="skin-installation-label field-label">安装编号</div>
      <div class="skin-installation-row"><span class="skin-installation-id">${esc(installationId)}</span><button type="button" class="skin-copy-btn" data-copy-installation aria-label="复制安装编号">复制</button></div>
      <p class="skin-activation-note">发给皮肤提供者获取激活码。一枚码仅能激活一套小手机。</p>
      ${field('激活码', 'code', '', '粘贴激活码')}`, async form => {
      const code = form.elements.code.value.trim();
      if (!code) throw new Error('请输入激活码');
      const appearance = await api('/api/appearance/waterdrop', {code});
      if (!form.isConnected) return;
      window.PipiSkins.configure(appearance);
      closeModal(false);
      const saved = selectSkin('waterdrop');
      refresh();
      if (saved) toast('水滴皮肤已激活');
    }, '激活', undefined, 'cancel', {lockWhileSaving:true});
    const sheet = overlay.querySelector(':scope > .page-editor');
    sheet.classList.add('model-sheet', 'skin-activation-sheet');
    sheet.querySelector('[data-copy-installation]').onclick = () => copyText(installationId);
    const codeInput = sheet.querySelector('[name="code"]');
    codeInput.autocapitalize = 'off';
    codeInput.spellcheck = false;
    codeInput.maxLength = 256;
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
      statusSaving=true;form.inert=true;const submitted=statusDraft,editing=route,button=view.querySelector('.status-save');button.disabled=true;
      try{
        await act('status.save',submitted);
        // A state update can redraw this editor while the save request is in flight.
        if(route===editing&&statusDraft===submitted){statusDraft=null;leaveStatusFlow();}
        toast('状态已设置');
      }
      catch(err){if(route===editing)view.querySelector('.status-error').textContent=err.message;else toast(err.message);}
      finally{statusSaving=false;button.disabled=false;form.inert=false;const activeForm=view.querySelector('#status-form');if(activeForm){activeForm.inert=false;activeForm.querySelector('.status-save').disabled=false;}view.querySelector('.status-editor-header .status-dismiss')?.removeAttribute('disabled');}
    };
  }
  function renderSettings() {
    const group=(title,rows)=>`<p class="section-title settings-group-title">${title}</p><section class="section">${rows}</section>`;
    return header('设置',{back:true})+`<div class="content page-content settings-content">${group('账号',plainCell('个人资料','edit-profile')+(accountSecurity?plainCell('账号与安全','account-security'):''))}${group('小手机',plainCell('小手机','engine-home',state.settings?.ai?.assign?.chat?'已选择模型':'未选择模型')+plainCell('用量与日志','engine-usage'))}${group('通用',(window.PipiAndroidPage?plainCell('App 连接设置','android-settings'):'')+plainCell('朋友权限','friend-permissions')+plainCell('聊天记录管理','backup')+(storageMaintenance?plainCell('存储空间','storage'):''))}${group('关于',plainCell('关于屁屁机','about'))}<section class="section"><button class="cell centered-cell" data-action="logout">退出登录</button></section></div>`;
  }
  routes.set('storage',()=>header('存储空间',{back:true})+window.PipiStorage.render());
  routes.set('account-security',()=>header('账号与安全',{back:true})+window.PipiAccount.render());
  routes.set('friend-permissions',()=>header('朋友权限',{back:true})+`<div class="content page-content"><section class="section">${plainCell('通讯录黑名单','blacklist')}</section></div>`);
  routes.set('friend-profile',()=>{const r=roleById(route.arg);if(!r)return header('朋友资料',{back:true})+'<div class="empty">联系人不存在</div>';return header('朋友资料',{back:true})+`<div class="content page-content"><section class="section">${plainCell('备注',"contact-remark",r.remark||'')}${plainCell('标签','contact-remark',(r.tags||[]).join('、'))}${plainCell('电话','contact-remark',r.phone||'')}${plainCell('描述','contact-remark',r.description||'')}</section><p class="section-title">朋友权限</p><section class="section">${plainCell('朋友权限','contact-permissions',r.permissions?.onlyChat?'仅聊天':'聊天、朋友圈、微信运动等')}</section></div>`;});
  function renderContactMore(){const r=roleById(route.arg)||{};return header('更多信息',{back:true})+`<div class="content page-content"><section class="section contact-more-info">${[['地区',r.region],['个性签名',r.bio],['来源','由你添加']].map(([label,value])=>`<div class="info-line"><span>${label}</span><p>${esc(value||'未填写')}</p></div>`).join('')}</section></div>`;}
  function renderStickers(){return header('表情库',{back:true})+window.PipiStickers.render(state.stickers||[]);}
  function renderContactTags(){const tag=route.name==='tag-contacts'?String(route.arg||''):null,tags=[...new Set((state.roles||[]).flatMap(r=>r.tags||[]))];return header(tag||'标签',{back:true})+`<div class="content page-content"><section class="section">${tag?(state.roles||[]).filter(r=>(r.tags||[]).includes(tag)).map(r=>`<button class="cell" data-nav="role" data-arg="${esc(r.id)}">${avatar(r,40)}<span class="cell-body cell-title">${esc(roleName(r))}</span></button>`).join(''):tags.map(t=>`<button class="cell plain-cell" data-nav="tag-contacts" data-arg="${esc(t)}"><span class="cell-body cell-title">${esc(t)}</span><span class="cell-value">${(state.roles||[]).filter(r=>(r.tags||[]).includes(t)).length}</span>${icons.chevron}</button>`).join('')}</section>${!tag&&!tags.length?'<div class="empty"><p>暂无标签</p><p>在朋友资料的「设置备注和标签」中添加。</p></div>':''}</div>`;}
  function editContactRemark(r){
    const html=field('备注名','remark',r.remark||'',r.name||'')+field('标签','tags',(r.tags||[]).join('，'),'多个标签用逗号分隔')+field('电话号码','phone',r.phone||'','添加电话号码','tel')+field('描述','description',r.description||'','添加描述','textarea');
    openModal('设置备注和标签',html,async form=>{
      const changes=changedFields(original,formValues(form));
      if('tags' in changes){
        changes.tags=changes.tags.split(/[,，、\n]/).map(t=>t.trim()).filter(Boolean);
        if(changes.tags.length>10||changes.tags.some(t=>t.length>30))throw new Error('最多设置10个标签，每个不超过30个字');
      }
      if(Object.keys(changes).length)await act('role.save',{id:r.id,...changes});
      if(form.isConnected){closeModal(false);refresh();}
    },'完成',undefined,'cancel',{lockWhileSaving:true});
    const original=formValues(overlay.querySelector('.modal-form'));
    overlay.querySelector('.modal-sheet')?.classList.add('contact-remark-editor');
    overlay.classList.add('has-contact-remark');
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
    return header('查找聊天内容',{back:true})+`<div class="search-bar"><label class="search-input-wrap">${icons.search}<input id="chat-search" type="search" value="${esc(chatSearch)}" placeholder="搜索" aria-label="搜索聊天内容">${chatSearch?'<button type="button" class="search-clear" data-action="clear-chat-search" aria-label="清除搜索">×</button>':''}</label></div><div class="content"><section class="chat-search-filters" aria-label="筛选聊天记录"><p class="chat-search-caption">搜索指定内容</p><div class="chat-search-grid"><button type="button" data-chat-search-date>日期</button>${[['image','图片及视频'],['file','文件'],['link','链接'],['voice','音乐与音频'],['payment','交易'],['mini','小程序'],['forward','聊天记录']].map(([key,label])=>`<button type="button" ${['file','mini'].includes(key)?'data-action="coming-search-'+key+'"':'data-chat-search-filter="'+key+'"'} aria-pressed="${chatSearchFilter===key}">${label}</button>`).join('')}</div><input type="date" id="chat-search-date" class="chat-search-date" aria-label="按日期筛选聊天记录" value="${esc(chatSearchDate)}">${searching&&(chatSearchDate||chatSearchFilter!=='all')?`<button type="button" class="chat-search-reset" data-chat-search-reset>${esc([chatSearchDate,chatSearchFilter!=='all'?'已筛选':''].filter(Boolean).join(' · '))}　清除</button>`:''}</section><div data-history-results></div></div>`;
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
  let savingProfileAvatar=false;
  function previewProfileAvatar(){
    openPage('个人头像',`<div class="profile-avatar-preview">${safeImage(state.profile?.avatar)?`<img src="${esc(state.profile.avatar)}" alt="我的头像">`:avatar(state.profile,100)}</div><button type="button" class="secondary-btn block-btn" data-avatar-choose>选择头像</button><button type="button" class="secondary-btn block-btn" data-avatar-remove ${safeImage(state.profile?.avatar)?'':'disabled'}>移除头像</button><input type="file" accept="${profileImageAccept}" data-avatar-file hidden>`,null);
    const form=overlay.querySelector('form'),file=form.querySelector('[data-avatar-file]'),choose=form.querySelector('[data-avatar-choose]');
    let selection=0;
    choose.onclick=()=>{if(savingProfileAvatar){toast('正在保存头像，请稍候');return;}file.click();};
    file.onchange=async()=>{
      const chosen=file.files[0];file.value='';
      if(!chosen||savingProfileAvatar)return;
      const current=++selection;
      const isCurrent=()=>form.isConnected&&!form.closest('[inert]')&&selection===current;
      try{
        const cropped=window.PipiLifeCrop
          ?await window.PipiLifeCrop.pick(chosen,'avatar',{isCurrent,parent:form.closest('.page-editor')||form})
          :await readProfileImage(chosen);
        if(!cropped||!isCurrent())return;
        savingProfileAvatar=true;choose.disabled=true;
        const avatar=await uploadImageData(cropped);
        if(!isCurrent())return;
        await act('profile.save',{avatar});
        await afterOverlayBack();
        if(isCurrent()){closeModal();refresh();}
      }catch(err){if(form.isConnected)toast('头像：'+err.message);}
      finally{savingProfileAvatar=false;if(choose.isConnected)choose.disabled=false;}
    };
    form.querySelector('[data-avatar-remove]').onclick=()=>confirmDialog('移除头像？','移除后显示默认头像。',async isCurrent=>{await act('profile.save',{avatar:''});if(isCurrent()){closeModal(false);await afterOverlayBack();refresh();}},'移除');
  }
  function editProfileField(key){const labels={name:'名字',wechatId:'微信号',region:'地区',bio:'个性签名',patText:'拍一拍'},p=state.profile||{};openModal(labels[key],field(labels[key],key,p[key]||'','',key==='bio'?'textarea':'text',key==='patText'?'填写“拍了拍自己的”后面的内容。留空可恢复默认。':''),async form=>{const raw=formValues(form)[key],value=key==='wechatId'&&raw===p[key]?raw:raw.trim();if(key==='name'&&!value)throw new Error('名字不能为空');if(key==='wechatId')checkWechatId(value,p.wechatId);await act('profile.save',{[key]:value});if(form.isConnected){closeModal();refresh();}});if(key==='patText')overlay.querySelector('[name=patText]').maxLength=100;}
  function renderAbout() {
    const sourceRow=sourceUrl?`<a class="cell plain-cell" href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer"><span class="cell-body"><span class="cell-title">源代码</span></span><span class="cell-value">查看</span>${icons.chevron}</a>`:`<div class="cell plain-cell"><span class="cell-body"><span class="cell-title">源代码</span></span><span class="cell-value">随安装包提供</span></div>`;
    return header('关于屁屁机',{back:true})+`<div class="content page-content about-page">
      <div class="about-logo">
        <div class="auth-logo">${icons.chat}</div>
        <h3>屁屁机</h3>
        <p>v${esc(globalThis.__pipiVersion||'0.13.13')}</p>
      </div>
      <div class="about-intro">
        <p>一个独立账号，一部专属的小手机。</p>
        <p>聊天、日常与共同记忆，都留在你的服务器。</p>
        <p>数据完全独立属于自己。</p>
      </div>
      ${globalThis.__pipiUpdatesEnabled?(globalThis.PipiUpdates?.markup()||''):''}
      <section class="section">
        <div class="about-copy">
          <h3>使用说明</h3>
          <p>首次安装时，通讯录和聊天记录都是空的。</p>
          <p>配置模型服务后，好友就能回复你。模型调用由你选择的服务商提供，费用按其规则计算。</p>
          <p>钱包和红包仅用于虚拟互动，不涉及真实资金。</p>
          <p>群聊、扫码和音视频通话目前仅作展示。</p>
        </div>
      </section>
      <section class="section">
        <div class="about-copy">
          <h3>开源与许可</h3>
          <p>屁屁机是开源、非售卖项目，整体采用 <span class="about-license">AGPL-3.0-only</span> 许可证发布。</p>
          <dl class="about-credits">
            <div><dt>WeUI <span class="about-license">MIT</span></dt><dd>提供列表、弹窗等界面控件。</dd></div>
            <div><dt>LiangNiang/fake-world <span class="about-license">GPL-3.0-only</span></dt><dd>部分界面布局与图标来自这个项目。</dd></div>
            <div><dt>alexiscn/WeChatSwift <span class="about-license">MIT（代码）</span></dt><dd>菜单尺寸、聊天信息分组和面板分页参考了这个项目。其截图、头像和字体未用于屁屁机。</dd></div>
          </dl>
        </div>
        ${sourceRow}
      </section>
    </div>`;
  }
  function renderBackup() {
    return header('备份与恢复',{back:true})+`<div class="content page-content"><section class="section">${cell('导出完整备份','backupExport','download-backup','','#5382b3','包括聊天、角色、记忆、图片和日常记录')}${cell('从备份恢复','backupRestore','restore-backup','','#5382b3','恢复前会再次提示确认')}</section><p class="page-note">导出时可包含模型 API Key。恢复会覆盖当前业务资料，并保留当前登录密码。密钥只用于与备份匹配的服务商地址。</p></div>`;
  }
  function renderChat(rowsOnly=false) {
    const r=roleById(route.arg); if(!r) return header('聊天',{back:true})+'<div class="empty">联系人不存在，请返回通讯录。</div>';
    const paging=globalThis.window?.PipiStateSync?.client?.paging,info=paging?.info(r.id);
    const history=info?.endId?paging.rows(r.id):paging&&!info.loaded?[]:(state.messages||[]).filter(m=>m.roleId===r.id);
    if(forceBottomRole===r.id)chatHistoryWindows.delete(r.id);
    const historyWindow=chatHistoryWindows.get(r.id);
    let limit=historyWindow?.limit||chatHistoryPageSize;
    let end=historyWindow?.endId?history.findIndex(message=>message.id===historyWindow.endId)+1:history.length;
    if(!end&&history.length){end=history.length;chatHistoryWindows.delete(r.id);}
    if(focusMessageId){
      const target=history.findIndex(message=>message.id===focusMessageId);
      if(target>=0&&(target<end-limit||target>=end)){
        // Keep a small window around a search or quote target, even in old conversations.
        limit=chatHistoryPageSize;
        end=Math.min(history.length,target+Math.floor(limit/2)+1);
        chatHistoryWindows.set(r.id,{limit,endId:end<history.length?history[end-1].id:''});
      }
    }
    const start=Math.max(0,end-limit),messages=history.slice(start,end);
    const task=paging&&chatPageTask?.roleId===r.id?chatPageTask:null;
    const older=start>0||info?.hasMore?'<button type="button" data-chat-older class="chat-history-more">查看更早消息</button>':'';
    const latest=end<history.length||info?.endId?'<button type="button" data-chat-latest class="chat-history-more">回到最新消息</button>':'';
    const prioritizeLatest=!latest&&!focusMessageId&&(!chatScrolls.has(r.id)||forceBottomRole===r.id);
    let previousDate='',previousTimestamp=0;
    const entries=[];
    const add=(key,html)=>{if(html)entries.push([key,html.replace(/^<([a-z]+)/,(_tag,tag)=>'<'+tag+' data-chat-key="'+esc(key)+'"')]);};
    if(task||paging&&!info.loaded){
      const label=task?.error?'读取失败，点击重试':task?.kind==='around'?'正在定位原消息…':'正在读取聊天记录…';
      add('page-status','<button type="button" class="chat-history-more" '+(task?.error?'data-chat-page-retry':'disabled aria-busy="true"')+'>'+label+'</button>');
    }else add('older',older);
    if(history.some(m=>m.status==='demo'))add('demo','<div class="system-message demo-notice">这里保留了用于介绍界面的示例对话，非模型生成。</div>');
    function messageRow(m,index){
      const prioritize=prioritizeLatest&&index>=messages.length-4;
      const date=new Date(m.createdAt), day=Number.isFinite(date.getTime())?`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`:'';
      const timeLabel=day!==previousDate||date.getTime()-previousTimestamp>=300000 ? `<div class="message-date">${esc(shortTime(m.createdAt,true))}</div>`:''; previousDate=day;previousTimestamp=date.getTime();
      add('date:'+m.id,timeLabel);
      if(m.meta?.kind==='payment-receipt') return renderPaymentReceipt(m,r);
      if(m.sender==='system') return `<div class="system-message" data-message="${esc(m.id)}" ${m.meta?.kind==='pat'&&m.meta.author==='me'?'role="button" tabindex="0" data-bubble="'+esc(m.id)+'"':''}>${esc(m.content)}${m.meta?.kind==='recalled'&&m.meta.recalledText?` <button class="recall-edit" data-reedit="${esc(m.id)}">重新编辑</button>`:''}</div>`;
      const mine=m.sender==='user', entity=mine?state.profile:r;
      const voiceSeconds=Math.max(1,Math.round((Number(m.meta?.durationMs)||1000)/1000));
      const voiceWidth=Math.min(190,Math.max(m.meta?.expired?.kind==='voice'?132:67,67+voiceSeconds*2.2));
      let bubble=richText(m.content), imageClass='', transferClass='', paymentLabel='';
      if(m.type==='image'){
        const sticker=Boolean(m.meta?.stickerId);
        imageClass=sticker?'image-bubble sticker-bubble':'image-bubble';
        if(m.meta?.expired?.kind==='image')imageClass+=' expired-media-bubble';
        bubble=m.meta?.expired?.kind==='image'?renderExpiredImage(m.meta.thumb):safeImage(m.content)?chatImageMarkup(m,m.content,sticker?'聊天表情':'聊天图片',sticker,prioritize):'[无法显示的图片]';
      }
      if(m.type==='voice') bubble=m.meta?.expired?.kind==='voice'?`<span class="voice-message expired-voice"><span>${voiceSeconds}″</span><small>语音已过期</small></span>`:`<span class="voice-message ${mine?'voice-mine':''}">${icons.voiceBubbleWave}<span>${voiceSeconds}″</span></span>`;
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
        </span><span class="payment-footer"><span>${packet ? '微信红包' : '微信<span class="payment-footer-term">液态水晶</span><span class="payment-footer-term">转账</span>'}</span><span class="payment-footer-state">${footerState}</span></span>`;
      }
      const chunks=null;
      const bubbles=chunks&&chunks.length>1?chunks.map(chunk=>`<div class="message-bubble" role="button" tabindex="0" data-bubble="${esc(m.id)}" aria-label="${esc(chunk.slice(0,80))}，长按或右键操作">${richText(chunk)}</div>`).join(''):`<div class="message-bubble ${imageClass} ${transferClass}" role="button" tabindex="0" data-bubble="${esc(m.id)}" aria-label="${m.type==='image'?(m.meta?.stickerId?'表情':'图片'):m.type==='voice'?`语音消息，${voiceSeconds}秒`:m.type==='forward'?'聊天记录':paymentLabel?esc(paymentLabel):esc(String(m.content).slice(0,80))}，长按或右键操作">${bubble}</div>`;
      const attachedImage=m.type==='text'&&m.meta?.expired?.kind==='image'?`<div class="message-bubble image-bubble expired-media-bubble" role="button" tabindex="0" data-bubble="${esc(m.id)}">${renderExpiredImage(m.meta.thumb)}</div>`:m.type==='text'&&safeImage(m.meta?.image)?`<div class="message-bubble image-bubble" role="button" tabindex="0" data-bubble="${esc(m.id)}">${chatImageMarkup(m,m.meta.image,'附带的聊天图片',false,prioritize)}</div>`:'';
      return `<div class="message-row ${mine?'mine':''} ${m.meta?.expired?'message-expired':''} ${chatSelection?.ids.has(m.id)?'message-selected':''}" data-message="${esc(m.id)}">${chatSelection?`<button class="message-select" data-select-message="${esc(m.id)}" aria-label="选择消息" aria-pressed="${chatSelection.ids.has(m.id)}">${chatSelection.ids.has(m.id)?'✓':''}</button>`:''}<button class="message-avatar" data-chat-avatar="${mine?'self':'contact'}" aria-label="${mine?'我的头像':'朋友头像'}：单击查看资料，双击拍一拍">${avatar(entity,43)}</button><div class="message-body ${m.type==='voice'?'voice-body':''}" ${m.type==='voice'?`style="--voice-width:${voiceWidth}px"`:''}>${bubbles}${attachedImage}${m.type==='text'&&m.meta?.expired?.kind==='voice'?'<p class="expired-voice-note">语音已过期</p>':''}${m.type==='text'&&m.sender==='assistant'&&m.status!=='demo'&&!chatSelection&&!m.meta?.expired?speechIndicator(m.id):''}${m.meta?.quote?renderMessageQuote(m.meta.quote,r):''}${m.type==='voice'?renderVoiceTranscript(m):''}${chatSelection?`<button class="message-range" data-select-range="${esc(m.id)}">选择到这里</button>`:''}${m.status==='error'?`<button class="message-failure" data-retry="${esc(m.id)}" ${retryingMessages.has(m.id)?'disabled aria-label="正在重新发送"':'aria-label="发送失败，点击重试"'}>${retryingMessages.has(m.id)?'…':'!'}</button>`:''}</div></div>`;
    }
    messages.forEach((m,index)=>add(m.id,messageRow(m,index)));
    if(paging&&end<history.length)add('newer','<button type="button" data-chat-newer class="chat-history-more">查看后续消息</button>');
    add('latest',latest);
    for(const pending of pendingSends.values())if(pending.roleId===r.id&&!pending.observed)add('pending:'+pending.requestId,renderPendingSend(pending));
    if(rowsOnly)return entries;
    renderChat.entries=new Map(entries);
    return header(chatSelection?`已选 ${chatSelection.ids.size} 条`:window.PipiEngine?.isTyping(r.id)?'对方正在输入…':roleName(r),{back:true,right:chatSelection?'':iconButton('more','chat-details','聊天信息')})+`<div class="chat-messages ${chatSelection?'chat-selecting':''}" id="chat-messages" ${safeImage(r.chatBackground)?`style="background-image:url('${esc(r.chatBackground)}')"`:''}>${entries.map(entry=>entry[1]).join('')}</div>${chatSelection?'':'<div class="chat-notice-slot"><button type="button" class="chat-new-messages" hidden></button></div>'}${chatSelection?renderMessageSelection():renderComposer()}`;
  }
  function patchChatRows(list){
    const entries=renderChat(true),previous=renderChat.entries||new Map();
    const nodes=new Map([...list.children].map(row=>[row.dataset.chatKey||'pending:'+row.dataset.pendingId,row]));
    const reading=chatHistoryWindows.get(route.arg)?.endId||list.dataset.pinned==='false';
    const anchor=reading&&[...list.querySelectorAll('[data-message]')].find(node=>node.getBoundingClientRect().bottom>list.getBoundingClientRect().top);
    const top=anchor&&anchor.getBoundingClientRect().top;
    let cursor=list.firstElementChild,changed=false;
    for(const [key,html] of entries){
      let node=nodes.get(key);nodes.delete(key);
      if(!node||previous.get(key)!==html){
        const template=document.createElement('template');template.innerHTML=html;
        const fresh=template.content.firstElementChild;bindChat(template.content);
        if(node){if(cursor===node)cursor=fresh;node.replaceWith(fresh);list.rowObserver?.unobserve(node);}else list.insertBefore(fresh,cursor);
        node=fresh;list.rowObserver?.observe(node);changed=true;
      }
      if(node!==cursor&&node.nextElementSibling!==cursor){list.insertBefore(node,cursor);changed=true;}
      cursor=node.nextElementSibling;
    }
    for(const node of nodes.values()){list.rowObserver?.unobserve(node);node.remove();changed=true;}
    renderChat.entries=new Map(entries);
    const role=roleById(route.arg),wallpaper=safeImage(role.chatBackground)?role.chatBackground:'';
    if(list.pipiWallpaper!==wallpaper){list.pipiWallpaper=wallpaper;list.style.backgroundImage=wallpaper?'url("'+wallpaper+'")':'';changed=true;}
    const title=view.querySelector('[data-chat-title]'),label=window.PipiEngine?.isTyping(route.arg)?'对方正在输入':roleName(role);
    if(title&&title.textContent!==label)title.textContent=label;
    const backCount=view.querySelector('.back-btn span:last-child'),unread=visibleUnreadCount(route.arg);
    if(backCount){const count=unread>99?'99+':unread?String(unread):'';if(backCount.textContent!==count)backCount.textContent=count;backCount.classList.toggle('chat-back-count',Boolean(unread));}
    if(changed){window.WaterdropChat?.decorate(view);window.PipiMotion?.decorateView(view,route);if(speechSession)paintSpeech(speechSession.id);}
    if(forceBottomRole===route.arg){list.dataset.pinned='true';forceBottomRole='';}
    if(!reading||list.dataset.pinned==='true')list.scrollTop=list.scrollHeight;
    else if(changed&&anchor){const next=list.querySelector('[data-message="'+CSS.escape(anchor.dataset.message)+'"]');if(next)list.scrollTop+=next.getBoundingClientRect().top-top;}
    const notice=view.querySelector('.chat-new-messages');if(notice&&notice.hidden===Boolean(newChatMessageIds.size))paintNewChatNotice();
  }
  function shiftPagedWindow(paging,roleId,firstId){
    const rows=paging.rows(roleId),anchor=rows.findIndex(row=>row.id===firstId);
    if(anchor<0)return;
    const end=Math.min(rows.length,anchor+chatHistoryPageSize/2);
    chatHistoryWindows.set(roleId,{limit:chatHistoryPageSize,endId:end<rows.length?rows[end-1].id:paging.info(roleId).endId||''});
  }
  function focusChatMessage(roleId,messageId){
    if(route.name!=='chat'||route.arg!==roleId)return;
    if(view.querySelector('[data-message="'+CSS.escape(messageId)+'"]'))scrollChat(messageId);
    else{forceBottomRole='';focusMessageId=messageId;refresh();}
  }
  async function loadChatReading(paging,roleId,reading){
    let next=await paging.enter(roleId);
    if(paging.rows(roleId).some(row=>row.id===reading.anchor))return next;
    // A before-page ends at the requested ID. Fetch through the far edge of the saved viewport.
    const previous=reading.messages||[],savedIndex=previous.findIndex(row=>row.id===reading.anchor);
    const endId=reading.afterAnchor||(savedIndex>=0?previous[Math.min(previous.length-1,savedIndex+12)].id:reading.anchor);
    try{next=await paging.around(roleId,endId);}
    catch(error){if(error.code!=='MESSAGE_NOT_FOUND'||endId===reading.anchor)throw error;return paging.around(roleId,reading.anchor);}
    if(!paging.rows(roleId).some(row=>row.id===reading.anchor)&&paging.info(roleId).hasMore)next=await paging.older(roleId);
    return next;
  }
  function requestChatPage(kind,roleId,messageId='',reading=null){
    if(chatPageTask?.roleId===roleId&&chatPageTask.kind===kind&&chatPageTask.messageId===messageId&&!chatPageTask.error)return chatPageTask.promise;
    const paging=window.PipiStateSync.client.paging,task={kind,roleId,messageId,reading,error:false};
    chatPageTask=task;
    if(route.name==='chat'&&view.dataset.chatRole===roleId)refresh();
    task.promise=(async()=>{
      try{
        const next=kind==='restore'?await loadChatReading(paging,roleId,reading):kind==='around'?await paging.around(roleId,messageId):await paging[kind](roleId);
        if(chatPageTask!==task||route.name!=='chat'||route.arg!==roleId)return;
        if((kind==='around'||kind==='restore')&&!paging.rows(roleId).some(row=>row.id===messageId))throw new Error('原消息已删除或不可用');
        chatPageTask=null;setState(next);
        if(kind==='older')shiftPagedWindow(paging,roleId,messageId);
        if(kind==='around'||kind==='restore'){chatHistoryWindows.set(roleId,{limit:chatHistoryPageSize,endId:paging.info(roleId).endId||''});forceBottomRole='';}
        if(kind==='latest'){chatScrolls.delete(roleId);chatHistoryWindows.delete(roleId);newChatMessageIds.clear();forceBottomRole=roleId;}
        refresh();if(kind==='around')focusChatMessage(roleId,messageId);if(kind==='restore')restoreAndroidAnchor(reading);
      }catch(error){
        if(chatPageTask!==task||route.name!=='chat'||route.arg!==roleId)return;
        task.error=true;refresh();toast(error.message);
      }
    })();
    return task.promise;
  }
  function jumpToMessage(roleId,messageId){
    if(!roleById(roleId)||!messageId)return;
    if(route.name!=='chat'||route.arg!==roleId){chatJump={roleId,messageId};showView('chat',roleId);return chatPageTask?.promise;}
    const paging=window.PipiStateSync?.client?.paging;
    if(paging&&(!paging.info(roleId).loaded||!paging.rows(roleId).some(row=>row.id===messageId)))return requestChatPage('around',roleId,messageId);
    focusChatMessage(roleId,messageId);
  }
  function activateChatPages(){
    const client=globalThis.window?.PipiStateSync?.client,paging=client?.paging,roleId=route.name==='chat'?route.arg:null;
    if(chatPageTask&&chatPageTask.roleId!==roleId)chatPageTask=null;
    paging?.setActive(roleId);
    if(!roleId)return;
    if(chatJump?.roleId===roleId){const target=chatJump.messageId;chatJump=null;return jumpToMessage(roleId,target);}
    if(!paging)return;
    if(!paging.info(roleId).loaded)return requestChatPage('enter',roleId);
    return client.refresh(state.revision).then(result=>{if(!result.unchanged)receiveState(result.state);}).catch(error=>{if(route.name==='chat'&&route.arg===roleId&&!error.stale)toast(error.message);});
  }
  function showOlderChatMessages(){
    const roleId=route.arg,list=view.querySelector('#chat-messages'),previous=list.querySelector('[data-message]');
    const paging=globalThis.window?.PipiStateSync?.client?.paging;
    if(paging){
      if(!previous||chatPageTask&&!chatPageTask.error)return;
      const firstId=previous.dataset.message,rows=paging.rows(roleId),index=rows.findIndex(row=>row.id===firstId);
      if(index<1&&paging.info(roleId).hasMore){requestChatPage('older',roleId,firstId);return;}
      shiftPagedWindow(paging,roleId,firstId);refresh();return;
    }
    const id=previous.dataset.message,top=previous.getBoundingClientRect().top-list.getBoundingClientRect().top;
    const historyWindow=chatHistoryWindows.get(roleId);
    chatHistoryWindows.set(roleId,{limit:(historyWindow?.limit||chatHistoryPageSize)+chatHistoryPageSize,endId:historyWindow?.endId});
    refresh();
    const nextList=view.querySelector('#chat-messages'),anchor=nextList.querySelector(`[data-message="${CSS.escape(id)}"]`);
    requestAnimationFrame(()=>{
      if(!nextList.isConnected||!anchor)return;
      nextList.scrollTop+=anchor.getBoundingClientRect().top-nextList.getBoundingClientRect().top-top;
      chatScrolls.set(roleId,nextList.scrollTop);
    });
  }
  function showLatestChatMessages(){
    const roleId=route.arg;
    const paging=globalThis.window?.PipiStateSync?.client?.paging;
    if(paging?.info(roleId).endId){requestChatPage('latest',roleId);return;}
    chatHistoryWindows.delete(roleId);
    chatScrolls.delete(roleId);
    newChatMessageIds.clear();
    forceBottomRole=roleId;
    refresh();
  }
  function renderPaymentReceipt(message,role){
    const {transactionId,paymentType,amountCents}=message.meta;
    const packet=paymentType==='redpacket', title=packet?'已领取红包':'已收款';
    const transaction=state.wallet.transactions.find(item=>item.id===transactionId&&item.roleId===role.id);
    const interactive=transaction&&!chatSelection;
    const tag=interactive?'button':'div';
    const attributes=interactive?` type="button" data-receipt-payment="${esc(transactionId)}"`:'';
    return `<div class="payment-receipt-row" data-message="${esc(message.id)}"><${tag} class="payment-receipt"${attributes}><span class="payment-receipt-icon" aria-hidden="true">${icons.check}</span><span class="payment-receipt-copy"><strong>${title}</strong><span>来自 ${esc(roleName(role))}</span></span><strong class="payment-receipt-amount">¥${(amountCents/100).toFixed(2)}</strong></${tag}></div>`;
  }
  function speechIndicator(id){
    return `<button type="button" class="message-speech" data-message-speech="${esc(id)}" hidden>${icons.voiceWave}<span class="speech-spinner" aria-hidden="true"></span></button>`;
  }
  function renderExpiredImage(thumb,quote=false){
    const image=safeImage(thumb);return `<span class="expired-media-image${quote?' quote-expired-preview':''}${image?'':' is-placeholder'}">${image?`<img class="message-image expired-media-thumb" src="${esc(thumb)}" alt="已过期图片的模糊缩略图">`:''}${quote?'':'<span class="expired-media-label">图片已过期</span>'}</span>`;
  }
  function renderMessageQuote(quote,r){
    const original=quote.messageId&&(state.messages||[]).find(m=>m.id===quote.messageId),available=quote.messageId&&!quote.unavailable&&(original?original.meta?.kind!=='recalled':globalThis.window?.PipiStateSync?.client?.paging),expired=quote.expired||original?.meta?.expired;
    const thumbnail=quote.stickerId||original?.meta?.stickerId?'':safeImage(quote.thumb)?quote.thumb:original?.meta?.thumb;
    const name=quote.senderName||(quote.sender==='user'?state.profile?.name:roleName(r)),image=expired?'':safeImage(thumbnail)?thumbnail:safeImage(quote.image)?quote.image:quote.type==='image'&&safeImage(quote.content)?quote.content:'';
    const label=expired?.kind==='voice'?'[语音已过期]':'[图片已过期]';
    const text=expired?(quote.type==='text'&&quote.content?quote.content+' '+label:label):({image:image?'':'[图片]',voice:'[语音]',forward:'[聊天记录]',transfer:'[转账]',redpacket:'[红包]'})[quote.type]??quote.content;
    const unavailable=quote.unavailable==='recalled'?'原消息已撤回':quote.unavailable==='deleted'?'原消息已删除':'';
    return `<button type="button" class="message-quote ${expired?'quote-expired':''} ${image||expired?.kind==='image'?'quote-with-image':''} ${unavailable?'quote-unavailable':''}" data-quote-message="${available?esc(quote.messageId):''}" ${available?'':'disabled'} aria-label="${available?'定位被引用的消息':unavailable||(!quote.messageId?'引用快照':'原消息不可用')}"><span class="quote-copy">${esc(name)}：${richText(text)}</span>${expired?.kind==='image'?renderExpiredImage(quote.thumb||original?.meta?.thumb,true):image?`<img src="${esc(image)}" alt="引用的图片" class="quote-image">`:''}${unavailable?`<small class="quote-unavailable-note">${unavailable}</small>`:''}</button>`;
  }
  function renderVoiceTranscript(message){
    const ui=transcriptViews.get(message.id),transcript=message.meta?.transcript;
    if(!ui?.expanded)return '';
    let body;
    if(transcript){
      const demo=message.meta.transcriptSource==='demo'||ui.demo;
      body=`<span class="transcript-text">${esc(transcript)}</span>${demo?'<small class="transcript-demo">演示预设文字，非真实识别结果</small>':''}`;
    }else if(message.meta?.expired){
      body='<span class="transcript-error" role="alert">语音已过期，无法转文字。</span>';
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
  let queuedEmojiRecents=[],emojiRecentTimer=0,emojiRecentsSaving=false;
  function recordEmojiUse(token){
    queuedEmojiRecents=[token,...queuedEmojiRecents.filter(value=>value!==token)].slice(0,24);
    clearTimeout(emojiRecentTimer);
    emojiRecentTimer=setTimeout(saveEmojiRecents,250);
  }
  async function saveEmojiRecents(){
    if(emojiRecentsSaving||!state||!queuedEmojiRecents.length)return;
    const epoch=authEpoch,tokens=queuedEmojiRecents;
    queuedEmojiRecents=[];
    emojiRecentsSaving=true;
    try{await act('emoji.use',{tokens});}
    catch(error){if(authEpoch===epoch)console.debug('Recent emoji sync unavailable',error.message);}
    finally{
      if(authEpoch===epoch){emojiRecentsSaving=false;if(queuedEmojiRecents.length)void saveEmojiRecents();}
    }
  }
  function renderEmojiBoard(){
    const entries=emojiEntries(),term=emojiSearch.trim().toLowerCase(),matches=entries.filter(e=>!term||(e.label+' '+e.token).toLowerCase().includes(term));
    const emojiButtons=items=>items.map(e=>'<button type="button" data-emoji="'+esc(e.token)+'" aria-label="'+esc(e.label||e.token)+'">'+emojiSprite(e)+'</button>').join('');
    const recent=[...new Set([...queuedEmojiRecents,...(state.emojiRecents||[])])].map(token=>entries.find(e=>e.token===token)).filter(Boolean).slice(0,7);
    const tabs=[['search','search','搜索表情'],['all','smile','所有表情'],['favorites','heart','收藏表情'],['selfie','','自拍表情']];
    const toolbar='<div class="emoji-toolbar" role="tablist" aria-label="表情分类">'+tabs.map(([tab,icon,label])=>'<button type="button" role="tab" aria-selected="'+(emojiTab===tab)+'" class="'+(emojiTab===tab?'active':'')+'" data-emoji-tab="'+tab+'" aria-label="'+label+'">'+(tab==='selfie'?'<img src="/vendor/fake-world/selfie-expression.png" alt="">':icons[icon])+'</button>').join('')+'</div>';
    let content='';
    if(emojiTab==='all')content=(recent.length?'<h3 class="recent-emoji-heading">最近使用</h3><div class="emoji-grid recent-emojis">'+emojiButtons(recent)+'</div>':'')+'<h3>所有表情</h3><div class="emoji-grid">'+emojiButtons(entries)+'</div>';
    if(emojiTab==='search')content='<label class="emoji-search">'+icons.search+'<input id="emoji-search" type="search" value="'+esc(emojiSearch)+'" placeholder="搜索表情" aria-label="搜索表情"></label><h3>'+(term?'搜索结果':'所有表情')+'</h3><div class="emoji-grid">'+emojiButtons(matches)+'</div>'+(!matches.length?'<p class="emoji-empty">没有找到相关表情</p>':'');
    if(emojiTab==='favorites')content='<div class="sticker-heading"><h3>表情库</h3><button type="button" data-action="manage-stickers">整理</button></div><div class="sticker-grid"><button type="button" class="add-sticker" data-action="add-sticker" aria-label="添加收藏表情">'+icons.add+'</button>'+(state.stickers||[]).filter(s=>safeImage(s.image)).map(s=>'<button type="button" data-sticker="'+esc(s.id)+'" aria-label="发送收藏表情"><img src="'+esc(s.image)+'" alt="收藏表情"></button>').join('')+'</div>'+(!(state.stickers||[]).length?'<p class="emoji-empty">添加图片到表情，点按即可发送</p>':'');
    if(emojiTab==='selfie')content='<div class="emoji-unavailable">'+icons.camera+'<p>自拍表情暂未开放</p></div>';
    return toolbar+'<section class="emoji-board"'+(emojiExpandedHeight?' style="height:'+emojiExpandedHeight+'px"':'')+' aria-label="表情面板"><div class="emoji-drag-handle" role="separator" aria-label="调整表情面板高度" aria-orientation="horizontal" tabindex="0"><span></span></div><div class="emoji-scroll">'+content+'</div>'+(['all','search'].includes(emojiTab)?'<div class="emoji-action-backdrop" aria-hidden="true"></div><div class="emoji-floating"><button type="button" data-action="emoji-delete" aria-label="删除上一个表情或文字" '+(!composeText?'disabled':'')+'>'+assetIcon('backspace')+'</button><button type="button" data-action="emoji-send" '+(!canSendComposerDraft()?'disabled':'')+'>发送</button></div>':'')+'</section>';
  }
  function composeTrailingMode(){return 'more';}
  function renderComposeTrailing(){return iconButton('add','toggle-panel','展开更多功能');}
  function captureChatLayout(){const list=view.querySelector('#chat-messages');return route.name==='chat'&&list?.dataset.scrollReady==='true'?{list,roleId:route.arg,top:list.scrollTop,bottom:list.dataset.pinned!=='false'&&chatNearBottom(list)}:null;}
  function restoreChatLayout(snapshot){if(!snapshot||!snapshot.list.isConnected||route.name!=='chat'||route.arg!==snapshot.roleId)return;const list=snapshot.list;if(snapshot.bottom){list.scrollTop=list.scrollHeight;chatScrolls.delete(snapshot.roleId);}else{list.scrollTop=snapshot.top;chatScrolls.set(snapshot.roleId,list.scrollTop);}}
  function resizeComposeInput(input){
    if(!input)return;const anchor=captureChatLayout(),scroll=input.scrollTop;
    input.style.height='40px';
    const height=Math.min(112,input.scrollHeight);
    input.style.height=height+'px';input.scrollTop=scroll;
    input.parentElement.classList.toggle('compose-multiline',height>44);
    const selection=getSelection();
    if(document.activeElement===input&&selection?.rangeCount&&selection.isCollapsed&&input.contains(selection.anchorNode)){
      const caret=selection.getRangeAt(0).getBoundingClientRect(),box=input.getBoundingClientRect();
      if(caret.height){if(caret.bottom>box.bottom-8)input.scrollTop+=caret.bottom-box.bottom+8;else if(caret.top<box.top+8)input.scrollTop-=box.top+8-caret.top;}
    }
    restoreChatLayout(anchor);
  }
  let stopComposerDeleteHold=()=>{};
  function canSendComposerDraft(){return panel!=='voice'&&!recordingSession&&Boolean(composeText.trim()||composeImage);}
  function syncComposerControls(){
    const anchor=captureChatLayout();let changed=false;
    const trailing=view.querySelector('.compose-trailing'),mode=composeTrailingMode();
    const canSend=canSendComposerDraft();
    const remove=view.querySelector('[data-action=emoji-delete]'),emojiSend=view.querySelector('[data-action=emoji-send]');
    const emojiOwnsSend=Boolean(panel==='emoji'&&emojiSend);
    if(trailing){
      if(trailing.dataset.mode!==mode){trailing.innerHTML=renderComposeTrailing();trailing.dataset.mode=mode;bindActionButtons(trailing);changed=true;}
      const send=trailing.querySelector('[type=submit]');
      if(send){send.disabled=!canSend;send.classList.toggle('has-draft',canSend);send.hidden=emojiOwnsSend;}
      trailing.hidden=emojiOwnsSend;
    }
    if(remove)remove.disabled=!composeText||composeComposing;
    if(emojiSend)emojiSend.disabled=!canSend;
    syncDictationState();
    if(changed)resizeComposeInput(view.querySelector('#compose-text'));restoreChatLayout(anchor);
  }
  function syncComposerDraft(){persistChatDrafts();if(route.name==='chat')window.PipiEngine?.activity(route.arg);const input=view.querySelector('#compose-text');if(input&&!composeComposing){paintComposer(input,document.activeElement===input);resizeComposeInput(input);syncComposerControls();}else updateComposer();}
  function quotedMessage(id,roleId=route.arg){const m=id?state?.messages?.find(item=>item.id===id):null;return m&&m.roleId===roleId&&m.meta?.kind!=='recalled'?m:null;}
  function composeImagePreview(){
    if(processingImage&&route.name==='chat'&&processingImage.roleId===route.arg&&processingImage.epoch===authEpoch){
      return '<div class="compose-image-preview" role="status"><img src="'+esc(processingImage.url)+'" alt="选中的图片"><span>图片处理中…</span><button type="button" data-action="clear-image">取消</button></div>';
    }
    return (composeImage?'<div class="compose-image-preview"><img src="'+esc(composeImage)+'" alt="待发送的图片"><span>'+(composeStickerId?'表情已选择':'图片已选择')+'</span><button type="button" data-action="clear-image">移除</button></div>':'');
  }
  function paintImagePreview(){
    const footer=view.querySelector('.chat-composer');if(!footer)return;
    const old=footer.querySelector('.compose-image-preview'),html=composeImagePreview();
    if(old)old.remove();
    if(html){footer.querySelector('.dictation-status').insertAdjacentHTML('beforebegin',html);bindActionButtons(footer);}
  }
  function renderComposer() {
    const quote=quotedMessage(quoteId);
    const tools=[['toolImage','upload-chat-image','照片'],['toolCamera','coming-camera','拍摄'],['toolVideo','coming-video',['视频','通话']],['toolLocation','coming-location','位置'],['toolRedpacket','chat-redpacket','红包'],['mic','dictation',['语音','转文字']],['toolTransfer','chat-transfer','转账'],['toolFavorites','favorites','收藏'],['toolGift','coming-gift','礼物'],['toolContact','coming-contact-card',['个人','名片']],['toolFile','coming-file','文件'],['toolCards','coming-cards','卡券'],['toolMusic','coming-music','音乐']];
    const more=panel==='more'?'<div class="more-pages"><div class="compose-panel">'+tools.slice(morePage*8,morePage*8+8).map(([icon,action,label])=>'<button type="button" data-action="'+action+'"'+(action==='dictation'?' class="compose-dictation" aria-label="语音转文字" aria-pressed="false"':'')+'><span class="panel-icon">'+(action==='dictation'?micMark:icons[icon]||'')+'</span><span>'+(Array.isArray(label)?label.map(word=>'<span class="tool-word">'+word+'</span>').join('<wbr>'):label)+'</span></button>').join('')+'</div></div><div class="panel-dots">'+[0,1].map(i=>'<button type="button" class="'+(morePage===i?'active':'')+'" data-action="more-'+(i?'next':'prev')+'" aria-label="第'+(i+1)+'页" aria-current="'+(morePage===i?'page':'false')+'"></button>').join('')+'</div>':'';
    const textField='<div class="compose-field"><div id="compose-text" class="compose-input" '+(panel==='voice'?'hidden':'')+' contenteditable="true" role="textbox" enterkeyhint="send" aria-multiline="true" aria-disabled="false" inputmode="'+(panel==='emoji'?'none':'text')+'" aria-label="输入消息" spellcheck="false">'+richText(composeText,true)+'</div>'+(panel==='voice'?'<button type="button" class="voice-record" data-record aria-label="按住说话；左上滑取消，右上滑转文字">按住 说话</button>':'')+'</div>';
    return '<footer class="chat-composer '+(panel==='emoji'?'emoji-open':'')+'">'+(quote?'<div class="composer-quote"><span>引用 '+esc(quote.sender==='user'?state.profile?.name:roleName(roleById(route.arg)))+'：'+esc(preview(quote))+'</span><button type="button" data-action="clear-quote" aria-label="取消引用">×</button></div>':'')+composeImagePreview()+'<div class="dictation-status" role="status" aria-live="polite" hidden><span></span><div class="dictation-actions"><button type="button" data-action="finish-dictation">完成</button><button type="button" data-action="cancel-dictation">取消</button></div></div><form id="compose-form" class="compose-row">'+iconButton(panel==='voice'?'keyboard':'voice','toggle-voice',panel==='voice'?'切换到键盘输入':'切换到按住说话')+textField+iconButton(panel==='emoji'?'keyboard':'smile','toggle-emoji',panel==='emoji'?'切换到键盘输入':'选择表情')+'<span class="compose-trailing" data-mode="'+composeTrailingMode()+'">'+renderComposeTrailing()+'</span></form>'+(panel==='emoji'||panel==='more'?'<div class="composer-extras">'+(panel==='emoji'?renderEmojiBoard():more)+'</div>':'')+'<input type="file" id="chat-image-file" accept="image/*" hidden><input type="file" id="sticker-file" multiple accept="image/*" hidden></footer>';
  }
  function composerPointerBusy(){return composerPointers.size>0||composerPointerSettling;}
  function resetComposerPointerState(){for(const timer of composerPointers.values())clearTimeout(timer);composerPointers.clear();composerPointerSettling=false;pointerComposerUpdatePending=false;pointerViewRefreshPending=false;if(composerPointerFrame)cancelAnimationFrame(composerPointerFrame);composerPointerFrame=0;}
  function settleComposerPointer(){
    // Keep the guard through pointerup's ensuing click. A microtask here can
    // detach the pressed node before the browser dispatches that click.
    composerPointerSettling=true;if(composerPointerFrame)return;
    const roleId=route.arg,footer=view.querySelector('.chat-composer');
    composerPointerFrame=requestAnimationFrame(()=>{
      composerPointerFrame=0;if(composerPointers.size)return;composerPointerSettling=false;
      if(route.name!=='chat'||route.arg!==roleId||footer!==view.querySelector('.chat-composer')){pointerComposerUpdatePending=false;pointerViewRefreshPending=false;return;}
      const render=pointerViewRefreshPending,compose=pointerComposerUpdatePending;pointerViewRefreshPending=false;pointerComposerUpdatePending=false;
      if(render)flushRender(true);else if(compose)updateComposer();
    });
  }
  function releaseComposerPointer(event){if(!composerPointers.has(event.pointerId))return;clearTimeout(composerPointers.get(event.pointerId));composerPointers.delete(event.pointerId);if(!composerPointers.size)settleComposerPointer();}
  document.addEventListener('pointerdown',event=>{const footer=view.querySelector('.chat-composer');if(route.name==='chat'&&footer?.contains(event.target)){const id=event.pointerId;clearTimeout(composerPointers.get(id));composerPointers.set(id,setTimeout(()=>releaseComposerPointer({pointerId:id}),5000));}},true);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,releaseComposerPointer,true);
  document.addEventListener('click',event=>{if(!composerPointers.size&&composerPointerSettling&&view.querySelector('.chat-composer')?.contains(event.target))composerPointerSettling=false;},true);
  const releaseAllComposerPointers=()=>{if(!composerPointerBusy())return;for(const timer of composerPointers.values())clearTimeout(timer);composerPointers.clear();settleComposerPointer();};
  window.addEventListener('blur',releaseAllComposerPointers);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){composeComposing=false;releaseAllComposerPointers();}});
  function patchComposer(footer){
    const template=document.createElement('template');template.innerHTML=renderComposer();
    const next=template.content.firstElementChild,form=footer.querySelector('#compose-form');
    footer.classList.toggle('emoji-open',panel==='emoji');
    const input=form.querySelector('#compose-text'),target=next.querySelector('#compose-text');
    if(input.hidden!==target.hidden)input.hidden=target.hidden;
    if(input.inputMode!==target.inputMode)input.inputMode=target.inputMode;
    if(!composeComposing&&readComposerText(input)!==composeText)paintComposer(input,document.activeElement===input);
    for(const selector of ['[data-action=toggle-voice]','[data-action=toggle-emoji]']){
      const old=form.querySelector(selector),fresh=next.querySelector(selector);
      if(old.getAttribute('aria-label')!==fresh.getAttribute('aria-label')){
        old.setAttribute('aria-label',fresh.getAttribute('aria-label'));old.innerHTML=fresh.innerHTML;
      }
    }
    for(const selector of ['.composer-quote','.compose-image-preview','.composer-extras','[data-record]']){
      const old=footer.querySelector(selector),fresh=next.querySelector(selector);
      if(!fresh){if(old)old.remove();continue;}
      const html=fresh.outerHTML;if(old&&(old.pipiMarkup||old.outerHTML)===html)continue;
      fresh.pipiMarkup=html;
      if(old)old.replaceWith(fresh);
      else if(selector==='[data-record]')input.after(fresh);
      else if(selector==='.composer-extras')form.after(fresh);
      else if(selector==='.composer-quote')footer.prepend(fresh);
      else footer.querySelector('.dictation-status').before(fresh);
    }
  }
  function updateComposer() {
    stopComposerDeleteHold();
    persistChatDrafts();
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
    patchComposer(old);bindComposer();bindActionButtons(old);
    const from=composerPanelFrom;composerPanelFrom=null;
    if(from!==null)animateComposerPanel(from,anchor);
    globalThis.window?.PipiMotion?.decorateView(view,route);
    const input=view.querySelector('#compose-text');if(input&&wasInput&&document.activeElement!==input){input.focus({preventScroll:true});setComposerSelection(input,composerSelection.start,composerSelection.end);}
    if(input)input.scrollTop=composerScroll.input;
    if(wasSearch){const search=view.querySelector('#emoji-search');search?.focus({preventScroll:true});search?.setSelectionRange(searchCursor,searchCursor);}
    restoreChatLayout(anchor);
  }
  function animateComposerPanel(from,anchor){
    const extras=view.querySelector('.composer-extras');
    if(!extras||reduceMotion.matches||typeof extras.animate!=='function')return;
    const height=extras.getBoundingClientRect().height;
    if(Math.abs(height-from)<1)return;
    const animation=extras.animate([{height:from+'px'},{height:height+'px'}],{duration:240,easing:'cubic-bezier(0.32,0.72,0,1)'});
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
  function insertComposerText(text){if(composeComposing)return;const start=Math.min(composeText.length,composerSelection.start),end=Math.min(composeText.length,composerSelection.end);rememberComposerEdit();composeText=composeText.slice(0,start)+text+composeText.slice(end);composerSelection={start:start+text.length,end:start+text.length};syncComposerDraft();}
  function deleteComposerText(){
    if(composeComposing)return;
    rememberComposerEdit();
    let {start,end}=composerSelection;start=Math.min(start,composeText.length);end=Math.min(end,composeText.length);
    if(start===end&&start>0){const before=composeText.slice(0,start),token=emojiEntries().map(e=>e.token).find(t=>before.endsWith(t));if(token)start-=token.length;else {const segments=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(before)]:Array.from(before).map(segment=>({segment}));start-=segments.at(-1)?.segment.length||1;}}
    composeText=composeText.slice(0,start)+composeText.slice(end);composerSelection={start,end:start};syncComposerDraft();
  }
  function scrollChat(messageId='') { const list=document.getElementById('chat-messages'); if(list) requestAnimationFrame(()=>{if(chatPageTask?.kind==='restore'&&chatPageTask.roleId===route.arg)return;if(messageId){const target=[...list.querySelectorAll('[data-message]')].find(el=>el.dataset.message===messageId);if(target){target.scrollIntoView({block:'center'});target.classList.add('message-found');setTimeout(()=>target.classList.remove('message-found'),1800);}focusMessageId='';}else if(forceBottomRole===route.arg){list.scrollTop=list.scrollHeight;chatScrolls.delete(route.arg);forceBottomRole='';}else list.scrollTop=chatScrolls.has(route.arg)?chatScrolls.get(route.arg):list.scrollHeight;list.dataset.scrollReady='true';list.dataset.pinned=String(!messageId&&!chatScrolls.has(route.arg));}); }
  function bindFilterInput(input,setValue,render=refresh){
    let composing=false,scheduled=false;
    const update=()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;if(composing||!input.isConnected)return;const cursor=input.selectionStart,id=input.id;setValue(input.value);render();const next=view.querySelector('#'+id);next?.focus({preventScroll:true});try{next?.setSelectionRange(cursor,cursor);}catch{}});};
    input.addEventListener('compositionstart',()=>{composing=true;searchComposing=true;});
    input.addEventListener('compositionend',()=>{composing=false;searchComposing=false;if(input.isConnected){setValue(input.value);update();flushRender();}});
    input.oninput=event=>{if(event.isComposing){composing=true;searchComposing=true;}setValue(input.value);if(!composing&&!event.isComposing)update();};
  }
  function syncContactIndex(rail){
    rail.classList.toggle('index-scrollable',rail.scrollHeight>rail.clientHeight+1);
  }
  function bindContactIndex(){
    const rail=view.querySelector('.contact-index-rail'),content=view.querySelector('.content.contacts');if(!rail||!content)return;
    syncContactIndex(rail);
    const jump=letter=>{if(letter==='top'){content.scrollTop=0;return;}const group=document.getElementById('contact-group-'+letter);if(group&&content.contains(group))content.scrollTop+=group.getBoundingClientRect().top-content.getBoundingClientRect().top;};
    rail.querySelectorAll('[data-contact-index]').forEach(button=>button.onclick=()=>jump(button.dataset.contactIndex));
    const follow=event=>{const button=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-contact-index]');if(button&&rail.contains(button))jump(button.dataset.contactIndex);};
    rail.onpointerdown=event=>{if(event.button!==0||rail.classList.contains('index-scrollable'))return;event.preventDefault();rail.setPointerCapture(event.pointerId);follow(event);};rail.onpointermove=event=>{if(rail.hasPointerCapture(event.pointerId))follow(event);};
  }
  function bindMain() {
    if (window.ClassicSocial) {
      window.ClassicSocial.decorate(view,route,state);
      window.ClassicSettings.decorate(view,route,state);
      if (route.name === 'chat') window.ClassicChat.decorate(view);
    }
    window.WaterdropChat?.decorate(view);
    globalThis.window?.PipiMotion?.decorateView(view,route);
    bindActionButtons(view);
    if (route.name === 'skins') {
      view.querySelector('.skin-picker').onchange = event => {
        if (event.target.name === 'appearance-skin') selectSkin(event.target.value);
      };
    }
    if(route.name==='status-editor')bindStatusEditor();
    view.querySelectorAll('[data-status-preset]').forEach(button=>button.onclick=()=>{statusDraft={preset:button.dataset.statusPreset,description:statusDraft?.description||''};showView('status-editor');});
    view.querySelectorAll('[data-status-history]').forEach(button=>button.onclick=()=>{const item=state.statusHistory.find(item=>item.id===button.dataset.statusHistory),choice=statusChoice(item.preset);openPage('历史状态',`<div class="status-history-detail"><h3>${icons[choice[2]]}${esc(choice[1])}</h3><p>${esc(item.description||'未填写说明')}</p><time>${esc(new Date(item.startedAt).toLocaleString('zh-CN',{hour12:false}))}</time><p>已结束</p></div>`,null);});
    view.querySelectorAll('[data-nav]').forEach(el=>el.onclick=()=>showView(el.dataset.nav,el.dataset.arg||undefined));
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
    bindHistorySearch();
    view.querySelectorAll('[data-remove-sticker]').forEach(el=>el.onclick=()=>confirmDialog('移除这个表情？','移除后可重新添加，聊天记录中的图片不受影响。',()=>act('sticker.delete',{id:el.dataset.removeSticker}),'移除'));
    if(route.name==='storage')window.PipiStorage.bind();
    if(route.name==='account-security')window.PipiAccount.bind();
    if(route.name==='stickers'){window.PipiStickers.bind(view);const file=view.querySelector('#sticker-file');if(file)file.onchange=()=>uploadStickers([...file.files],route,authEpoch);}
  }
  function bindActionButtons(root) { root?.querySelectorAll('[data-action]').forEach(el=>{if(el.pipiActionBound)return;el.pipiActionBound=true;el.addEventListener('click',event=>{event.preventDefault(); Promise.resolve(handleAction(el.dataset.action,el)).catch(err=>toast(err.message));});}); }
  async function handleAction(action,trigger) {
    const r=roleById(route.arg);
    if(action.startsWith('permission-')&&r){const key=action.slice('permission-'.length);await act('role.save',{id:r.id,permissions:{[key]:!r.permissions?.[key]}});refresh();return;}
    if(action==='engine-usage'){await window.PipiUsage.open();return;}
    if(action==='engine-home'||action==='engine-functions'){window.PipiEngine.openSettings(action);return;}
    if(action==='role-stickers'||action==='role-reminders'){if(r){if(action==='role-reminders')window.PipiEngine?.invalidateJobs(r.id);showView(action,r.id);}return;}
    if(action==='activate-waterdrop')return activateWaterdrop(trigger);
    if (['skins','settings','providers','role-personas','about','backup','moments','ledger','farm','favorites','services','wallet'].includes(action)) { showView(action); return; }
    if(action==='friend-permissions'){showView(action);return;}
    if(action==='friend-profile'&&r){showView(action,r.id);return;}
    if(action.startsWith('coming-')) { if(window.ClassicEntries?.open(action,{route,state,trigger}))return;toast(({ 'coming-channels':'视频号内容暂未开放','coming-scan':'扫一扫暂未开放','coming-group':'群聊暂未开放','coming-camera':'拍摄暂未开放，可使用「照片」上传图片','coming-call':'音视频通话暂未开放','coming-more':'更多扩展暂未开放','coming-strong-alert':'强提醒暂未开放','coming-pay':'收付款暂未开放','coming-video':'视频通话暂未开放','coming-location':'位置暂未开放','coming-contact-card':'个人名片发送暂未开放','coming-file':'文件发送暂未开放','coming-cards':'卡券暂未开放','coming-music':'音乐暂未开放','coming-gift':'礼物暂未开放','coming-radar':'雷达加朋友暂未开放','coming-phone-contacts':'手机联系人暂未开放','coming-work-contacts':'企业微信联系人暂未开放' })[action] || '此功能暂未开放', true); return; }
    switch(action) {
      case 'open-status':if(activeStatus())showView('status');else{statusDraft={preset:'',description:''};showView('status-picker');}break;
      case 'edit-status':{const current=activeStatus();statusDraft={preset:current?.preset||'',description:current?.description||''};showView(current?'status-editor':'status-picker');break;}
      case 'choose-status':showView('status-picker');break;
      case 'status-history':{
        showView('status-history');
        // The server archives a status that expired since the last state update.
        if(state.profile.status&&state.profile.status.expiresAt<=Date.now()){
          const opened=route;
          return api('/api/state').then(result=>{
            if(route===opened){setState(result.state||result);refresh();}
          },error=>{if(route===opened)toast(error.message);});
        }
        break;
      }
      case 'cancel-status':statusDraft=null;leaveStatusFlow();break;
      case 'end-status':confirmDialog('结束状态？','结束后将不再展示当前状态。',async isCurrent=>{await act('status.end');if(isCurrent())leaveStatusFlow(true);},'结束状态');break;
      case 'storage': showView('storage');break;
      case 'account-security': showView('account-security');break;
      case 'android-settings': if(window.PipiAndroidPage)location.href='/__android/settings';break;
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
      case 'clear-conversation': if(r)confirmDialog('清空聊天记录？',`将删除与 ${roleName(r)} 的全部消息，保留联系人和共同记忆。未领取的红包和转账会自动退回，款项记录保留在零钱明细里。`,()=>act('conversation.clear',{roleId:r.id}),'清空');break;
      case 'delete-role': if(r)confirmDialog('删除这位联系人？','将删除聊天记录、共同记忆、TA 的朋友圈和点赞评论、农场记录及提醒。转账和红包记录保留在零钱明细里，未领取的款项会自动退回，收藏保留快照。',async isCurrent=>{await act('role.delete',{id:r.id});if(isCurrent())showView('contacts');},'删除');break;
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
      case 'glass-mode': {
        const {glassChoices, glassChoice, selectGlass} = window.PipiSkins;
        window.PipiModels.singleChoiceSheet('玻璃效果',glassChoices,glassChoice,selectGlass,
          {name:'glass-mode',selectImmediately:true});
        break;
      }
      case 'chat-background':if(r)editChatBackground(r);break;
      case 'forward-selected':if(chatSelection)await forwardMessages([...chatSelection.ids]);break;
      case 'delete-selected':if(chatSelection){const selected=chatSelection;confirmDialog('删除选中的消息？',`将删除 ${selected.ids.size} 条聊天记录。`,async isCurrent=>{await act('message.deleteMany',{roleId:selected.roleId,ids:[...selected.ids]});if(isCurrent()){closeModal(false);await afterOverlayBack();}if(chatSelection===selected)finishMessageSelection();},'删除');}break;
      case 'role-menu': if(r) showView('contact-settings',r.id); break;
      case 'toggle-emoji': {const opening=panel!=='emoji';if(opening){emojiTab='all';emojiSearch='';emojiExpandedHeight=0;composerScroll.emoji=0;}changeComposerMode(opening?'emoji':'',!opening);break;}
      case 'toggle-panel': morePage=0;changeComposerMode(panel==='more'?'':'more');break;
      case 'toggle-voice': {if(recordingSession?.mode==='dictation'||recordingSession?.mode==='hold')stopRecording(true);const opening=panel!=='voice';changeComposerMode(opening?'voice':'',!opening);break;}
      case 'dictation': if(recordingSession?.mode==='dictation'){stopRecording(recordingSession.phase!=='recording');}else if(!recordingSession&&!dictationBusy&&!composeComposing){await startRecording('dictation');}break;
      case 'finish-dictation':if(recordingSession?.mode==='dictation'&&recordingSession.phase==='recording')stopRecording(false);break;
      case 'cancel-dictation':if(recordingSession?.mode==='dictation')stopRecording(true);break;
      case 'record': break;
      case 'more-prev': morePage=0;updateComposer();break;
      case 'more-next': morePage=1;updateComposer();break;
      case 'emoji-prev': emojiPage=0;updateComposer();break;
      case 'emoji-next': emojiPage=1;updateComposer();break;
      case 'emoji-delete':deleteComposerText();break;
      case 'emoji-send':await sendMessage(true,true);break;
      case 'manage-stickers':showView('stickers');break;
      case 'contact-tags':showView('contact-tags');break;
      case 'add-sticker': chooseComposerFiles('#sticker-file', uploadStickers); break;
      case 'clear-quote': quoteId=''; updateComposer(); break;
      case 'clear-image': ++chatImageSequence;processingImage=null;composeImage='';composeImageMeta=null;composeStickerId=''; updateComposer(); break;
      case 'upload-chat-image': chooseComposerFiles('#chat-image-file', useChatImage); break;
      case 'chat-transfer': window.PipiFeatures.transfer('transfer',r?.id,{fromChat:true}); break;
      case 'chat-redpacket': window.PipiFeatures.transfer('redpacket',r?.id,{fromChat:true}); break;
      case 'chat-pat': if(r)await patChat(r.id,'contact');break;
      case 'logout': confirmDialog('退出登录？','数据会保留在服务器，输入密码即可重新登录。',async()=>{await api('/api/logout',{}); csrf=''; state=null;window.PipiEngine?.stop();drafts.clear();composerHistories.clear();failedSends.clear();pendingSends.clear();pendingStickers.clear();retryingMessages.clear();composeText='';composeImage='';composeImageMeta=null;composeStickerId='';quoteId='';try{sessionStorage.removeItem(chatDraftKey);}catch{}closeModal(false);renderAuth(false);},'退出登录'); break;
      case 'download-backup': downloadBackup(); break;
      case 'restore-backup': pickBackup(); break;
    }
  }
  function conversationMenu(r) {
    const pinIcon = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h8l-1 7 3 3v2H6v-2l3-3-1-7ZM12 15v6"/>${r.pinned ? '<path d="M3 3l18 18"/>' : ''}</svg>`;
    const hideIcon = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M6.4 6.4A17 17 0 0 0 2 12s4 7 10 7c1.8 0 3.5-.6 5-1.5M10 5.2c.7-.1 1.3-.2 2-.2 6 0 10 7 10 7a19 19 0 0 1-2.7 3.5M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
    actionSheet(roleName(r),[
      {label:r.pinned?'取消置顶':'置顶聊天',icon:pinIcon,run:async()=>{await act('conversation.pin',{roleId:r.id,pinned:!r.pinned});refresh();}},
      {label:'标为未读',icon:icons.chat,run:async()=>{await act('conversation.unread',{roleId:r.id});refresh();}},
      {label:'不显示此聊天',icon:hideIcon,run:async()=>{await act('conversation.hide',{roleId:r.id,hidden:true});refresh();toast('已从会话列表隐藏，通讯录中仍可找到');}},
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
    function setConversationSwiped(el, swiped) {
      const wrap=el?.parentElement;
      if(!el||!wrap)return;
      el.classList.toggle('swiped',swiped);
      wrap.classList.toggle('conversation-swiped',swiped);
      const actions=wrap.querySelector('.conversation-actions');
      if(actions){
        if(!swiped && actions.contains(document.activeElement))el.focus({preventScroll:true});
        actions.setAttribute('aria-hidden',String(!swiped));
        actions.querySelectorAll('button').forEach(btn=>{btn.tabIndex=swiped?0:-1;});
      }
    }
    view.querySelectorAll('[data-open-chat]').forEach(el=>{
      const r=roleById(el.dataset.openChat); let timer, startX=0,startY=0, suppress=false;
      el.addEventListener('click',event=>{if(suppress){event.preventDefault();suppress=false;return;} if(el.classList.contains('swiped')){setConversationSwiped(el,false);return;} showView('chat',r.id);});
      el.addEventListener('contextmenu',event=>{event.preventDefault();conversationMenu(r);});
      el.addEventListener('keydown',event=>{
        if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){event.preventDefault();conversationMenu(r);return;}
        if(event.key==='ArrowLeft'){event.preventDefault();view.querySelectorAll('.swiped').forEach(node=>setConversationSwiped(node,false));setConversationSwiped(el,true);el.parentElement.querySelector('.conversation-actions button')?.focus({preventScroll:true});return;}
        if((event.key==='ArrowRight'||event.key==='Escape')&&el.classList.contains('swiped')){event.preventDefault();setConversationSwiped(el,false);}
      });
      el.addEventListener('pointerdown',event=>{if(event.button!==0)return;startX=event.clientX;startY=event.clientY;suppress=false;timer=pressTimer(()=>{suppress=true;conversationMenu(r);},550);});
      el.addEventListener('pointermove',event=>{if(Math.abs(event.clientX-startX)>12||Math.abs(event.clientY-startY)>12)clearTimeout(timer);});
      el.addEventListener('pointerup',event=>{clearTimeout(timer);if(event.clientX-startX < -45 && Math.abs(event.clientY-startY)<40){suppress=true;view.querySelectorAll('.swiped').forEach(node=>setConversationSwiped(node,false));setConversationSwiped(el,true);}else if(event.clientX-startX>45){suppress=true;setConversationSwiped(el,false);}});
      el.addEventListener('pointercancel',()=>clearTimeout(timer)); el.addEventListener('pointerleave',()=>clearTimeout(timer));
    });
    view.querySelectorAll('.conversation-actions').forEach(actions=>{
      actions.addEventListener('keydown',event=>{
        if(event.key!=='Escape'&&event.key!=='ArrowRight')return;
        const rowBtn=actions.parentElement?.querySelector('[data-open-chat]');
        if(!rowBtn)return;
        event.preventDefault();
        setConversationSwiped(rowBtn,false);
      });
    });
    view.querySelectorAll('[data-conv]').forEach(el=>el.onclick=async()=>{
      const r=roleById(el.dataset.role);if(el.dataset.conv==='delete'){confirmDialog('删除该聊天？','聊天记录将被删除，联系人仍保留在通讯录中。未领取的红包和转账会自动退回，款项记录保留在零钱明细里。',()=>act('conversation.delete',{roleId:r.id}),'删除');return;}try { await act(`conversation.${el.dataset.conv}`,{roleId:r.id,...(el.dataset.conv==='pin'?{pinned:!r.pinned}:{}),...(el.dataset.conv==='hide'?{hidden:true}:{})}); refresh(); } catch(err){toast(err.message);}
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
    if(ids.some(id=>state.messages.find(m=>m.id===id)?.meta?.expired)){toast('图片或语音已过期，无法转发；保留的文字可以复制。');return;}
    await afterOverlayBack();
    const recipients=(state.roles||[]).filter(r=>!r.permissions?.blocked).map(r=>`<label class="cell forward-recipient">${avatar(r,40)}<span class="cell-body cell-title">${esc(roleName(r))}</span><input type="radio" name="targetRoleId" value="${esc(r.id)}" required></label>`).join('');
    openModal('转发给朋友',`<p class="page-note">已选择 ${ids.length} 条消息，请选择接收的朋友并确认发送。</p><section class="section forward-mode"><label class="cell"><span class="cell-body">逐条转发</span><input type="radio" name="mode" value="individual" checked></label><label class="cell"><span class="cell-body">合并转发</span><input type="radio" name="mode" value="merged"></label></section><section class="section">${recipients||'<p class="page-note">暂无可接收转发的朋友</p>'}</section>`,async form=>{
      const {targetRoleId,mode}=formValues(form);await act('message.forward',{ids,targetRoleId,mode});if(!form.isConnected)return;
      closeModal();await afterOverlayBack();if(chatSelection){finishMessageSelection();await afterOverlayBack();}refresh();toast('已转发');
    },'发送');
  }
  function editChatBackground(r){
    let draft=r.chatBackground||'', selection=0, loading=false;
    openModal('设置聊天背景','<div class="chat-background-preview"></div><button type="button" class="secondary-btn block-btn" id="pick-chat-background">从相册选择</button><button type="button" class="secondary-btn block-btn" id="clear-chat-background">恢复默认背景</button><input id="chat-background-file" type="file" accept="image/*" hidden>',async form=>{
      if(loading)throw new Error('图片正在处理，请稍候');
      await act('role.save',{id:r.id,chatBackground:draft});
      if(form.isConnected){closeModal(false);refresh();}
    },'保存',undefined,'cancel',{lockWhileSaving:true});
    overlay.querySelector('.page-editor').classList.add('chat-background-editor');
    overlay.classList.add('has-chat-background');
    const preview=overlay.querySelector('.chat-background-preview'),file=overlay.querySelector('#chat-background-file');
    function paint() {
      const custom = safeImage(draft);
      preview.toggleAttribute('data-skin-wallpaper', !custom);
      preview.innerHTML = custom ? `<img src="${esc(draft)}" alt="聊天背景预览">` :
        `<p data-skin-wallpaper-name>${esc(window.PipiSkins?.wallpaperName || '默认聊天背景')}</p>`;
    }
    paint();
    const pick=overlay.querySelector('#pick-chat-background'),submit=overlay.querySelector('.modal-submit');
    const setLoading=value=>{loading=value;pick.disabled=value;submit.disabled=value;};
    pick.onclick=()=>file.click();
    overlay.querySelector('#clear-chat-background').onclick=()=>{selection++;setLoading(false);draft='';file.value='';paint();};
    file.onchange=async()=>{
      const chosen=file.files[0];if(!chosen)return;
      const current=++selection;file.value='';
      const isCurrent=()=>file.isConnected&&!file.closest('[inert]')&&selection===current;
      try{
        const cropped=window.PipiLifeCrop
          ?await window.PipiLifeCrop.pick(chosen,'chatBackground',{isCurrent,parent:overlay.querySelector('.page-editor')})
          :null;
        if(window.PipiLifeCrop&&!cropped)return;
        if(!isCurrent())return;
        setLoading(true);
        const image=cropped?await uploadImageData(cropped):await uploadImage(chosen);
        if(isCurrent()){draft=image;paint();}
      }
      catch(error){if(file.isConnected&&selection===current)toast(error.message);}
      finally{if(file.isConnected&&selection===current)setLoading(false);}
    };
  }
  async function patChat(roleId,target,messageId) {
    const key=roleId+':'+target;if(patRequests.has(key))return;patRequests.add(key);
    try{
      if(route.name==='chat'&&route.arg===roleId){
        const row=[...view.querySelectorAll('[data-message]')].find(el=>el.dataset.message===messageId);
        window.PipiMotion?.patAvatar(row?.querySelector('[data-chat-avatar]'));
        window.navigator?.vibrate?.(20);
      }
      await act('message.pat',{roleId,target});
      if(route.name==='chat'&&route.arg===roleId)refresh();
    }finally{patRequests.delete(key);}
  }
  function readTextMessage(content) {
    openPage('文字消息',`<article class="message-reader" aria-label="放大阅读消息"><div>${richText(content)}</div></article>`);
    overlay.querySelector('.page-editor').classList.add('text-reader-page');
    overlay.querySelector('.message-reader').onclick=()=>closeModal();
  }
  function cancelAvatarTaps(){for(const tap of avatarTaps.values())clearTimeout(tap.timer);avatarTaps.clear();}
  function chatNearBottom(list){return list.scrollHeight-list.scrollTop-list.clientHeight<=80;}
  function trackNewChatMessages(previous,next,candidates=next.messages){
    const list=view.querySelector('#chat-messages');
    if(!previous||route.name!=='chat'||list?.dataset.scrollReady!=='true')return;
    if(!chatHistoryWindows.get(route.arg)?.endId&&chatNearBottom(list))return;
    const previousIds=new Set(previous.messages.map(message=>message.id));
    for(const message of candidates){
      if(message.roleId===route.arg&&message.sender!=='user'&&message.meta?.author!=='me'&&!previousIds.has(message.id))newChatMessageIds.add(message.id);
    }
    paintNewChatNotice();
  }
  function paintNewChatNotice(){
    const button=view.querySelector('.chat-new-messages');
    if(button){button.hidden=!newChatMessageIds.size;button.textContent='↓ '+newChatMessageIds.size+' 条新消息';}
  }
  function bindChat(root=view) {
    bindChatThumbnails(root);
    if(root===view)bindComposer();
    const older=root.querySelector('[data-chat-older]');if(older)older.onclick=showOlderChatMessages;
    const retry=root.querySelector('[data-chat-page-retry]');if(retry)retry.onclick=()=>{const task=chatPageTask;if(task)requestChatPage(task.kind,task.roleId,task.messageId,task.reading);};
    const newer=root.querySelector('[data-chat-newer]');if(newer)newer.onclick=()=>{const page=window.PipiStateSync.client.paging,rows=page.rows(route.arg),last=chatHistoryWindows.get(route.arg)?.endId;const next=rows.findIndex(row=>row.id===last)+1+chatHistoryPageSize/2;chatHistoryWindows.set(route.arg,{limit:chatHistoryPageSize,endId:next<rows.length?rows[next-1].id:''});refresh();};
    const latest=root.querySelector('[data-chat-latest]');if(latest)latest.onclick=showLatestChatMessages;
    const cancelReply=root.querySelector('[data-chat-cancel]');if(cancelReply)cancelReply.onclick=()=>cancelChatReply(cancelReply);
    for(const button of root.querySelectorAll('[data-message-speech]')){
      button.onclick=()=>{
        if(speechSession?.id!==button.dataset.messageSpeech)return;
        if(speechSession.phase==='ready')startSpeechAudio(speechSession);
        else stopSpeech();
      };
    }
    if(root===view&&speechSession)paintSpeech(speechSession.id);
    const chatList=root.querySelector('#chat-messages'),newMessageNotice=root.querySelector('.chat-new-messages');
    if(chatList&&newMessageNotice){
      const pin=()=>{if(chatList.isConnected&&chatList.dataset.scrollReady==='true'&&chatList.dataset.pinned==='true'&&!chatHistoryWindows.get(route.arg)?.endId)chatList.scrollTop=chatList.scrollHeight;};
      if(typeof ResizeObserver==='function'){
        chatList.rowObserver=new ResizeObserver(pin);
        for(const row of chatList.children)chatList.rowObserver.observe(row);
        chatList.rowObserver.observe(chatList);
        const footer=view.querySelector('.chat-composer');if(footer)chatList.rowObserver.observe(footer);
      }else{
        chatList.addEventListener('load',pin,true);
        if(typeof MutationObserver==='function'){chatList.rowMutations=new MutationObserver(pin);chatList.rowMutations.observe(chatList,{childList:true,subtree:true});}
      }
      paintNewChatNotice();
      chatList.addEventListener('scroll',()=>{
        if(chatList.dataset.scrollReady==='true')chatList.dataset.pinned=String(chatNearBottom(chatList)&&!chatHistoryWindows.get(route.arg)?.endId);
        if(chatList.isConnected&&chatList.dataset.scrollReady==='true'&&newChatMessageIds.size&&!chatHistoryWindows.get(route.arg)?.endId&&chatNearBottom(chatList)){
          newChatMessageIds.clear();paintNewChatNotice();
        }
      },{passive:true});
      newMessageNotice.onclick=()=>{if(chatHistoryWindows.get(route.arg)?.endId){showLatestChatMessages();return;}chatList.dataset.pinned='true';chatList.scrollTop=chatList.scrollHeight;chatScrolls.delete(route.arg);newChatMessageIds.clear();paintNewChatNotice();};
    }
    root.querySelectorAll('[data-select-range]').forEach(el=>el.onclick=()=>selectMessageRange(el.dataset.selectRange));
    root.querySelectorAll('[data-reedit]').forEach(el=>el.onclick=()=>reeditMessage(el.dataset.reedit));
    root.querySelectorAll('[data-transcribe]').forEach(el=>el.onclick=()=>transcribeMessage(el.dataset.transcribe));
    root.querySelectorAll('[data-chat-avatar]').forEach(el=>{
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
    root.querySelectorAll('[data-select-message]').forEach(el=>el.onclick=()=>toggleSelectedMessage(el.dataset.selectMessage));
    root.querySelectorAll('[data-quote-message]').forEach(el=>el.onclick=()=>{
      if(chatSelection||!el.dataset.quoteMessage)return;
      jumpToMessage(route.arg,el.dataset.quoteMessage);
    });
    root.querySelectorAll('[data-receipt-payment]').forEach(el=>el.onclick=()=>window.PipiFeatures.walletTransaction(el.dataset.receiptPayment,undefined,{fromChat:true}));
    // Message-area taps dismiss input, as in the native chat references above.
    // Cards, avatars and long-press targets keep their own click behaviour.
    const list=root.querySelector('#chat-messages');
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
    root.querySelectorAll('[data-bubble]').forEach(el=>{
      let timer, suppress=false, startX=0,startY=0;
      el.oncontextmenu=event=>{event.preventDefault();suppress=true;clearTimeout(timer);if(!chatSelection)messageMenu(el.dataset.bubble,el);};
      el.onpointerdown=event=>{if(event.button!==0)return;startX=event.clientX;startY=event.clientY;suppress=false;if(!chatSelection)timer=pressTimer(()=>{suppress=true;messageMenu(el.dataset.bubble,el);},500);};
      el.onpointermove=event=>{if(Math.abs(event.clientX-startX)>12||Math.abs(event.clientY-startY)>12){suppress=true;clearTimeout(timer);}};
      el.onpointerup=()=>clearTimeout(timer);el.onpointercancel=()=>{suppress=true;clearTimeout(timer);};el.onpointerleave=()=>clearTimeout(timer);
      el.onclick=()=>{if(suppress){suppress=false;return;}if(chatSelection){if(state.messages.find(x=>x.id===el.dataset.bubble)?.sender!=='system')toggleSelectedMessage(el.dataset.bubble);return;}const m=state.messages.find(x=>x.id===el.dataset.bubble);if(!m)return;if(m.type==='voice'){if(m.meta?.expired){toast('语音已过期');return;}playAudio(m.meta?.audio,m.id);return;}if(['transfer','redpacket'].includes(m.type)){if(m.meta?.transactionId)window.PipiFeatures?.walletTransaction?.(m.meta.transactionId, undefined, { fromChat: true });else toast('未找到这笔交易的详情');return;}if(m.type==='forward'){openForwardDetails(m);return;}if(el.classList.contains('sticker-bubble'))return;if(el.classList.contains('image-bubble')){if(m.meta?.expired){toast('图片已过期');return;}const src=m.type==='image'?m.content:m.meta?.image;if(safeImage(src)){const images=state.messages.filter(message=>message.roleId===m.roleId&&!(message.type==='image'&&message.meta?.stickerId)).map(message=>({id:message.id,src:message.type==='image'?message.content:message.meta?.image})).filter(item=>safeImage(item.src));lightbox(src,'聊天图片',{images:images.map(item=>item.src),messageIds:images.map(item=>item.id),index:images.findIndex(item=>item.id===m.id)});}}};
      el.ondblclick=event=>{const m=state.messages.find(x=>x.id===el.dataset.bubble);if(suppress||modalOpen||chatSelection||m.sender==='system'||m.type!=='text'||el.classList.contains('image-bubble'))return;event.preventDefault();readTextMessage(m.content);};
      el.onkeydown=event=>{if(chatSelection){if(['Enter',' '].includes(event.key)){event.preventDefault();toggleSelectedMessage(el.dataset.bubble);}else if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))event.preventDefault();return;}if((event.key==='Enter'||event.key===' ')&&(el.classList.contains('payment-card')||state.messages.find(m=>m.id===el.dataset.bubble)?.type==='voice')){event.preventDefault();el.click();return;}if(event.key==='Enter'||event.key===' '||event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){event.preventDefault();messageMenu(el.dataset.bubble,el);}};
    });
    root.querySelectorAll('[data-message-menu]').forEach(el=>el.onclick=()=>messageMenu(el.dataset.messageMenu));
    root.querySelectorAll('[data-retry]').forEach(el=>el.onclick=()=>{const message=state.messages?.find(m=>m.id===el.dataset.retry);confirmDialog('重新发送？',message?.error||'消息发送失败，是否重新发送？',()=>retryMessage(el.dataset.retry),'重新发送');});
    root.querySelectorAll('[data-speak]').forEach(el=>el.onclick=()=>speakMessage(el.dataset.speak,el));
    root.querySelectorAll('[data-play]').forEach(el=>el.onclick=()=>playAudio(state.messages.find(m=>m.id===el.dataset.play)?.meta?.audio,el.dataset.play));
  }
  function chooseComposerFiles(selector, onSelect) {
    const template = view.querySelector(selector);
    if (!template) return;
    const origin = route, epoch = authEpoch;
    const editor = view.querySelector('#compose-text');
    if (editor && document.activeElement === editor) {
      composerSelection = readComposerSelection(editor);
      editor.blur();
    }
    persistChatDrafts();
    systemFilePicker?.remove();
    // The native chooser can outlive a view refresh. Keep its input outside
    // the rebuilt composer so the browser can deliver change or cancel.
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = template.accept;
    picker.multiple = template.multiple;
    picker.hidden = true;
    systemFilePicker = picker;
    view.after(picker);
    function settle() {
      picker.remove();
      if (systemFilePicker !== picker) return false;
      systemFilePicker = null;
      scheduleViewport();
      return (route===origin||origin.name==='chat'&&route.name==='chat'&&route.arg===origin.arg)&&authEpoch===epoch;
    }
    picker.addEventListener('cancel', settle, {once:true});
    picker.addEventListener('change', () => {
      const files = [...picker.files];
      if(settle()){if(files.length)void onSelect(files,origin,epoch);}else if(files.length&&origin.name==='chat')toast('已离开聊天，图片没有发送');
    }, {once:true});
    if (window.PipiAndroidPage && selector==='#chat-image-file') picker.dataset.androidChatPhoto = origin.arg;
    picker.click();
  }
  async function useChatImage(files, origin, epoch) {
    if (!files.length) return;
    const sequence=++chatImageSequence,roleId=origin.arg;
    const inChat=()=>route.name==='chat'&&route.arg===roleId&&authEpoch===epoch;
    if(!inChat()){toast('已离开聊天，图片没有发送');return;}
    if(processingImage)toast('已换为新选的图片',true);
    const url=URL.createObjectURL(files[0]);
    processingImage={roleId,epoch,url};composeImage='';composeImageMeta=null;composeStickerId='';paintImagePreview();
    const stillCurrent=()=>sequence===chatImageSequence&&inChat();
    try{
      const data=await prepareChatImage(files[0],stillCurrent);
      if(sequence!==chatImageSequence)return;
      if(!inChat()){toast('已离开聊天，图片没有发送');return;}
      if(!data)return;
      composeImage=data.image;composeImageMeta={thumb:data.thumb,modelImage:data.modelImage};composeStickerId='';panel='';
      processingImage=null;paintImagePreview();updateComposer();
      if(!composeText.trim())void sendMessage();
    }catch(error){toast(error.message);}
    finally{URL.revokeObjectURL(url);if(sequence===chatImageSequence&&processingImage){processingImage=null;if(inChat())paintImagePreview();}}
  }
  function bindComposer() {
    if (window.ClassicSocial) window.ClassicChat.decorate(view);
    const form=view.querySelector('#compose-form'); if(!form)return;
    if(!form.pipiMouseBound){
      form.pipiMouseBound=true;
      const footer=form.closest('.chat-composer'),selector='[type=submit],[data-emoji],[data-action=emoji-send],[data-action=clear-quote],[data-action=clear-image]';
      let touch=null;
      for(const eventName of ['mousedown','pointerdown'])footer?.addEventListener(eventName,event=>{
        if(document.activeElement?.id==='compose-text'&&event.target.closest(selector))event.preventDefault();
      });
      footer?.addEventListener('touchstart',event=>{
        const button=event.target.closest(selector);
        if(!button||button.disabled||document.activeElement?.id!=='compose-text'||event.touches.length!==1){touch=null;return;}
        const finger=event.changedTouches[0];
        touch={button,id:finger.identifier,x:finger.clientX,y:finger.clientY};event.preventDefault();
      },{passive:false});
      footer?.addEventListener('touchmove',event=>{
        if(!touch)return;
        for(const finger of Array.from(event.changedTouches))if(finger.identifier===touch.id&&Math.hypot(finger.clientX-touch.x,finger.clientY-touch.y)>12)touch=null;
      },{passive:true});
      footer?.addEventListener('touchcancel',()=>{touch=null;});
      footer?.addEventListener('touchend',event=>{
        if(!touch)return;
        const saved=touch;touch=null;
        const finger=Array.from(event.changedTouches).find(item=>item.identifier===saved.id);
        event.preventDefault();
        if(finger&&saved.button.isConnected&&Math.hypot(finger.clientX-saved.x,finger.clientY-saved.y)<=12)saved.button.click();
      },{passive:false});
    }
    form.querySelectorAll('button:not([type])').forEach(button=>button.type='button');
    form.onsubmit=event=>{event.preventDefault();sendMessage(false,true);};
    const input=view.querySelector('#compose-text');
    if(input&&!input.pipiBound){
      input.pipiBound=true;
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
      input.onselect=rememberSelection;input.onkeyup=rememberSelection;input.onclick=()=>{rememberSelection();useKeyboard();};input.onblur=()=>{rememberSelection();if(composeComposing){composeComposing=false;composeText=readComposerText(input);syncComposerControls();persistChatDrafts();}};
      const acceptInput=()=>{composeText=readComposerText(input);rememberSelection();if(!composeComposing){
        const tokens=compiledEmoji(),needsEmoji=tokens.expression&&[...input.childNodes].some(node=>node.nodeType===Node.TEXT_NODE&&node.data.split(tokens.expression).some(part=>tokens.map.has(part)));
        if(needsEmoji||[...input.children].some(node=>node.tagName!=='BR'&&!node.dataset.composeToken))paintComposer(input,document.activeElement===input);
      }resizeComposeInput(input);syncComposerControls();persistChatDrafts();};
      input.oninput=event=>{if(!input.isConnected)return;if(event.isComposing)composeComposing=true;acceptInput();if(composeComposing||composeText.trim())window.PipiEngine?.activity(route.arg);else window.PipiEngine?.stopActivity?.(route.arg);useKeyboard();};
      input.addEventListener('compositionstart',()=>{rememberSelection();rememberComposerEdit();composeComposing=true;window.PipiEngine?.activity(route.arg);syncComposerControls();});
      input.addEventListener('compositionend',()=>{composeComposing=false;if(!input.isConnected)return;composeText=readComposerText(input);rememberSelection();resizeComposeInput(input);syncComposerControls();requestAnimationFrame(()=>{if(composeComposing||!input.isConnected)return;acceptInput();if(recordingSession?.transcript)applyDictationTranscript(recordingSession);if(deferredComposerUpdate){deferredComposerUpdate=false;updateComposer();}flushRender();});});
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
      input.addEventListener('paste',event=>{event.preventDefault();if(composeComposing)return;rememberSelection();useKeyboard(true);insertComposerText((event.clipboardData?.getData('text/plain')||'').replace(/\r\n?/g,'\n'));});
      input.addEventListener('drop',event=>{event.preventDefault();if(composeComposing)return;rememberSelection();useKeyboard(true);insertComposerText((event.dataTransfer?.getData('text/plain')||'').replace(/\r\n?/g,'\n'));});
      for(const type of ['copy','cut'])input.addEventListener(type,event=>{const selection=readComposerSelection(input);if(selection.start===selection.end)return;event.preventDefault();event.clipboardData?.setData('text/plain',readComposerText(input).slice(selection.start,selection.end));if(type==='cut'&&!composeComposing){composerSelection=selection;useKeyboard(true);insertComposerText('');}});
    }
    const removeEmoji=view.querySelector('[data-action=emoji-delete]');
    if(removeEmoji&&!removeEmoji.pipiBound){
      removeEmoji.pipiBound=true;
      removeEmoji.addEventListener('click',event=>{if(event.detail){event.preventDefault();event.stopImmediatePropagation();}},true);
      removeEmoji.addEventListener('pointerdown',event=>{
        if(event.button!==0||removeEmoji.disabled)return;
        event.preventDefault();stopComposerDeleteHold();
        if(input)composerSelection=readComposerSelection(input);
        const controller=new AbortController(),origin=route;let timer;
        const stop=()=>{clearTimeout(timer);controller.abort();stopComposerDeleteHold=()=>{};};stopComposerDeleteHold=stop;
        const tick=()=>{if(!removeEmoji.isConnected||removeEmoji.disabled||route!==origin||panel!=='emoji'||document.hidden){stop();return;}deleteComposerText();timer=setTimeout(tick,70);};
        deleteComposerText();timer=setTimeout(tick,450);
        for(const type of ['pointerup','pointercancel','blur'])window.addEventListener(type,stop,{signal:controller.signal});
        document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();},{signal:controller.signal});
        removeEmoji.addEventListener('pointerleave',stop,{signal:controller.signal});
        removeEmoji.addEventListener('pointermove',e=>{const box=removeEmoji.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)stop();},{signal:controller.signal});
        removeEmoji.addEventListener('contextmenu',e=>e.preventDefault(),{signal:controller.signal});
      });
    }
    const emojiScroll=view.querySelector('.emoji-scroll');if(emojiScroll)emojiScroll.scrollTop=composerScroll.emoji;
    view.querySelectorAll('[data-emoji-page]').forEach(el=>el.onclick=()=>{emojiPage=Number(el.dataset.emojiPage);updateComposer();});
    view.querySelectorAll('[data-emoji]').forEach(el=>el.onclick=()=>{const token=el.dataset.emoji;insertComposerText(token);recordEmojiUse(token);});
    view.querySelectorAll('[data-emoji-tab]').forEach(el=>el.onclick=()=>{emojiTab=el.dataset.emojiTab;updateComposer();if(emojiTab==='search')view.querySelector('#emoji-search')?.focus();});
    const emojiInput=view.querySelector('#emoji-search');if(emojiInput&&!emojiInput.pipiBound){emojiInput.pipiBound=true;bindFilterInput(emojiInput,value=>{emojiSearch=value;},updateComposer);}
    view.querySelectorAll('[data-sticker]').forEach(el=>el.onclick=()=>{const sticker=state.stickers?.find(s=>s.id===el.dataset.sticker);if(sticker&&safeImage(sticker.image)){sendSticker(sticker);}});
    const stickerFile=view.querySelector('#sticker-file');if(stickerFile)stickerFile.onchange=()=>uploadStickers([...stickerFile.files],route,authEpoch);
    const drag=view.querySelector('.emoji-drag-handle');if(drag){let startY=0,height=0;const resize=delta=>{const max=Math.max(220,document.querySelector('.phone-shell').clientHeight-180);emojiExpandedHeight=Math.max(220,Math.min(max,height+delta));const anchor=captureChatLayout();view.querySelector('.emoji-board').style.height=emojiExpandedHeight+'px';restoreChatLayout(anchor);};drag.onpointerdown=e=>{startY=e.clientY;height=view.querySelector('.emoji-board').clientHeight;drag.setPointerCapture(e.pointerId);};drag.onpointermove=e=>{if(drag.hasPointerCapture(e.pointerId))resize(startY-e.clientY);};drag.onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();height=view.querySelector('.emoji-board').clientHeight;resize(e.key==='ArrowUp'?30:-30);}};}
    const file=view.querySelector('#chat-image-file');
    if(file)file.onchange=()=>{const files=[...file.files];file.value='';void useChatImage(files,route,authEpoch);};
    const record=view.querySelector('[data-record]');
    if(record&&!record.pipiBound){record.pipiBound=true;window.PipiVoiceHold.bind({button:record,host:view.closest('.phone-shell'),
      begin:controls=>startRecording('hold',controls),onError:error=>toast(error.message)});}
    view.querySelectorAll('.more-pages,.emoji-pages').forEach(el=>{let x=0,y=0;el.onpointerdown=e=>{x=e.clientX;y=e.clientY;};el.onpointerup=e=>{if(Math.abs(e.clientX-x)>45&&Math.abs(e.clientY-y)<40){if(el.classList.contains('more-pages'))morePage=e.clientX<x?1:0;else emojiPage=Math.max(0,Math.min(Math.ceil((window.PipiEmoji?.length||48)/24)-1,emojiPage+(e.clientX<x?1:-1)));updateComposer();}};});
    syncComposerControls();
  }
  function renderPendingSend(outgoing){return `<div class="message-row mine" data-pending-id="${esc(outgoing.requestId)}"><span>${avatar(state.profile,43)}</span><div class="message-body">${outgoing.image?`<div class="message-bubble image-bubble"><img class="message-image" src="${esc(outgoing.image)}" alt="正在发送的图片"></div>`:''}${outgoing.text?`<div class="message-bubble">${esc(outgoing.text)}</div>`:''}<div class="message-label" style="text-align:right;margin-top:5px">发送中…</div></div></div>`;}
  async function sendMessage(keepEmoji=false,explicit=false) {
    if(composeComposing){
      if(!explicit)return;
      const editor=view.querySelector('#compose-text');if(!editor)return;
      const current=readComposerText(editor);
      editor.blur();editor.focus({preventScroll:true});composeComposing=false;
      composeText=readComposerText(editor)||current;
    }
    if(!canSendComposerDraft())return;
    const r=roleById(route.arg);if(!r)return;
    const draft={text:composeText,image:composeImage,imageMeta:composeImageMeta,stickerId:composeStickerId,quote:quoteId},text=draft.text.trim(),image=draft.image,quote=quotedMessage(draft.quote),failed=failedSends.get(r.id);
    if(text.length>16000){toast('这条消息超出长度限制，可以分成几条发送');return;}
    // Resending an unchanged failed draft reuses its requestId, so a request that did reach the server is not stored twice.
    const requestId=failed&&failed.text===text&&failed.image===image&&failed.stickerId===draft.stickerId&&failed.quote===(quote?.id||'')&&JSON.stringify(failed.imageMeta||{})===JSON.stringify(draft.imageMeta||{})?failed.requestId:crypto.randomUUID();
    const same=item=>item.roleId===r.id&&item.text===text&&item.image===image&&item.quote===(quote?.id||'')&&item.stickerId===draft.stickerId;
    if([...pendingSends.values()].some(same)){toast('正在发送…',true);return;}
    const pending={roleId:r.id,text,image,quote:quote?.id||'',stickerId:draft.stickerId,requestId};
    pendingSends.set(requestId,pending);
    const input=view.querySelector('#compose-text');
    if(input){input.textContent='';if(document.activeElement===input)setComposerSelection(input,0);}
    const restoreEmoji=keepEmoji&&panel==='emoji';
    window.PipiEngine?.resetActivity(r.id);
    composeText='';composeImage='';composeImageMeta=null;composeStickerId='';quoteId='';composerSelection={start:0,end:0};drafts.delete(r.id);composerHistories.delete(r.id);
    panel=restoreEmoji?'emoji':'';if(image&&view.querySelector('.compose-image-preview'))paintImagePreview();forceBottomRole=r.id;chatScrolls.delete(r.id);updateComposer();
    const list=view.querySelector('#chat-messages');
    if(list){list.dataset.pinned='true';list.insertAdjacentHTML('beforeend',renderPendingSend(pending));list.scrollTop=list.scrollHeight;}
    try {
      const uploadedImage=image?await uploadImageData(image):'';
      pending.uploadedImage=uploadedImage;
      const result=await api('/api/chat',{roleId:r.id,text,image:uploadedImage||undefined,stickerId:draft.stickerId||undefined,quoteId:quote?.id,requestId,...(imageVariants?draft.imageMeta:{})});if(failedSends.get(r.id)?.requestId===requestId)failedSends.delete(r.id);receiveState(result.state);if(result.notice)toast(result.notice);
    } catch(err) {
      toast(err.message);
      {failedSends.set(r.id,{text,image,imageMeta:draft.imageMeta,stickerId:draft.stickerId,quote:quote?.id||'',requestId});restoreFailedDraft(r.id,draft);}
      if(err.state)refresh();
    }finally{pendingSends.delete(requestId);view.querySelector('[data-pending-id="'+requestId+'"]')?.remove();}
  }
  // The failed text goes back in front of anything typed since; the newer input is never replaced.
  function mergeDraft(current={},failed){const text=failed.text?(current.text?failed.text+'\n'+current.text:failed.text):current.text||'',shift=text.length-(current.text||'').length;return {...current,text,image:current.image||failed.image||'',imageMeta:current.image?current.imageMeta:failed.imageMeta,stickerId:current.image?current.stickerId:failed.stickerId||'',quote:current.quote||failed.quote||'',selection:current.selection?{start:current.selection.start+shift,end:current.selection.end+shift}:undefined};}
  function restoreFailedDraft(roleId,draft){
    if(route.name!=='chat'||route.arg!==roleId){drafts.set(roleId,drafts.has(roleId)?mergeDraft(drafts.get(roleId),draft):draft);persistChatDrafts();return;}
    if(composeComposing){setTimeout(()=>restoreFailedDraft(roleId,draft),300);return;}
    if(!composeText&&!composeImage){composeText=draft.text;composeImage=draft.image;composeImageMeta=draft.imageMeta||null;composeStickerId=draft.stickerId;quoteId=draft.quote;composerSelection={start:draft.text.length,end:draft.text.length};updateComposer();return;}
    const input=view.querySelector('#compose-text');if(input&&document.activeElement===input)composerSelection=readComposerSelection(input);
    const before=[composeImage,quoteId],merged=mergeDraft({text:composeText,image:composeImage,imageMeta:composeImageMeta,stickerId:composeStickerId,quote:quoteId,selection:composerSelection},draft);
    rememberComposerEdit();composeText=merged.text;composeImage=merged.image;composeImageMeta=merged.imageMeta||null;composeStickerId=merged.stickerId;quoteId=merged.quote;composerSelection=merged.selection;syncComposerDraft();
    if(before[0]!==composeImage||before[1]!==quoteId)updateComposer();
  }
  // A sticker tapped beside a draft is sent on its own; the draft text and picture stay put.
  async function sendSticker(sticker){
    if(composeComposing||recordingSession)return;
    const r=roleById(route.arg);if(!r)return;
    const key=r.id+':'+sticker.id;if(pendingStickers.has(key)){toast('正在发送…',true);return;}pendingStickers.add(key);
    window.PipiEngine?.resetActivity(r.id);forceBottomRole=r.id;chatScrolls.delete(r.id);
    try{const image=await uploadImageData(sticker.image);const result=await api('/api/chat',{roleId:r.id,text:'',image,stickerId:sticker.id,requestId:crypto.randomUUID()});receiveState(result.state);}catch(err){toast(err.message);}finally{pendingStickers.delete(key);}
  }
  async function retryMessage(messageId) {
    const message=state.messages?.find(m=>m.id===messageId);
    if(!message||retryingMessages.has(messageId))return;
    if(message.meta?.expired&&message.type!=='text'){toast('图片或语音已过期，无法重新发送。');return;}
    retryingMessages.add(messageId);
    const button=view.querySelector('[data-retry="'+CSS.escape(messageId)+'"]');
    if(button){button.disabled=true;button.textContent='…';button.setAttribute('aria-label','正在重新发送');}
    try{const result=await api('/api/chat/retry',{messageId});receiveState(result.state);}
    catch(err){
      toast(err.message);
      if(err.state){pendingRender=true;flushRender(true);}
      else if(!err.stale&&err.status!==401)await resumeStateSync();
    }finally{
      retryingMessages.delete(messageId);
      const current=view.querySelector('[data-retry="'+CSS.escape(messageId)+'"]');
      if(current){current.disabled=false;current.textContent='!';current.setAttribute('aria-label','发送失败，点击重试');}
    }
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
    if(ordinary&&['text','image','voice'].includes(m.type))actions.push({label:'收藏',icon:icons.messageFavorites,run:async()=>{if(state.messages.find(item=>item.id===id)?.meta?.expired){toast('图片或语音已过期，无法收藏；保留的文字可以复制。');return;}await act('message.favorite',{id});toast('已加入收藏');}});
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
    if(message.meta?.expired){ui.phase='error';ui.error='语音已过期，无法转文字。';paintTranscript(message);return;}
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
  function forwardEntries(originId,path,fallback){
    let message=state.messages.find(item=>item.id===originId);for(const index of path)message=message?.meta?.entries?.[index];return message?.meta?.entries||fallback;
  }
  function renderForwardEntries(entries){
    return entries.map((entry,index)=>{
      const expired=entry.meta?.expired,src=entry.type==='image'?entry.content:entry.meta?.image;
      const image=expired?.kind==='image'?`<button type="button" class="forward-entry-image" data-forward-image="${index}">${renderExpiredImage(entry.meta.thumb)}</button>`:safeImage(src)?`<button type="button" class="forward-entry-image" data-forward-image="${index}"><img src="${esc(src)}" alt="转发的图片"></button>`:'';
      const body=entry.type==='voice'?`<button type="button" class="forward-entry-voice" data-forward-voice="${index}">${expired?'语音已过期':icons.voiceWave} ${Math.max(1,Math.round((entry.meta?.durationMs||1000)/1000))}″</button>${entry.meta?.transcript?`<p>${esc(entry.meta.transcript)}</p>${entry.meta.transcriptSource==='demo'?'<small class="transcript-demo">演示预设文字，非真实识别结果</small>':''}`:''}`:entry.type==='forward'?`<button type="button" class="forward-entry-nested" data-forward-nested="${index}">聊天记录 · ${entry.meta?.entries?.length||0} 条 ${icons.chevron}</button>`:entry.type==='image'?image:`<p>${richText(entry.content)}</p>${image}${expired?.kind==='voice'?'<p class="expired-voice-note">语音已过期</p>':''}`;
      return `<article class="forward-entry"><div class="forward-entry-author">${esc(entry.senderName)}</div>${body}${entry.meta?.quote?renderMessageQuote({...entry.meta.quote,messageId:''},{}):''}</article>`;
    }).join('');
  }
  function bindForwardDetails(root,getEntries,originId,path){
    root.querySelectorAll('[data-forward-image]').forEach(el=>el.onclick=()=>{const entries=getEntries(),selectedIndex=Number(el.dataset.forwardImage),entry=entries[selectedIndex];if(entry.meta?.expired){toast('图片已过期');return;}const images=entries.map((item,entryIndex)=>({entryIndex,src:item.type==='image'?item.content:item.meta?.image})).filter(item=>safeImage(item.src)),src=entry.type==='image'?entry.content:entry.meta.image;lightbox(src,'转发的图片',{images:images.map(item=>item.src),index:images.findIndex(item=>item.entryIndex===selectedIndex),getMedia:index=>getEntries()[images[index].entryIndex]});});
    root.querySelectorAll('[data-forward-voice]').forEach(el=>el.onclick=()=>{const entry=getEntries()[Number(el.dataset.forwardVoice)];if(entry.meta?.expired){toast('语音已过期');return;}playAudio(entry.meta?.audio,undefined,()=>getEntries()[Number(el.dataset.forwardVoice)]);});
    root.querySelectorAll('[data-forward-nested]').forEach(el=>el.onclick=()=>{const index=Number(el.dataset.forwardNested);openForwardDetails(getEntries()[index],originId,[...path,index]);});
  }
  function openForwardDetails(message,originId=message.id,path=[]){
    const getEntries=()=>forwardEntries(originId,path,message.meta?.entries||[]),entries=getEntries();
    openNestedPage('聊天记录',`<div class="forward-detail">${renderForwardEntries(entries)}</div>`,null);
    const root=overlay.querySelector(':scope > .page-editor .forward-detail');bindForwardDetails(root,getEntries,originId,path);
    let previous=JSON.stringify(entries);forwardDetails.set(root,()=>{const next=getEntries(),encoded=JSON.stringify(next);if(encoded===previous)return;previous=encoded;const body=root.closest('.modal-body'),top=body.scrollTop;root.innerHTML=renderForwardEntries(next);bindForwardDetails(root,getEntries,originId,path);body.scrollTop=top;});
  }
  function currentMediaMessage(id){
    if(!id)return;
    return state.messages.find(message=>message.id===id)||window.PipiStateSync?.client?.paging?.delta(state)?.upserts?.find(message=>message.id===id);
  }
  function syncExpiredMedia(){
    if(!state)return;
    const delta=window.PipiStateSync?.client?.paging?.delta(state);
    if(speechSession&&(delta?.deletedIds?.includes(speechSession.id)||(currentMediaMessage(speechSession.id)||speechSession.getSource?.())?.meta?.expired?.kind==='voice'))stopSpeech();
    syncImageViewer?.();for(const [root,update]of forwardDetails){if(!root.isConnected)forwardDetails.delete(root);else if(!root.closest('[inert]'))update();}
  }
  function lightbox(src,alt='图片',options={}) {
    if(!safeImage(src))return;
    let images=(options.images||[src]).filter(safeImage);if(!images.includes(src))images=[src];
    let index=Number.isInteger(options.index)&&images[options.index]===src?options.index:images.indexOf(src),downloadName='',scale=1,x=0,y=0,startX=0,startY=0,startPanX=0,startPanY=0,pinchStart=0,pinchScale=1,pinched=false;
    const pointers=new Map(),parent=captureModalParent();modalCloseCallback=parent?()=>restoreModalParent(parent):null;modalReturnFocus=document.activeElement;modalOpen=true;trackModalHistory(!!parent);
    overlay.innerHTML=`<div class="lightbox image-viewer" role="dialog" aria-modal="true" aria-label="查看图片"><div class="image-stage" tabindex="0" aria-label="图片，可双击放大或用下方按钮缩放"><img alt="${esc(alt)}" draggable="false"></div><button class="lightbox-close" aria-label="关闭图片">${icons.close}</button><button class="image-more" aria-label="图片操作" aria-expanded="false" aria-controls="image-actions">${icons.more}</button><div id="image-actions" class="image-actions" role="menu" hidden><button type="button" data-image-forward role="menuitem" hidden>转发给朋友</button><button type="button" data-image-favorite role="menuitem" hidden>收藏</button><button type="button" class="image-save" role="menuitem">保存图片</button><button type="button" data-image-menu-cancel role="menuitem">取消</button></div><span class="image-counter" aria-live="polite"></span><div class="lightbox-controls"><div class="image-gallery-controls"><button type="button" data-image-prev aria-label="上一张图片">‹</button><button type="button" data-image-next aria-label="下一张图片">›</button></div><div class="image-zoom-controls"><button type="button" data-image-out aria-label="缩小图片">−</button><button type="button" data-image-reset aria-label="恢复原始大小">100%</button><button type="button" data-image-in aria-label="放大图片">＋</button></div></div></div>`;
    mountModalParent(parent);
    const box=overlay.querySelector(':scope > .image-viewer'),stage=box.querySelector('.image-stage'),reset=box.querySelector('[data-image-reset]'),save=box.querySelector('.image-save');
    let img=stage.querySelector('img');
    const loading=document.createElement('span');
    loading.className='image-loading-label';loading.textContent='图片加载中…';loading.setAttribute('role','status');loading.hidden=true;stage.append(loading);
    const menu=box.querySelector('.image-actions'),more=box.querySelector('.image-more'),forward=box.querySelector('[data-image-forward]'),favorite=box.querySelector('[data-image-favorite]');
    const currentMedia=()=>options.getMedia?options.getMedia(index):currentMediaMessage(options.messageIds?.[index]);
    const hideMenu=()=>{menu.hidden=true;more.setAttribute('aria-expanded','false');};
    more.onclick=()=>{menu.hidden=!menu.hidden;more.setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden)menu.querySelector('button:not([hidden])').focus({preventScroll:true});};
    box.querySelector('[data-image-menu-cancel]').onclick=()=>{hideMenu();more.focus({preventScroll:true});};stage.onclick=hideMenu;
    const transform=()=>{img.style.transform=`translate(${x}px,${y}px) scale(${scale})`;reset.textContent=Math.round(scale*100)+'%';};
    const zoom=value=>{if(img.hidden||stage.matches('.media-expired,.media-unavailable'))return;scale=Math.max(1,Math.min(4,value));if(scale===1){x=0;y=0;}transform();};
    const allowImageActions=allowed=>{
      more.hidden=!allowed;save.disabled=!allowed;
      box.querySelectorAll('.image-zoom-controls button').forEach(button=>button.disabled=!allowed);
    };
    const paint=()=>{
      scale=1;x=0;y=0;hideMenu();stage.classList.remove('media-unavailable');stage.querySelector('.unavailable-viewer-label')?.remove();
      const message=currentMedia(),expired=Boolean(message?.meta?.expired),source=expired?message.meta.thumb:images[index];
      stage.classList.toggle('media-expired',expired);
      // The same image element can keep painting the preceding source while the next one loads.
      const nextImage=document.createElement('img');
      nextImage.alt=alt;nextImage.draggable=false;nextImage.hidden=true;
      img.replaceWith(nextImage);img=nextImage;
      loading.hidden=expired||!source;
      allowImageActions(false);
      const loaded=()=>{
        if(img!==nextImage||!box.isConnected)return;
        nextImage.hidden=false;loading.hidden=true;
        allowImageActions(!expired);
      };
      nextImage.onload=loaded;
      nextImage.onerror=()=>{
        if(img!==nextImage||!box.isConnected||expired)return;
        loading.hidden=true;stage.classList.add('media-unavailable');
        const label=document.createElement('span');label.className='unavailable-viewer-label';label.textContent='图片不可用';stage.append(label);
      };
      let expiryLabel=stage.querySelector('.expired-viewer-label');
      if(expired&&!expiryLabel){expiryLabel=document.createElement('span');expiryLabel.className='expired-viewer-label';expiryLabel.textContent='图片已过期';stage.append(expiryLabel);}
      if(expiryLabel)expiryLabel.hidden=!expired;
      if(source){nextImage.src=source;if(nextImage.complete&&nextImage.naturalWidth)loaded();}
      box.querySelector('.image-counter').textContent=images.length>1?`${index+1} / ${images.length}`:'';
      box.querySelector('[data-image-prev]').disabled=index===0;
      box.querySelector('[data-image-next]').disabled=index===images.length-1;
      const messageId=options.messageIds?.[index];
      forward.hidden=expired||!messageId||!message||message.sender==='system'||message.status!=='sent';
      favorite.hidden=expired||!messageId||!message||message.sender==='system';
      const extMatch=/^data:image\/([^;]+)/.exec(images[index])||/\.([a-z0-9]+)$/i.exec(images[index]);downloadName=`pipi-image-${index+1}.${({png:'png',jpeg:'jpg',jpg:'jpg',webp:'webp',gif:'gif'})[extMatch?.[1]?.toLowerCase()]||'png'}`;
      transform();
    };
    save.onclick=async()=>{if(currentMedia()?.meta?.expired){toast('图片已过期');return;}hideMenu();const data=images[index];let blob;if(data.startsWith('data:')){const comma=data.indexOf(','),binary=atob(data.slice(comma+1)),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);blob=new Blob([bytes],{type:data.slice(5,data.indexOf(';'))});}else{const resp=await window.PipiNetwork.request(data,{credentials:'same-origin',responseType:'blob'});blob=await resp.blob();}const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=downloadName;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    forward.onclick=async()=>{const id=options.messageIds[index];closeModal(false);await afterOverlayBack();await forwardMessages([id]);};
    favorite.onclick=async()=>{if(currentMedia()?.meta?.expired){toast('图片已过期，无法收藏。');return;}hideMenu();try{await act('message.favorite',{id:options.messageIds[index]});toast('已加入收藏');}catch(err){toast(err.message);}};
    const move=step=>{const next=index+step;if(next>=0&&next<images.length){index=next;paint();}};
    box.querySelector('.lightbox-close').onclick=closeModal;box.querySelector('[data-image-prev]').onclick=()=>move(-1);box.querySelector('[data-image-next]').onclick=()=>move(1);box.querySelector('[data-image-in]').onclick=()=>zoom(scale+.5);box.querySelector('[data-image-out]').onclick=()=>zoom(scale-.5);reset.onclick=()=>zoom(1);
    stage.ondblclick=()=>zoom(scale>1?1:2);
    box.onkeydown=event=>{if(event.key==='ArrowLeft'){event.preventDefault();move(-1);}if(event.key==='ArrowRight'){event.preventDefault();move(1);}if(event.key==='+'||event.key==='='){event.preventDefault();zoom(scale+.5);}if(event.key==='-'){event.preventDefault();zoom(scale-.5);}};
    stage.addEventListener('wheel',event=>{event.preventDefault();zoom(scale+(event.deltaY<0?.25:-.25));},{passive:false});
    const distance=()=>{const [a,b]=[...pointers.values()];return Math.hypot(a.x-b.x,a.y-b.y);};
    stage.onpointerdown=event=>{if(event.button!==0)return;stage.setPointerCapture(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(pointers.size===1){startX=event.clientX;startY=event.clientY;startPanX=x;startPanY=y;pinched=false;}else if(pointers.size===2){pinchStart=distance();pinchScale=scale;pinched=true;}};
    stage.onpointermove=event=>{if(!pointers.has(event.pointerId))return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(pointers.size===2){zoom(pinchScale*distance()/pinchStart);}else if(scale>1){x=startPanX+event.clientX-startX;y=startPanY+event.clientY-startY;transform();}};
    stage.onpointerup=event=>{pointers.delete(event.pointerId);if(pointers.size===1){const remaining=[...pointers.values()][0];startX=remaining.x;startY=remaining.y;startPanX=x;startPanY=y;}if(!pointers.size&&!pinched&&scale===1&&Math.abs(event.clientX-startX)>45&&Math.abs(event.clientY-startY)<70)move(event.clientX>startX?-1:1);};
    syncImageViewer=()=>{if(!box.isConnected){syncImageViewer=null;return;}if(box.closest('[inert]'))return;
      if(window.PipiStateSync?.client?.paging?.delta(state)?.deletedIds?.includes(options.messageIds?.[index])){closeModal();return;}
      if(currentMedia()?.meta?.expired&&!stage.classList.contains('media-expired'))paint();};
    stage.onpointercancel=()=>pointers.clear();paint();box.querySelector('.lightbox-close').focus({preventScroll:true});
  }
  async function readImage(file,convertSticker=false,asBlob=false) {
    if(!file)throw new Error('请选择一张图片');
    const inputLimit=convertSticker&&!binaryMedia?20:mediaLimits().imageBytes/1024/1024;
    if(file.size>inputLimit*1024*1024)throw new Error('图片不能超过 '+inputLimit+' MB');
    const mime=await sniffImageMime(file);
    if(mime==='image/svg+xml')throw new Error('不支持 SVG 图片，请换用 PNG、JPG、WebP 或 GIF');
    const native=['image/png','image/jpeg','image/webp','image/gif'].includes(mime);
    if(!native&&!['image/bmp','image/avif','image/heic','image/x-icon','image/tiff'].includes(mime))throw new Error('支持 PNG、JPG、WebP、GIF、BMP、AVIF 等常见图片格式，不支持 SVG');
    let result=file,animated=await detectAnimatedImage(file,mime);
    const animationLimit=mediaLimits().animatedImageBytes/1024/1024;
    if(animated&&file.size>animationLimit*1024*1024)throw new Error('动图不能超过 '+animationLimit+' MB');
    if(animated&&!native)throw new Error('动态 AVIF 暂不支持，请换用 GIF 或动态 WebP');
    if(mime==='image/jpeg'&&file.size>=4){
      const head=new Uint8Array(await file.slice(0,3).arrayBuffer());
      if(head[0]===255&&head[1]===216&&head[2]===255){
        const tail=new Uint8Array(await file.slice(-2).arrayBuffer());
        if(!(tail[0]===255&&tail[1]===217)){
          const trimmed=await repairJpegTrailer(file);
          if(trimmed)result=trimmed;
        }
      }
    }
    if(native&&result===file&&file.type!==mime)result=new Blob([file],{type:mime});
    if(!native||(convertSticker&&!animated)){
      const maxEdge=convertSticker?1024:2048;
      const decoded=await decodeImageSource(result).catch(()=>{
        if(mime==='image/heic')throw new Error('当前浏览器无法直接解析 HEIC/HEIF 照片，请在手机相册转为 JPG/PNG，或在 iPhone「设置 → 相机 → 格式」选「兼容性最佳」后重试');
        throw new Error('无法读取 '+(file.name||'这张图片')+'，请换用 PNG、JPG、WebP 或 GIF');
      });
      try{
        const ratio=Math.min(1,maxEdge/Math.max(decoded.width,decoded.height)),canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(decoded.width*ratio));canvas.height=Math.max(1,Math.round(decoded.height*ratio));
        canvas.getContext('2d').drawImage(decoded.source,0,0,canvas.width,canvas.height);
        const alpha=convertSticker||mime==='image/png'||mime==='image/webp'||mime==='image/x-icon';
        const compressed=await encodeCanvas(canvas,{quality:convertSticker?.9:.92,preferWebp:true,alpha});
        if(!compressed)throw new Error((file.name||'图片')+' 压缩失败，请重新选择图片');
        if(!native||compressed.size<result.size)result=compressed;
      }finally{decoded.close();}
    }
    const outputLimit=(animated?mediaLimits().animatedImageBytes:mediaLimits().imageBytes)/1024/1024;
    if(result.size>outputLimit*1024*1024)throw new Error((animated?'动图':'图片')+'不能超过 '+outputLimit+' MB');
    if(asBlob)return result;
    const source=await readBlobData(result);if(!safeImage(source))throw new Error('图片格式无法读取');return source;
  }
  let cachedWebpEncode;
  function supportsWebpEncode(){
    if(cachedWebpEncode!==undefined)return cachedWebpEncode;
    try{
      const canvas=document.createElement('canvas');
      canvas.width=canvas.height=1;
      cachedWebpEncode=typeof canvas.toDataURL==='function'?canvas.toDataURL('image/webp').startsWith('data:image/webp'):true;
    }catch{cachedWebpEncode=false;}
    return cachedWebpEncode;
  }
  async function encodeCanvas(canvas,{quality=.9,preferWebp=true,alpha=false}={}){
    const mime=preferWebp&&supportsWebpEncode()?'image/webp':alpha?'image/png':'image/jpeg';
    const encode=type=>new Promise(resolve=>canvas.toBlob(resolve,type,quality));
    let blob=await encode(mime);
    if(blob&&mime==='image/webp'&&blob.type&&blob.type!=='image/webp'){
      cachedWebpEncode=false;
      blob=await encode(alpha?'image/png':'image/jpeg');
    }
    return blob;
  }
  async function decodeImageSource(blob){
    if(typeof createImageBitmap==='function'){
      try{
        const bitmap=await createImageBitmap(blob);
        return {source:bitmap,width:bitmap.width,height:bitmap.height,close(){bitmap.close();}};
      }catch{}
    }
    const url=await readBlobData(blob);
    const img=new Image();
    img.src=url;
    await img.decode();
    return {source:img,width:img.naturalWidth||img.width||1,height:img.naturalHeight||img.height||1,close(){}};
  }
  async function sniffImageMime(file){
    const rawType=String(file.type||'').split(';')[0].trim().toLowerCase();
    if(rawType==='image/svg+xml'||rawType==='text/html'||rawType==='application/xhtml+xml')return 'image/svg+xml';
    const header=new Uint8Array(await file.slice(0,64).arrayBuffer());
    const tag=(start,end)=>String.fromCharCode(...header.subarray(start,Math.min(end,header.length)));
    const headText=tag(0,64).replace(/^\uFEFF/,'').trimStart().toLowerCase();
    if(headText.startsWith('<svg')||headText.startsWith('<!doctype')||headText.startsWith('<html')||headText.startsWith('<?xml'))return 'image/svg+xml';
    if(header.length>=24&&tag(0,8)==='\x89PNG\r\n\x1a\n'&&tag(12,16)==='IHDR')return 'image/png';
    if(header.length>=3&&header[0]===255&&header[1]===216&&header[2]===255)return 'image/jpeg';
    if(header.length>=13&&['GIF87a','GIF89a'].includes(tag(0,6)))return 'image/gif';
    if(header.length>=16&&tag(0,4)==='RIFF'&&tag(8,12)==='WEBP')return 'image/webp';
    if(header.length>=2&&tag(0,2)==='BM')return 'image/bmp';
    if(header.length>=4&&header[0]===0&&header[1]===0&&header[2]===1&&header[3]===0)return 'image/x-icon';
    if(header.length>=4&&(tag(0,4)==='II*\x00'||tag(0,4)==='MM\x00*'))return 'image/tiff';
    if(header.length>=12&&tag(4,8)==='ftyp'){
      const boxSize=Math.min(header.length,new DataView(header.buffer,header.byteOffset,header.byteLength).getUint32(0)||header.length);
      let isHeic=false;
      for(let off=8;off+4<=boxSize;off+=4){
        if(off===12)continue;
        const brand=tag(off,off+4);
        if(brand==='avif'||brand==='avis')return 'image/avif';
        if(['heic','heix','hevc','hevx','mif1','msf1'].includes(brand))isHeic=true;
      }
      if(isHeic)return 'image/heic';
    }
    const aliases={'image/jpg':'image/jpeg','image/pjpeg':'image/jpeg','image/x-png':'image/png','image/x-ms-bmp':'image/bmp','image/heif':'image/heic','image/heic-sequence':'image/heic','image/heif-sequence':'image/heic'};
    if(aliases[rawType])return aliases[rawType];
    if(['image/png','image/jpeg','image/webp','image/gif','image/bmp','image/avif','image/heic','image/x-icon','image/tiff'].includes(rawType))return rawType;
    const ext=(String(file.name||'').match(/\.([a-z0-9]+)$/i)||[])[1]?.toLowerCase()||'';
    if(ext==='heic'||ext==='heif')return 'image/heic';
    if(ext==='avif')return 'image/avif';
    if(ext==='bmp')return 'image/bmp';
    if(ext==='svg')return 'image/svg+xml';
    return '';
  }
  async function detectAnimatedImage(file,mime){
    if(mime==='image/gif')return true;
    if(!['image/png','image/webp','image/avif'].includes(mime))return false;
    const bytes=await file.arrayBuffer(),data=new DataView(bytes),tag=at=>String.fromCharCode(...new Uint8Array(bytes,at,4));
    if(mime==='image/avif'){
      if(data.byteLength>=12&&tag(4)==='ftyp'){
        const end=Math.min(data.byteLength,data.getUint32(0)||data.byteLength);
        for(let at=8;at+4<=end;at+=4){if(at!==12&&tag(at)==='avis')return true;}
      }
      return false;
    }
    const webp=mime==='image/webp';
    for(let at=webp?12:8;at+8<=data.byteLength;){
      const chunk=tag(at+(webp?0:4));
      if(webp?(chunk==='ANIM'||chunk==='ANMF'):chunk==='acTL')return true;
      if(!webp&&chunk==='IDAT')return false;
      const size=data.getUint32(at+(webp?4:0),webp);
      at+=size+(webp?8+(size%2):12);
    }
    return false;
  }
  async function repairJpegTrailer(file){
    const bytes=new Uint8Array(await file.arrayBuffer());
    for(let i=bytes.length-2;i>=2;i--){
      if(bytes[i]===255&&bytes[i+1]===217)return new Blob([bytes.subarray(0,i+2)],{type:'image/jpeg'});
    }
    const decoded=await decodeImageSource(new Blob([bytes],{type:'image/jpeg'})).catch(()=>null);
    if(!decoded)return null;
    try{
      const ratio=Math.min(1,2048/Math.max(decoded.width,decoded.height)),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(decoded.width*ratio));canvas.height=Math.max(1,Math.round(decoded.height*ratio));
      canvas.getContext('2d').drawImage(decoded.source,0,0,canvas.width,canvas.height);
      return await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));
    }finally{decoded.close();}
  }
  const profileImageAccept='image/*';
  async function readProfileImage(file,asBlob=false){
    if(file&&file.size>mediaLimits().profileImageBytes)throw new Error('头像和背景图不能超过 '+mediaLimits().profileImageBytes/1024/1024+' MB');
    const blob=await readImage(file,false,true);
    const decoded=await decodeImageSource(blob).catch(()=>{throw new Error('无法读取这张图片，请重新选图');});
    decoded.close();
    if(asBlob)return blob;
    const source=await readBlobData(blob);
    if(!safeImage(source))throw new Error('图片格式无法读取');
    return source;
  }
  async function uploadStickers(files,origin,epoch){
    if(!files.length)return;
    if(stickerUploadEpoch===epoch){toast('正在添加表情，请稍候',true);return;}
    const before=new Set((state.stickers||[]).map(s=>s.id)),remaining=Math.max(0,200-before.size);
    stickerUploadEpoch=epoch;
    try{
      const images=[];
      for(const item of files){
        if(authEpoch!==epoch)return;
        images.push(await uploadImage(item,true));
      }
      if(authEpoch!==epoch)return;
      // Pictures already in the library are skipped by the server and do not use up the 200 places.
      const fresh=new Set(images.filter(image=>!(state.stickers||[]).some(s=>s.image===image))).size;
      if(fresh>remaining&&!(state.stickers||[]).some(sticker=>sticker.image.startsWith('data:'))){toast(`表情库最多 200 张，还能添加 ${remaining} 张，这次选了 ${fresh} 张新表情`);return;}
      await act('sticker.add',{images,names:files.map(item=>item.name.replace(/\.[^.]+$/,'').slice(0,100))});
      const added=(state.stickers||[]).filter(s=>!before.has(s.id)).length;
      if(route===origin){if(route.name==='stickers')refresh();else if(route.name==='chat')updateComposer();}
      toast(added?added<files.length?`已添加 ${added} 个表情，${files.length-added} 个重复未添加`:`已添加 ${added} 个表情`:'所选表情已在表情库中，未重复添加');
    }catch(err){if(authEpoch===epoch)toast(err.message);}
    finally{if(stickerUploadEpoch===epoch)stickerUploadEpoch=-1;}
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
    if(session.objectUrl){try{URL.revokeObjectURL(session.objectUrl);}catch{}session.objectUrl='';}
    paintSpeech(session.id);
  }
  async function startSpeechAudio(session){
    if(!safeAudio(session.data)){stopSpeech();toast('没有可播放的安全音频');return;}
    const audio=session.audio??(session.audio=new Audio(session.data));
    if(!audio.isConnected){audio.hidden=true;document.body.append(audio);}
    const tryBlobFallback=async()=>{
      if(speechSession!==session||session.blobTried||!String(session.data||'').trim().startsWith('/api/media/'))return false;
      session.blobTried=true;
      try{
        const res=await window.PipiNetwork.request(session.data.trim(),{credentials:'same-origin',responseType:'blob'});
        if(!res.ok||speechSession!==session)return false;
        const blob=await res.blob();
        if(speechSession!==session)return false;
        session.objectUrl=URL.createObjectURL(blob);
        audio.src=session.objectUrl;
        await audio.play();
        return true;
      }catch{return false;}
    };
    audio.onended=()=>{if(speechSession===session)stopSpeech();};
    audio.onplaying=()=>{if(speechSession===session){session.phase='playing';paintSpeech(session.id);}};
    audio.onerror=async()=>{
      if(speechSession!==session)return;
      if(await tryBlobFallback())return;
      if(speechSession===session){stopSpeech();toast('这条音频无法解码，可能已损坏或格式不受支持');}
    };
    try{await audio.play();}
    catch(error){
      if(speechSession!==session)return;
      if(error.name==='NotAllowedError'&&!session.voice){session.phase='ready';paintSpeech(session.id);return;}
      if(error.name!=='NotAllowedError'&&await tryBlobFallback())return;
      if(speechSession===session){stopSpeech();toast(error.name==='NotAllowedError'?'浏览器阻止了播放，请允许此网页播放声音':'音频播放失败，请重试');}
    }
  }
  async function speakMessage(id) {
    const m=state.messages?.find(x=>x.id===id);if(!m)return;
    if(m.meta?.expired?.kind==='voice'){toast('语音已过期，可以查看或复制原文字。');return;}
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
  function playAudio(data,id,getSource) {
    if(id&&state.messages.find(message=>message.id===id)?.meta?.expired){toast('语音已过期');return;}
    if(!safeAudio(data)){toast('这条语音没有可播放的音频');return;}
    if(speechSession?.voice&&speechSession.id===id&&speechSession.data===data){stopSpeech();return;}
    stopSpeech();
    const session={id,data,voice:true,getSource};speechSession=session;
    return startSpeechAudio(session);
  }
  function syncDictationState(){
    const session=recordingSession?.mode==='dictation'?recordingSession:null,phase=session?.phase||'',button=view.querySelector('.compose-dictation'),status=view.querySelector('.dictation-status');
    const hold=view.querySelector('[data-record]');
    if(hold){
      hold.disabled=!!((recordingSession&&recordingSession.mode!=='hold'));
      hold.classList.toggle('recording',recordingSession?.mode==='hold'&&recordingSession.phase==='recording');
      hold.textContent=recordingSession?.mode==='voice'?'正在发送…':recordingSession?.mode==='text'?'正在转文字…':'按住 说话';
    }
    if(button){button.classList.toggle('recording',phase==='recording');button.classList.toggle('transcribing',!!dictationBusy);button.classList.toggle('requesting',phase==='requesting');button.setAttribute('aria-pressed',String(phase==='recording'));button.disabled=!!(dictationBusy);button.setAttribute('aria-label',phase==='recording'?'停止录音并转换为文字':phase==='requesting'?'取消语音输入':dictationBusy?'正在转换为文字':'语音转文字');}
    if(status){status.hidden=!session;const text=status.querySelector('span');if(text)text.textContent=phase==='requesting'?'正在请求麦克风…':phase==='recording'?'正在听，点完成转换为文字':phase==='awaiting-composition'?'识别完成，结束文字输入后加入草稿':'正在转换为文字…';status.querySelector('[data-action=finish-dictation]').disabled=phase!=='recording';}
  }
  function releaseMicrophone(session){
    clearTimeout(session.timer);
    session.stream?.getTracks().forEach(track=>track.stop());
    session.stream=null;
    if(session.volumeContext){session.volumeContext.close?.().catch(()=>{});session.volumeContext=null;}
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
    if(!chunks.length){toast('没有录到声音，请按住稍久一点再试');releaseRecordingSession(session);return;}
    if(durationMs<500){toast('说话时间太短');releaseRecordingSession(session);return;}
    const mime=String(session.recorder?.mimeType||chunks[0]?.type||'').split(';')[0].trim();
    const blob=new Blob(chunks,mime?{type:mime}:undefined);
    if(blob.size>8*1024*1024){toast('录音过大，请缩短后重试');releaseRecordingSession(session);return;}
    session.phase=session.mode==='voice'?'sending':'transcribing';dictationBusy=session.mode==='dictation';
    syncComposerControls();
    try{
      const wav=await window.PipiAudio.recordingWav(blob);
      if(wav.size>8*1024*1024)throw new Error('录音过大，请缩短后重试');
      if(session.cancelled||recordingSession!==session)return;
      const audio=await uploadMedia(wav);
      if(session.cancelled||recordingSession!==session)return;
      if(!session.requestId)session.requestId=crypto.randomUUID();
      const body={roleId:session.roleId,requestId:session.requestId,quoteId:quotedMessage(session.quoteId,session.roleId)?.id};
      if(session.mode==='voice'){Object.assign(body,{audio,durationMs});}
      else{
        const result=await api('/api/voice/transcribe',{audio,roleId:session.roleId});
        if(session.cancelled||recordingSession!==session)return;
        const text=String(result.text||'').trim();
        if(!text){toast('没有识别到文字，请重试');return;}
        if(session.mode==='dictation'){session.transcript=text;applyDictationTranscript(session);return;}
        body.text=text;
      }
      body.quoteId=quotedMessage(session.quoteId,session.roleId)?.id;
      window.PipiEngine?.resetActivity(session.roleId);
      const result=await api(session.mode==='voice'?'/api/chat/send':'/api/chat',body);
      if(recordingSession===session&&route.name==='chat'&&route.arg===session.roleId){
        if(!composeText&&!composeImage&&quoteId===session.quoteId)quoteId='';
        forceBottomRole=session.roleId;
      }
      receiveState(result.state);
      if(result.notice&&recordingSession===session)toast(result.notice);
    }catch(err){if(!session.cancelled&&recordingSession===session){toast((err&&err.message)||'录音处理失败，请重试');if(err?.state)receiveState(err.state);}}
    finally{
      if(recordingSession===session&&session.phase!=='awaiting-composition'){
        releaseRecordingSession(session);
        if(session.mode!=='dictation'&&route.name==='chat'&&route.arg===session.roleId)refresh();
      }
    }
  }
  function androidVoiceRecorder(token){
    const command=action=>window.prompt('pipi-recording:'+token,action);
    return {
      state:'inactive',mimeType:'audio/wav',
      start(){
        const reply=command('start');
        if(reply==='permission')return false;
        if(reply!=='ok')throw new Error(reply||'录音已取消');
        this.state='recording';
        return true;
      },
      stop(){
        this.state='inactive';
        if(!this.onstop){command('cancel');return;}
        const reply=command('finish');
        if(reply?.startsWith('url:')){
          const mediaUrl=reply.slice(4);
          window.PipiNetwork.request(mediaUrl,{credentials:'same-origin',responseType:'blob'}).then(r=>{
            if(!r.ok)throw new Error('录音读取失败');
            return r.blob();
          }).then(blob=>{
            this.mimeType=blob.type||'audio/wav';
            this.ondataavailable?.({data:blob});
            this.onstop?.();
          }).catch(()=>this.onerror?.());
          return;
        }
        if(reply?.startsWith('wav:')){
          this.mimeType='audio/wav';
          const bytes=Uint8Array.from(atob(reply.slice(4)),c=>c.charCodeAt(0));
          this.ondataavailable?.({data:new Blob([bytes],{type:'audio/wav'})});
          this.onstop?.();
          return;
        }
        if(!reply?.startsWith('audio:')){this.onerror?.();return;}
        this.mimeType='audio/mp4';
        const bytes=Uint8Array.from(atob(reply.slice(6)),c=>c.charCodeAt(0));
        this.ondataavailable?.({data:new Blob([bytes],{type:'audio/mp4'})});
        this.onstop?.();
      },
    };
  }
  window.addEventListener('pipi-recording-interrupted',()=>{
    if(recordingSession){stopRecording(true);toast('录音中断，请重新按住说话');}
  });
  async function startRecording(mode,hold) {
    if(recordingSession||dictationBusy)return;
    const nativeToken=document.querySelector('meta[name="pipi-recording"]')?.content;
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    const canWebRecord=Boolean(navigator.mediaDevices?.getUserMedia&&(window.MediaRecorder||AudioCtx));
    if(!nativeToken&&!canWebRecord){
      toast(window.isSecureContext===false?'这个网址无法使用麦克风，请用 HTTPS 网址再试。':'当前设备暂时无法录音，你仍然可以发文字和图片。');
      return;
    }
    if(mode==='dictation'&&!window.PipiEngine?.serviceReady('stt')){toast('请先在模型设置中选择录音转文字模型');return;}
    const input=view.querySelector('#compose-text');if(input){composerSelection=readComposerSelection(input);}
    // Create AudioContext synchronously inside user gesture so iOS Safari unlocks WebAudio cleanly.
    let gestureCtx=null;
    if(!nativeToken&&AudioCtx){
      try{gestureCtx=new AudioCtx();if(gestureCtx.state==='suspended')gestureCtx.resume?.().catch(()=>{});}catch{gestureCtx=null;}
    }
    const session={mode,hold,roleId:route.arg,quoteId:quotedMessage(quoteId)?.id||'',phase:'requesting',cancelled:false,chunks:[],volumeContext:gestureCtx};
    recordingSession=session;syncComposerControls();
    hold?.signal.addEventListener('abort',()=>{if(recordingSession===session)stopRecording(true);},{once:true});
    try{
      const isIOSWebKit=/iP(?:hone|ad|od)|Macintosh/i.test(navigator.userAgent)&&('ontouchend' in document)||/AppleWebKit/i.test(navigator.userAgent)&&!/Chrome|Chromium|Edg|Firefox/i.test(navigator.userAgent);
      let usePcmDirect=false;
      if(nativeToken){
        // Yield once so pointerdown finishes and ACKs mobile touch before synchronous native bridge runs.
        await new Promise(resolve=>setTimeout(resolve,0));
        if(session.cancelled||recordingSession!==session||route.name!=='chat'||route.arg!==session.roleId||document.hidden){releaseRecordingSession(session);return;}
        session.recorder=androidVoiceRecorder(nativeToken);
      }else{
        session.stream=await navigator.mediaDevices.getUserMedia({audio:true});
        if(session.cancelled||recordingSession!==session||route.name!=='chat'||route.arg!==session.roleId||document.hidden){releaseRecordingSession(session);return;}
        if((isIOSWebKit||!window.MediaRecorder)&&window.PipiAudio?.createPcmRecorder&&AudioCtx){
          usePcmDirect=true;
          session.recorder=window.PipiAudio.createPcmRecorder(session.stream,gestureCtx);
        }else{
          const canCheck=typeof MediaRecorder.isTypeSupported==='function';
          const mime=canCheck?['audio/webm;codecs=opus','audio/mp4;codecs=mp4a.40.2','audio/mp4','audio/webm','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t)):'';
          session.recorder=new MediaRecorder(session.stream,mime?{mimeType:mime}:undefined);
        }
      }
      session.recorder.ondataavailable=event=>{if(!session.cancelled&&event?.data?.size)session.chunks.push(event.data);};
      session.recorder.onerror=()=>{if(recordingSession===session){stopRecording(true);toast('录音中断，请重新按住说话');}};
      session.recorder.onstop=()=>{
        releaseMicrophone(session);
        if(recordingSession!==session||session.cancelled)return;
        if(session.durationMs==null)session.durationMs=Math.min(60000,Date.now()-session.startedAt);
        session.phase='recorded';
        if(session.mode==='hold')session.hold.capped();else void finishRecording(session);
      };
      const started=nativeToken||usePcmDirect?session.recorder.start():session.recorder.start(250);
      if(started===false){releaseRecordingSession(session);if(hold)toast('第一次录音，请松手后允许使用麦克风');return;}
      session.startedAt=Date.now();session.phase='recording';
      session.timer=setTimeout(()=>{if(recordingSession===session)stopRecording(false);},60000);
      syncComposerControls();
      if(!hold)return;
      let level;
      if(usePcmDirect&&typeof session.recorder.level==='function'){
        level=session.recorder.level;
      }else if(session.stream&&!isIOSWebKit&&AudioCtx){
        try{
          const context=gestureCtx&&gestureCtx.state!=='closed'?gestureCtx:new AudioCtx(),analyser=context.createAnalyser();
          session.volumeContext=context;analyser.fftSize=512;
          context.createMediaStreamSource(session.stream).connect(analyser);
          const samples=new Uint8Array(analyser.fftSize);
          level=()=>{
            if(!session.volumeContext)return 0;
            analyser.getByteTimeDomainData(samples);
            let power=0;for(let i=0;i<samples.length;i++){const v=(samples[i]-128)/128;power+=v*v;}
            return Math.min(1,Math.sqrt(power/samples.length)*6);
          };
        }catch{level=undefined;}
      }
      return {level,stop(choice){
        if(recordingSession!==session)return;
        if(!window.PipiEngine?.serviceReady(choice==='text'?'stt':'voiceUnderstanding')){
          stopRecording(true);toast(choice==='text'?'请先在模型设置中选择录音转文字模型':'请先在模型设置中选择语音条理解模型');return;
        }
        session.mode=choice;
        if(session.phase==='recorded')void finishRecording(session);else stopRecording(false);
      }};
    }catch(err){
      const errName=err&&err.name,errMsg=(err&&err.message)||'请检查麦克风权限后重试';
      const permError=['NotAllowedError','PermissionDeniedError','NotFoundError','NotReadableError'].includes(errName);
      if((recordingSession===session&&!session.cancelled)||permError){
        if(recordingSession===session)releaseRecordingSession(session);
        else releaseMicrophone(session);
        toast(errName==='NotAllowedError'||errName==='PermissionDeniedError'
          ?(/\bPipiPhoneAndroid\//.test(navigator.userAgent)?'麦克风权限未开启，请在系统设置中允许小手机录音':'麦克风权限未开启，请在浏览器设置中允许录音')
          :errName==='NotFoundError'?'没有检测到可用的麦克风'
          :errName==='NotReadableError'?'麦克风正被其他应用占用，请稍后再试'
          :'无法开始录音：'+errMsg);
      }else{
        releaseMicrophone(session);
      }
    }
  }
  function stopRecording(cancel=false) {
    const session=recordingSession;
    if(!session)return;
    if(cancel||session.phase==='requesting'){
      session.cancelled=true;session.chunks=[];
      if(session.recorder&&session.recorder.state!=='inactive'){
        session.recorder.ondataavailable=null;session.recorder.onstop=null;
        try{session.recorder.stop();}catch{}
      }
      releaseRecordingSession(session);
    }else if(session.recorder&&session.recorder.state!=='inactive'){
      session.durationMs=Math.min(60000,Date.now()-session.startedAt);
      if(session.durationMs<500){
        session.cancelled=true;session.chunks=[];
        session.recorder.ondataavailable=null;session.recorder.onstop=null;
        try{session.recorder.stop();}catch{}
        releaseRecordingSession(session);
        toast('说话时间太短');
        return;
      }
      session.phase='stopping';if(session.mode==='dictation')dictationBusy=true;
      try{session.recorder.stop();syncComposerControls();}
      catch{releaseRecordingSession(session);toast('录音中断，请重新按住说话');}
    }
  }
  function avatarForm(entity) {
    avatarDraft=safeImage(entity?.avatar)?entity.avatar:'';
    return `<div class="avatar-picker"><button type="button" id="pick-avatar" aria-label="上传头像">${avatar({...entity,avatar:avatarDraft},72)}</button><small>点击上传头像</small><input type="file" id="avatar-file" accept="${profileImageAccept}" hidden>${avatarDraft?'<button type="button" id="remove-avatar" class="text-btn">移除头像</button>':''}</div>`;
  }
  function bindProfileImage(pick,file,label,render,cropOptions){
    const form=file.form,submit=form.querySelector('.modal-submit');
    pick.onclick=()=>file.click();
    file.onchange=async()=>{
      if(!file.files.length)return;
      const chosen=file.files[0];
      file.disabled=pick.disabled=submit.disabled=true;
      try{
        const cropper=cropOptions&&typeof window!=='undefined'&&window.PipiLifeCrop;
        let image;
        if(cropper){
          const isCurrent=()=>file.isConnected&&!file.closest?.('[inert]');
          const cropped=await cropper.pick(chosen,cropOptions.key,{isCurrent,parent:form.closest?.('.page-editor,.modal-sheet')||undefined,cardGuide:cropOptions.cardGuide!==false});
          image=cropped&&isCurrent()?await uploadImageData(cropped):null;
        }else{
          image=await uploadProfileImage(chosen);
        }
        if(image&&file.isConnected){render(image);form.querySelector('.modal-error').textContent='';}
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
    renderDraft(avatarDraft);bindProfileImage(pick,file,'头像',renderDraft,{key:'avatar'});
  }
  function editProfile() {
    const profile=state.profile||{};
    const html=avatarForm(profile)+field('名字','name',profile.name,'怎么称呼你')+field('微信号','wechatId',profile.wechatId,'设置一个个人标识')+field('个性签名','bio',profile.bio,'写一点此刻的心情','textarea')+field('地区','region',profile.region,'例如 中国 · 杭州');
    openModal('个人资料',html,async form=>{
      const values=formValues(form);
      if(!values.name.trim())throw new Error('请填写名字');
      checkWechatId(values.wechatId,profile.wechatId);
      const changes=changedFields(original,{...values,avatar:avatarDraft});
      if(Object.keys(changes).length)await act('profile.save',changes);
      if(form.isConnected){closeModal();refresh();}
      toast('个人资料已保存');
    });
    const original={...formValues(overlay.querySelector('.modal-form')),avatar:avatarDraft};
    bindAvatar(profile);
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
    const html=avatarForm(r)+(id?'':'<label class="form-field check-row switch-row"><span class="field-label">自动发朋友圈</span><input type="checkbox" name="momentsAutoEnabled"></label>')+field('名字','name',r.name,'给这位朋友起个名字')+field('备注','remark',r.remark,'备注只显示在你的通讯录里')+field('微信号','wechatId',r.wechatId,'为角色设置一个标识')+field('个性签名','bio',r.bio,'TA 的一句话介绍','textarea')+field('拍一拍','patText',r.patText||'','填写拍了拍后面的内容')+'<span class="rp-pat-preview" id="role-pat-preview"></span>'+`<div class="form-field role-cover-picker"><span class="field-label">朋友圈背景图</span><button type="button" id="pick-role-cover" aria-label="上传朋友圈背景图">${cover?`<img src="${esc(cover)}" alt="朋友圈背景图预览">`:'<span>点击上传朋友圈背景图</span>'}</button><input type="hidden" name="cover" value="${esc(cover)}"><input type="file" id="role-cover-file" accept="${profileImageAccept}" hidden></div>`;
    openModal(id?'编辑角色资料':'添加新的朋友',html,async form=>{
      const values=formValues(form);if(!values.name.trim())throw new Error('请填写角色名字');
      checkWechatId(values.wechatId,r.wechatId);
      const draft={...values,avatar:avatarDraft};
      if(id){
        const changes=changedFields(original,draft);
        if(Object.keys(changes).length)await act('role.save',{id,...changes});
      }else await act('role.save',{...draft,momentsAutoEnabled:form.elements.momentsAutoEnabled.checked});
      if(!form.isConnected){toast('角色资料已保存');return;}closeModal();
      if(!id&&route.name!=='new-friends')showView('new-friends');else refresh();toast('角色资料已保存');
    },'保存');
    const original={...formValues(overlay.querySelector('.modal-form')),avatar:avatarDraft};
    bindAvatar(r);
    const pat=overlay.querySelector('[name=patText]'),patPreview=overlay.querySelector('#role-pat-preview'),roleNameInput=overlay.querySelector('[name=name]');pat.maxLength=100;const previewPat=()=>{patPreview.textContent='我拍了拍“'+(overlay.querySelector('[name=remark]').value||roleNameInput.value||'朋友')+'”'+(pat.value?'的'+pat.value:'');};pat.oninput=previewPat;roleNameInput.oninput=previewPat;overlay.querySelector('[name=remark]').oninput=previewPat;previewPat();
    const pick=overlay.querySelector('#pick-role-cover'),file=overlay.querySelector('#role-cover-file'),value=overlay.querySelector('[name=cover]');
    bindProfileImage(pick,file,'朋友圈背景图',image=>{value.value=image;pick.innerHTML=`<img src="${esc(image)}" alt="朋友圈背景图预览">`;},{key:'cover',cardGuide:true});
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
    const html=`<label class="form-field check-row switch-row"><span class="field-label">启用语音</span><input type="checkbox" name="voiceEnabled" ${available&&enabled?'checked':''} ${available?'':'disabled'}></label>${hint?`<p class="page-note">${esc(hint)}</p>`:''}<fieldset id="role-voice-controls" ${available&&enabled?'':'disabled'}><div class="form-field"><span class="field-label">从音色库选一个声音</span><button type="button" class="secondary-btn" id="role-voice-refresh">刷新音色</button><select id="role-voice-picker"><option value="">点击刷新读取已配置账号的音色</option></select></div>`+field('专属音色 ID（留空跟随全局）','voiceId',r.voiceId||'','例如 voice_id')+'</fieldset>';
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
    const html=`<label class="form-field check-row switch-row"><span class="field-label">允许 TA 平时主动联系我</span><input type="checkbox" name="outreachEnabled" ${r.outreachEnabled?'checked':''}></label><label class="form-field check-row switch-row"><span class="field-label">允许 TA 每天按作息发朋友圈</span><input type="checkbox" name="momentsAutoEnabled" ${r.momentsAutoEnabled!==false?'checked':''}></label>`+field('免打扰开始时间','quietStart',r.quietStart||'01:00','HH:mm')+field('免打扰结束时间','quietEnd',r.quietEnd||'07:00','HH:mm')+`<details class="engine-details" style="margin-top:8px"><summary>联系节奏微调（一般保持默认即可）</summary>`+field('聊天停下后至少等多久再找你（分钟）','proactiveMinutes',String(r.proactiveMinutes||60),'默认 60 分钟','number')+'</details>';
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
      {label:'清空聊天记录',icon:icons.trash,danger:true,run:()=>confirmDialog('清空聊天记录？',`将删除与 ${roleName(r)} 的全部消息，保留角色资料与共同记忆。未领取的红包和转账会自动退回，款项记录保留在零钱明细里。`,()=>act('conversation.clear',{roleId:r.id}),'清空记录')},
      {label:'删除联系人',danger:true,run:()=>confirmDialog('删除这位联系人？',`将删除与 ${roleName(r)} 的聊天记录、共同记忆、TA 的朋友圈和点赞评论、农场记录及提醒。转账和红包记录保留在零钱明细里，未领取的款项会自动退回，收藏保留快照。`,async isCurrent=>{await act('role.delete',{id:r.id});if(isCurrent())showView('contacts');},'删除联系人')}
    ]);
  }
  function downloadBackup() {
    openModal('导出备份',`<label class="check-row switch-row"><span class="field-label">包含 API 密钥</span><input type="checkbox" name="includeModelKeys" checked></label><p class="page-note">包含密钥的备份不要发给别人或传到公开的地方</p>${streamingBackup?'<label class="check-row switch-row"><span class="field-label">包含图片和语音</span><input type="checkbox" name="includeMedia" checked></label><p class="page-note">不勾选时只备份文字，原有媒体引用仍会保留。</p>':''}`,async form=>{
      const includeKeys=form.elements.includeModelKeys.checked;
      if(streamingBackup){
        const result=await api('/api/backup/prepare',{includeKeys,includeMedia:form.elements.includeMedia.checked});if(!form.isConnected)return;
        const link=document.createElement('a');link.href='/api/backup/download?token='+encodeURIComponent(result.token);link.download=result.filename;document.body.append(link);link.click();link.remove();closeModal(false);toast('备份已开始下载，请在浏览器下载列表查看进度');return;
      }
      const result=await api('/api/backup',{includeModelKeys:includeKeys});
      if(!form.isConnected)return;
      const hasKeys=result.modelKeys?.length>0;
      const blob=new Blob([JSON.stringify(result)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;
      link.download=`pipi-phone-backup-${new Date().toISOString().slice(0,10)}${hasKeys?'-with-model-keys':''}.json`;
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      closeModal(false);toast('备份已开始下载');
    },'下载',undefined,'cancel',{lockWhileSaving:true});
    overlay.querySelector(':scope > .page-editor').classList.add('model-sheet');
  }
  function pickBackup() {
    const input=document.createElement('input');input.type='file';input.accept=streamingBackup?'.tar,.json,application/x-tar,application/json':'.json,application/json';
    input.onchange=async()=>{
      const file=input.files?.[0];if(!file)return;const tar=file.name.toLowerCase().endsWith('.tar');if(tar&&!streamingBackup){toast('请先升级小手机服务，再恢复 .tar 备份');return;}if(!tar&&file.size>88*1024*1024){toast('旧格式 JSON 备份不能超过 88 MB');return;}
      try{
        const backup=tar?null:JSON.parse(await file.text());
        const hasKeys=Array.isArray(backup?.modelKeys)&&backup.modelKeys.length>0;
        const keyNote=tar?'备份中的模型密钥会按服务商地址恢复。未包含在备份中的聊天图片和语音会显示已过期，其他缺失媒体会显示不可用。':hasKeys?'这份备份包含模型 API Key，会按服务商地址恢复。':'这份备份未包含模型 API Key。相同服务商地址的现有密钥可继续使用。';
        openModal('恢复这份备份？',`<div class="inline-note" style="margin:12px 0">文件：${esc(file.name)}<br>恢复会覆盖当前业务资料，保留登录密码。${keyNote}</div><label class="check-row"><input type="checkbox" name="confirmed" required>我已导出需要保留的数据，确认恢复</label>`,async form=>{
          if(!form.elements.confirmed.checked)throw new Error('请先勾选确认');
          const result=tar?await apiRaw('/api/restore/tar',file):await api('/api/restore',{backup,confirm:true});
          window.PipiChatNotice?.rebase(result.state);
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
    window.PipiChatNotice?.clear();
    if(!connectionError)window.PipiAndroidPage?.clearSession();
    window.PipiSkins.configure(null);
    window.PipiHistorySearch.reset();
    stopSpeech();authSetup=setup;authEpoch++;state=null;window.PipiEngine?.stop();
    window.PipiAccount?.reset();window.PipiStorage?.reset();
    profileAvatarImages.clear();previewWarmups.clear();chatImageSizes.clear();chatPreviewStatus.clear();
    chatHistoryWindows.clear();chatPageTask=null;chatJump=null;
    clearTimeout(emojiRecentTimer);queuedEmojiRecents=[];emojiRecentsSaving=false;
    systemFilePicker?.remove();systemFilePicker=null;
    view.dataset.route='auth';
    const footer=(setup
      ? '<div>一个账号 · 一部独立小手机</div><div>请保存好密码，当前版本不提供邮箱找回</div>'
      : '<div>你的数据保存在当前服务器</div><div>密码仅用于访问这部小手机</div>')
      + '<div>屁屁机为开源 · 非售卖小手机</div>';
    view.innerHTML=`<div class="auth-content${setup?' is-setup':''}"><div class="auth-logo">${icons.chat}</div><h1${setup?' tabindex="-1"':''}>屁屁机</h1>${setup?'':'<p class="auth-subtitle">熟悉的人和日常，都在这里等你。</p>'}${connectionError?`<div class="inline-note">${esc(connectionError)}</div><button class="primary-btn weui-btn weui-btn_primary" id="retry-boot">重新连接</button>`:`<form id="auth-form">${setup?field('你的名字','displayName','','怎么称呼你'):''}${field(setup?'设置访问密码':'访问密码','password','',setup?'至少 8 个字符':'','password')}${setup?field('再次输入密码','confirmPassword','','再输入一次','password')+(setupTokenRequired?field('设置令牌','setupToken','','请输入服务器提供的设置令牌','password'):''):''}<div class="auth-error" role="alert"></div><button type="submit" class="primary-btn weui-btn weui-btn_primary">${setup?'开启我的小手机':'进入小手机'}</button></form>`}<footer class="auth-bottom">${footer}</footer></div>`;
    view.querySelector('#retry-boot')?.addEventListener('click',boot);
    const form=view.querySelector('#auth-form');if(!form)return;
    form.querySelector('[name=password]').autocomplete=setup?'new-password':'current-password';if(setup&&setupTokenRequired)form.querySelector('[name=setupToken]').required=true;
    let retryUntil=0;
    const updateRetry=()=>{
      if(!form.isConnected)return;
      const remaining=Math.max(0,Math.ceil((retryUntil-Date.now())/1000)),button=form.querySelector('[type=submit]');
      button.disabled=remaining>0;button.textContent=remaining?`${remaining} 秒后重试`:setup?'开启我的小手机':'进入小手机';
      if(remaining){form.querySelector('.auth-error').textContent=`请求过多，请 ${remaining} 秒后重试`;setTimeout(updateRetry,1000);}
      else if(retryUntil)form.querySelector('.auth-error').textContent='现在可以重新输入密码';
    };
    form.onsubmit=async event=>{
      event.preventDefault();const values=formValues(form),button=form.querySelector('[type=submit]'),error=form.querySelector('.auth-error');if(button.disabled)return;
      if(!values.password||(setup&&values.password.length<8)){error.textContent=setup?'请设置至少 8 个字符的密码':'请输入访问密码';return;}
      if(setup&&values.password!==values.confirmPassword){error.textContent='两次输入的密码不一致';return;}
      retryUntil=0;
      button.disabled=true;error.textContent='';button.textContent='正在进入…';
      try{const result=await api(setup?'/api/setup':'/api/login',{password:values.password,...(setup?{displayName:values.displayName,setupToken:values.setupToken}:{})});window.PipiAndroidPage?.beginSession(result.appSessionScope);window.PipiSkins.configure(result.appearance);setState(result.state);if(!state){const next=await api('/api/state');setState(next.state||next);}restoreChatDrafts();showView(initialView);window.PipiAndroidPage?.ready();}
      catch(err){error.textContent=err.message;if(err.retryAfter)retryUntil=Date.now()+err.retryAfter*1000;}
      finally{updateRetry();}
    };
    if(setup)window.PipiFirstUseNotice?.show(view);
  }
  async function boot() {
    if(boot.running)return;
    boot.running=true;
    if(window.PipiAndroidPage?.showOffline('',true)){authEpoch++;window.PipiEngine?.stop();state=null;}
    try{
      const status=await api('/api/status');
      await window.PipiClientProtocol?.validate(status);
      window.PipiHistorySearch.configure(status);
      globalThis.window?.PipiStateSync?.configure(status,{request:(path,options)=>api(path,undefined,'GET',true,options),getEpoch:()=>authEpoch});
      sourceUrl=status.sourceUrl;binaryMedia=status.binaryMedia===true;configureMediaLimits(status);imageVariants=binaryMedia&&status.imageVariants===true;storageMaintenance=status.storageMaintenance===true;streamingBackup=status.streamingBackup===true;accountSecurity=status.accountSecurity===true;setupTokenRequired=status.setupTokenRequired===true;momentExclusions=status.momentExclusions===true;window.PipiMessageLimit?.configure(status.messageLimit);rolePanelAvailable=status.rolePanel===true;globalThis.__pipiVersion=status.version;globalThis.__pipiUpdatesEnabled=status.softwareUpdates===true;
      if(status.authenticated){window.PipiAndroidPage?.beginSession(status.appSessionScope);window.PipiSkins.configure(status.appearance);const result=await api('/api/state');setState(result.state||result);await restoreBrowserPage();}else renderAuth(status.setupRequired);
    }
    catch(err){if(!window.PipiAndroidPage?.showOffline(err.message))renderAuth(false,`暂时无法连接这部小手机。${err.message}`);}
    finally{boot.running=false;}
  }
  function openIncomingChat(roleId) {
    if(!roleById(roleId))return false;
    if(modalSaveInProgress||overlay.querySelector('.modal-form .modal-body[inert],[aria-busy=true]')||view.querySelector('.inline-provider-fields:disabled,form[inert],[aria-busy=true]')){toast('正在保存，请完成后再打开消息');return false;}
    if(recordingSession||dictationBusy){toast('请先完成或取消录音，再打开消息');return false;}
    const root=modalOpen?overlay:route.name==='chat'?null:view;
    const controls=root?[...root.querySelectorAll('input:not([type=hidden]):not([type=search]):not([type=file]):not([readonly]):not(:disabled),textarea:not([readonly]):not(:disabled),select:not(:disabled),[contenteditable=true]:not([aria-readonly=true])')]:[];
    if(modalOpen&&overlay.querySelector('.modal-form [type=submit]')||controls.some(control=>control.getClientRects().length&&!control.closest('.search-box,.search-bar')&&(control.closest('form')?.querySelector('[type=submit]')||control.closest('[data-life-root]')&&view.querySelector('[data-life-action=saveAll]')))){toast('请先保存或取消当前编辑，再打开消息');return false;}
    showView('chat',roleId);return true;
  }
  window.PipiChatNotice?.connect({
    visibleChat:roleId=>route.name==='chat'&&route.arg===roleId&&!modalOpen&&!childDialog,
    openChat:openIncomingChat
  });
  window.PipiExpiry={sync:syncExpiredMedia};
  window.Pipi={mediaLimits,flushPendingRender:flushRender,getState:()=>state,supportsMomentExclusions:()=>momentExclusions,api,apiRaw,act,receiveState,updateTyping,syncChatProgress,readImage,readProfileImage,sniffImageMime,detectAnimatedImage,decodeImageSource,encodeCanvas,supportsWebpEncode,readBlobData,uploadMedia,uploadImage,uploadImageData,uploadProfileImage,showView,goBack,afterOverlayBack,jumpToMessage,openChatMessage:jumpToMessage,preserveChatLayout:callback=>{const snapshot=captureChatLayout();callback();restoreChatLayout(snapshot);},scrollChatToBottom:(roleId)=>{forceBottomRole=roleId;chatScrolls.delete(roleId);if(route.name==='chat'&&route.arg===roleId)scrollChat();},openModal,closeModal,openPage,openNestedPage,openChildDialog,closeChildDialog,closePage:closeModal,openPhoto:lightbox,actionSheet,confirmDialog,toast,esc,avatar,icons,refresh,setState,registerRoute:(name,renderer)=>routes.set(name,renderer)};
  window.PipiAndroidPage?.connect({
    restorePickedFile:file=>useChatImage([file],route,authEpoch),
    ready:()=>Boolean(state)&&view.dataset.route!=='auth',route:()=>route,capture:captureAndroidPage,warn:toast,retry:boot,visibleChat:roleId=>route.name==='chat'&&route.arg===roleId&&!modalOpen&&!childDialog,
    clear:()=>{drafts.clear();chatScrolls.clear();androidReadings.clear();composeText='';quoteId='';try{sessionStorage.removeItem(chatDraftKey);sessionStorage.removeItem(browserPositionKey);}catch{}},
    canBack:()=>Boolean(overlayBackPending||childDialog||modalOpen||chatSelection||history.state?.featureSelection||state&&(navStack.length||route.name!=='chats')),
    back:()=>{if(!modalSaveInProgress)goBack();},previous:()=>navStack.at(-1)||{name:'chats',arg:null},
    previewTarget:()=>childDialog?.dialog|| (modalOpen?overlay:view),
    previewPage:page=>{if(page.name!=='chats')return null;const preview=document.createElement('div');preview.className=view.className;preview.innerHTML=renderChats();preview.querySelector('.content').scrollTop=chatsReturn;return preview;},
    openChat:openIncomingChat
  });
  document.addEventListener('error',event=>{const image=event.target;if(image.tagName!=='IMG'||!/^\/api\/media\//.test(image.getAttribute('src')||''))return;image.classList.add('unavailable-media');if(image.dataset.availableAlt==null)image.dataset.availableAlt=image.alt;image.alt='图片不可用';},true);
  document.addEventListener('load',event=>{const image=event.target;if(image.tagName!=='IMG'||!image.classList.contains('unavailable-media'))return;image.classList.remove('unavailable-media');image.alt=image.dataset.availableAlt;delete image.dataset.availableAlt;},true);
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
  history.replaceState({pipi:true,route:{...route},stack:[...navStack]},'');window.addEventListener('popstate',event=>{if(overlayBackPending){overlayBackPending=false;if(overlayCloseQueued){const discardAll=overlayCloseQueued==='all';overlayCloseQueued=false;if(history.state?.overlay){overlayBackPending=true;if(discardAll)history.go(-(history.state.overlayDepth||1));else history.back();return;}}if(queuedView){const next=queuedView;queuedView=null;queuedBack=false;if(modalOpen&&history.state?.overlay){closeModal(false);queuedView=next;return;}if(modalOpen)closeModal(false,true);showView(next.name,next.arg,next.fromBack);}else if(queuedBack){queuedBack=false;goBack();}else if(modalOpen)trackModalHistory();if(!overlayBackPending&&!modalOpen)window.PipiFeatures?.handleBack?.('history');if(!overlayBackPending)overlayBackWaiters.splice(0).forEach(resolve=>resolve());return;}if(bootStale){if(event.state?.overlay||event.state?.chatSelection||event.state?.childDialog||event.state?.featureSelection){history.back();return;}bootStale=false;}if(childDialog){closeChildDialog(true);return;}if(modalOpen){closeModal(true,true);return;}if(window.PipiFeatures?.handleBack?.('history'))return;if(chatSelection&&!event.state?.chatSelection){finishMessageSelection(true);return;}if(event.state?.overlay||event.state?.chatSelection||event.state?.childDialog||event.state?.featureSelection){history.back();return;}const previous=event.state?.route||{name:'chats',arg:null};navStack.splice(0,navStack.length,...(event.state?.stack||[]));showView(previous.name,previous.arg,true);});
  const viewport=window.visualViewport;
  let viewportFrame=0,lastViewportSize='';
  function sizeViewport(){
    viewportFrame=0;
    // Convert the visible height back to layout pixels: a pinch changes the
    // browser magnification, while a keyboard still reduces the usable area.
    // Keep updating after blur even if Safari retains its focus magnification.
    const zoomed=viewport&&Math.abs(viewport.scale-1)>.01;
    const height=Math.round(viewport?Math.min(innerHeight,viewport.height*viewport.scale):innerHeight);
    const top=Math.round(viewport&&!zoomed?viewport.offsetTop:0),size=height+':'+top;
    if(size===lastViewportSize)return;
    const anchor=captureChatLayout();
    document.documentElement.style.setProperty('--app-height',height+'px');
    document.documentElement.style.setProperty('--viewport-top',top+'px');
    lastViewportSize=size;
    const rail=view.querySelector('.contact-index-rail');if(rail)syncContactIndex(rail);
    restoreChatLayout(anchor);
  }
  function scheduleViewport(){if(!viewportFrame)viewportFrame=requestAnimationFrame(sizeViewport);}
  viewport?.addEventListener('resize',scheduleViewport);viewport?.addEventListener('scroll',scheduleViewport);
  window.addEventListener('resize',scheduleViewport);window.addEventListener('pageshow',scheduleViewport);
  window.addEventListener('focus',scheduleViewport);
  document.addEventListener('focusin',scheduleViewport);document.addEventListener('focusout',scheduleViewport);sizeViewport();
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){persistChatDrafts();if(recordingSession)stopRecording(true);return;}
    scheduleViewport();flushRender();syncVisibleChatRead();
  });
  window.addEventListener('pagehide',()=>{persistChatDrafts();saveBrowserPosition();if(recordingSession)stopRecording(true);});
  // Restored from the back/forward cache: the page is shown instantly, then state is refreshed in the background.
  window.addEventListener('pageshow',event=>{if(event.persisted&&state)boot();});
  let polling=false;
  async function resumeStateSync(){
    if(document.hidden)return;
    if(!state){if(view.querySelector('#retry-boot'))void boot();return;}
    window.PipiNetwork.abortSync();
    try{const client=window.PipiStateSync?.client,next=client?await client.resume(state.revision):await api('/api/state?since='+state.revision);if(!next.unchanged)receiveState(next.state||next);flushRender();}
    catch(error){if(error.status!==401&&!error.stale&&error.name!=='AbortError')console.debug('恢复联网后的同步失败，将自动重试');}
  }
  window.addEventListener('online',resumeStateSync);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void resumeStateSync();});
  setInterval(async()=>{
    if(!state||polling||recordingSession||composeComposing||searchComposing||document.hidden)return;
    polling=true;
    try{
      const next=await api('/api/state?since='+state.revision);
      if(!next.unchanged)receiveState(next.state||next);
      flushRender();
    }catch(err){if(err.status!==401)console.debug('Background refresh unavailable');}finally{polling=false;}
  },6500);
  window.Pipi.rolePanelAvailable=()=>rolePanelAvailable;
  bindSheetBackdrop();
  if(bootStale)history.back();
  boot();
})();
