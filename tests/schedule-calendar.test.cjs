'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {calendarForDay}=require('../lib/engine/schedule-calendar.cjs');
test('Intl农历与春节、除夕、端午、中秋事实，不推断休息日',()=>{
  const spring=calendarForDay('2026-02-17');assert.equal(spring.lunar.month,1);assert.equal(spring.lunar.day,1);assert.equal(spring.lunar.text,'丙午年正月初一');assert.deepEqual(spring.festivals,['春节']);
  assert.ok(calendarForDay('2026-02-16').festivals.includes('除夕'));
  assert.ok(calendarForDay('2026-06-19').festivals.includes('端午节'));
  assert.ok(calendarForDay('2026-09-25').festivals.includes('中秋节'));
  assert.equal(calendarForDay('2026-10-01').weekday,'星期四');assert.equal(spring.isWorkday,undefined);assert.equal(spring.solarTermStatus,'official');
});
test('2026香港天文台节气日期边界、近期与跨年',()=>{
  // Official 2026 HKO calendar: 立春2/4、春分3/20、清明4/5、冬至12/22。
  for(const [date,name]of [['2026-02-04','立春'],['2026-03-20','春分'],['2026-04-05','清明'],['2026-12-22','冬至']])assert.deepEqual(calendarForDay(date).solarTerms,[name]);
  assert.equal(calendarForDay('2026-02-03').solarTerm,'立春前1天');
  assert.equal(calendarForDay('2026-02-05').solarTerm,'雨水前13天');
  assert.ok(calendarForDay('2026-04-05').festivals.includes('清明节'));
  const end=calendarForDay('2026-12-31');assert.equal(end.solarTerm,'小寒前5天');assert.equal(end.nextSolarTerm.date,'2027-01-05');
  assert.equal(calendarForDay('2031-02-04').solarTermStatus,'unavailable');assert.equal(calendarForDay('2031-02-04').solarTerm,'');
});
test('闰月不重复传统节日，日期入口拒绝无效日期',()=>{
  const leap=calendarForDay('2025-07-25');assert.equal(leap.lunar.leap,true);assert.equal(leap.lunar.month,6);
  assert.equal(calendarForDay('2026-01-15').lunar.month,11);
  assert.throws(()=>calendarForDay('2026-02-30'),{code:'VALIDATION'});
});
