'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../lib/state.cjs'),R=require('../lib/engine/registry.cjs'),Runtime=require('../lib/engine/runtime.cjs');

test('background schedule model usage reaches existing usage totals',async()=>{
  const state=sampleState(),at=Date.now(),original=R.runJobs;
  const runtime=Runtime.create({getState:()=>state,mutate:fn=>({value:fn(state),state}),now:()=>at});
  const before=state.engine.usageTotals?.summary.count||0;
  R.runJobs=async ctx=>ctx.onUsage({at,modelId:'isolated-schedule',model:'isolated-schedule',purpose:'chat',inputTokens:12,outputTokens:8,success:true});
  try{
    await runtime.tick();
    assert.equal(state.engine.usage.at(-1).modelId,'isolated-schedule');
    assert.equal(state.engine.usageTotals.summary.count,before+1);
    assert.equal(state.engine.usageTotals.summary.totalTokens,20);
  }finally{R.runJobs=original;await runtime.close();}
});
