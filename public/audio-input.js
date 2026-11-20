// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
window.PipiAudio={async recordingWav(blob){
  // decodeAudioData resamples to the context's sample rate without audio playback.
  const context=new OfflineAudioContext(1,1,16000);
  const decoded=await context.decodeAudioData(await blob.arrayBuffer());
  const frames=decoded.length,buffer=new ArrayBuffer(44+frames*2),view=new DataView(buffer);
  const label=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  label(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);label(8,'WAVE');label(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
  label(36,'data');view.setUint32(40,frames*2,true);
  const channels=Array.from({length:decoded.numberOfChannels},(_,i)=>decoded.getChannelData(i));
  for(let i=0;i<frames;i++){
    let sample=0;for(const channel of channels)sample+=channel[i];
    sample=Math.max(-1,Math.min(1,sample/channels.length));
    view.setInt16(44+i*2,Math.round(sample*(sample<0?32768:32767)),true);
  }
  return new Blob([buffer],{type:'audio/wav'});
}};
