// SPDX-License-Identifier: MIT
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),S=require('../lib/state.cjs');
function fixture(timezone){const state=S.initial();S.apply(state,'role.save',{name:'浇水时区好友'});state.settings.timezone=timezone;const roleId=state.roles[0].id;state.farm.friends[roleId].plots[0]={id:'1',crop:'carrot',plantedAt:Date.parse('2026-11-25T15:00:00Z'),readyAt:Date.parse('2026-11-27T00:00:00Z')};return {state,roleId};}
test('P2-6 Shanghai watering resets at local midnight and retains old visit dates',()=>{
  const {state,roleId}=fixture('Asia/Shanghai'),before=Date.parse('2026-11-25T15:59:59Z');
  S.apply(state,'farm.water',{roleId,plotId:'1'},before);assert.equal(state.farm.visits.at(-1).date,'2026-11-25');
  assert.throws(()=>S.apply(state,'farm.water',{roleId,plotId:'1'},before),/今天已经/);
  S.apply(state,'farm.water',{roleId,plotId:'1'},before+2000);
  assert.deepEqual(state.farm.visits.map(row=>row.date),['2026-11-25','2026-11-26']);
  assert.throws(()=>S.apply(state,'farm.water',{roleId,plotId:'1'},before+3000),/今天已经/);
});
test('P2-6 missing timezone retains UTC daily watering behavior',()=>{
  const {state,roleId}=fixture(''),before=Date.parse('2026-11-25T23:59:59Z');
  S.apply(state,'farm.water',{roleId,plotId:'1'},before);S.apply(state,'farm.water',{roleId,plotId:'1'},before+2000);
  assert.deepEqual(state.farm.visits.map(row=>row.date),['2026-11-25','2026-11-26']);
});
