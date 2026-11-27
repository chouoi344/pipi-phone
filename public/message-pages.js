// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
(()=>{
  function create({pageSize=60,budget=3000}={}){
    const roles=new Map();
    let active=null,clock=0;
    function role(id){
      if(!roles.has(id))roles.set(id,{rows:[],head:null,loaded:false,hasMore:false,detached:false,visited:0});
      return roles.get(id);
    }
    function clear(){roles.clear();}
    function heads(messages){
      clear();
      for(const message of messages)role(message.roleId).head=message;
    }
    function valid(page,id){
      if(page.schema!==1||page.roleId!==id||!Array.isArray(page.messages)||page.messages.some(m=>m.roleId!==id||typeof m.id!=='string'))throw Error('服务器返回的聊天记录无效');
      return page;
    }
    function read(fetch,id,before='',limit=pageSize){
      const url='/api/messages?roleId='+encodeURIComponent(id)+'&limit='+limit+(before?'&beforeId='+encodeURIComponent(before):'');
      return fetch(url).then(page=>{
        valid(page,id);
        if(typeof page.hasMore!=='boolean'||page.hasMore&&!page.messages.length)throw Error('服务器返回的聊天分页无效');
        return page;
      });
    }
    function latest(id,page){
      const r=role(id);r.rows=page.messages;r.head=r.rows[r.rows.length-1]||null;
      r.loaded=true;r.hasMore=page.hasMore;r.detached=false;r.visited=++clock;
    }
    function prepend(id,page){
      const r=role(id),ids=new Set(r.rows.map(m=>m.id));
      r.rows=page.messages.filter(m=>!ids.has(m.id)).concat(r.rows);r.hasMore=page.hasMore;r.visited=++clock;
    }
    function around(id,page,target){
      const r=role(id);r.rows=page.messages.concat(target);r.loaded=true;r.hasMore=page.hasMore;
      r.detached=r.head?.id!==target.id;r.visited=++clock;
    }
    function count(r){return r.rows.length+(r.head&&!r.rows.some(m=>m.id===r.head.id)?1:0);}
    function flatten(focus,direction){
      const keep=active||focus;
      let total=0;for(const row of roles.values())total+=count(row);
      if(total>budget){
        // Reserve the active reading window; unopened conversations keep their latest message.
        for(const [id,r] of [...roles].sort((a,b)=>a[1].visited-b[1].visited)){
          if(total<=budget)break;
          if(id===keep||!r.loaded)continue;
          total-=count(r)-(r.head?1:0);r.rows=[];r.loaded=false;r.hasMore=false;r.detached=false;
        }
        const r=roles.get(keep);
        if(total>budget&&r?.loaded){
          const size=Math.max(1,r.rows.length-(total-budget));
          if(focus===keep&&direction==='older'||r.detached){
            // Keep the cursor and old reading anchor together. The head stays available for chat previews.
            r.rows=r.rows.slice(0,Math.max(1,size-(r.detached?0:1)));
            r.detached=r.head?.id!==r.rows[r.rows.length-1]?.id;
          }else{r.rows=r.rows.slice(-size);r.hasMore=true;}
        }
      }
      const messages=[];
      for(const r of roles.values()){
        messages.push(...r.rows);
        if(r.head&&(!r.loaded||r.detached))messages.push(r.head);
      }
      return messages; // Retain each conversation's server order, including equal or imported timestamps.
    }
    function info(id){
      const r=roles.get(id);
      return {loaded:!!r?.loaded,hasMore:!!r?.hasMore,firstId:r?.rows[0]?.id||'',endId:r?.detached?r.rows[r.rows.length-1]?.id||'':''};
    }
    function setActive(id){active=id||null;if(active)role(active).visited=++clock;}
    function needed(changes){
      const removed=new Set(changes.deleteMessageIds),ids=new Set();
      const currentRoles=changes.replace.roles&&new Set(changes.replace.roles.map(r=>r.id));
      for(const [id,r] of roles){
        if(currentRoles&&!currentRoles.has(id))continue;
        if(r.head&&removed.has(r.head.id)||r.detached&&r.rows.length&&r.rows.every(m=>removed.has(m.id)))ids.add(id);
      }
      for(const m of changes.upsertMessages){
        const r=roles.get(m.roleId);
        if(ids.has(m.roleId)||currentRoles&&!currentRoles.has(m.roleId))continue;
        // The v0.13.28 journal uses the same record for inserts and edits. Ask for the
        // tail before deciding that an unseen historical edit is a new message.
        if(!r||r.head?.id!==m.id&&!r.rows.some(row=>row.id===m.id))ids.add(m.roleId);
      }
      return ids;
    }
    async function readTail(fetch,id,removed){
      const r=roles.get(id);
      if(!r?.loaded||r.detached&&r.rows.some(m=>!removed.has(m.id)))return read(fetch,id,'',1);
      const tail=await read(fetch,id);
      // A burst can exceed a page. Follow the same server-side order until the old
      // tail overlaps, without discarding the reading window or fabricating a gap.
      if(!r.head||removed.has(r.head.id))return tail;
      while(tail.hasMore&&!tail.messages.some(m=>m.id===r.head.id)&&tail.messages.length<budget){
        const previous=await read(fetch,id,tail.messages[0].id);
        if(previous.epoch!==tail.epoch||previous.revision!==tail.revision)return previous;
        tail.messages=previous.messages.concat(tail.messages);tail.hasMore=previous.hasMore;
      }
      return tail;
    }
    function merge(changes,tails){
      const removed=new Set(changes.deleteMessageIds),updates=new Map(changes.upsertMessages.map(m=>[m.id,m])),fresh=[];
      if(changes.replace.roles){
        const kept=new Set(changes.replace.roles.map(r=>r.id));
        for(const id of roles.keys())if(!kept.has(id))roles.delete(id);
      }
      for(const id of tails.keys())role(id);
      for(const [id,r] of roles){
        const oldHead=r.head;
        r.rows=r.rows.filter(m=>!removed.has(m.id)).map(m=>updates.get(m.id)||m);
        if(oldHead)r.head=removed.has(oldHead.id)?null:updates.get(oldHead.id)||oldHead;
        const tail=tails.get(id);if(!tail)continue;
        const rows=tail.messages,head=rows[rows.length-1]||null;
        let cut=oldHead?rows.findIndex(m=>m.id===oldHead.id):-1;
        if(cut<0&&r.loaded&&!r.detached){
          const previous=new Set(r.rows.map(m=>m.id));
          for(let i=rows.length-1;i>=0;i--)if(previous.has(rows[i].id)){cut=i;break;}
        }
        const added=rows.slice(cut+1).filter(m=>updates.has(m.id)&&m.id!==oldHead?.id);
        // A deletion can reveal an older, edited head. It must not trigger a notification.
        if(!oldHead||!removed.has(oldHead.id)||cut>=0)fresh.push(...added);
        if(r.loaded&&!r.detached){
          if(oldHead&&cut<0&&tail.hasMore&&r.rows.length)r.detached=true;
          else{
            const existing=new Set(r.rows.map(m=>m.id));
            r.rows=r.rows.concat(rows.slice(cut+1).filter(m=>!existing.has(m.id)));
          }
        }
        r.head=head;
        if(r.detached&&(!r.rows.length||r.rows[r.rows.length-1].id===head?.id)){
          if(!r.rows.length)latest(id,tail);else r.detached=false;
        }
      }
      return fresh;
    }
    return {clear,heads,read,valid,latest,prepend,around,flatten,needed,readTail,merge,info,setActive,get active(){return active;},rows:id=>roles.get(id)?.rows||[]};
  }
  const api={create};if(typeof module==='object')module.exports=api;else globalThis.PipiMessagePages=api;
})();
