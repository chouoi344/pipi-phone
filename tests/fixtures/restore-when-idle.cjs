'use strict';
const {setTimeout: delay}=require('node:timers/promises');

// The server can briefly return BUSY while its scheduled background check completes.
module.exports=async function restoreWhenIdle(restore){
  const deadline=Date.now()+8000;
  for(;;){
    const response=await restore();
    if(response.status!==409||response.value.code!=='BUSY'||Date.now()>=deadline)return response;
    await delay(100);
  }
};
