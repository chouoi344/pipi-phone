'use strict';
// Same network boundary used by the public release workflow's unit tests.
const net=require('node:net'),connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  let options=args[0];
  if(Array.isArray(options))options=options[0];
  if(typeof options==='number')options={port:options,host:typeof args[1]==='string'?args[1]:'localhost'};
  if(options&&typeof options==='object'&&options.port!=null){
    const host=String(options.host||options.hostname||'localhost').toLowerCase().replace(/^\[|\]$/g,'');
    if(!['127.0.0.1','localhost','::1','::ffff:127.0.0.1'].includes(host))throw Error('isolated test only permits local fixture servers: '+host);
  }
  return connect.apply(this,args);
};
