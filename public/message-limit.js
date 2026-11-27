// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
(() => {
  let enabled=false,warnedDay='';
  const key='pipi.message-limit.warning-day';
  function configure(limit){enabled=limit===50000;}
  function check(state){
    const paging=window.PipiStateSync?.client?.paging,count=paging?paging.totalCount():state.messages.length;
    if(!enabled||count==null||count<45000)return;
    const timeZone=state.settings.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone,day=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    let seen='';try{seen=localStorage.getItem(key)||'';}catch{}
    if(warnedDay===day||seen===day)return;warnedDay=day;try{localStorage.setItem(key,day);}catch{}window.Pipi.toast(`消息快到上限了（${count}/50000），可以清空一些不需要的聊天记录`);
  }
  window.PipiMessageLimit={configure,check};
})();
