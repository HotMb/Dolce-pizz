import assert from 'node:assert/strict';
import {test} from 'node:test';
import {catalog,type Product} from '../lib/catalog';
import {priceCart,type CartLine} from '../lib/pricing';
import {allowedSlot,slots,defaultSettings,nextStatus,parisParts} from '../lib/rules';

const pizza=(id:string)=>catalog.find(p=>p.id===id)!;
const line=(changes:Partial<CartLine>={}):CartLine=>({id:'margarita',size:'senior',option:'',quantity:1,...changes});
const menu:Product[]=[...catalog.map(p=>({...p,offer:p.id==='margarita'})),{...pizza('reine'),id:'premium',price:1900,xxl:2500}];

test('Senior, XXL and unit items use integer cents',()=>{
 const result=priceCart([line({quantity:2}),line({id:'reine',size:'xxl'}),line({id:'cristaline',size:'unique',quantity:3})],menu);
 assert.equal(result.total,5840);assert.equal(result.count,6);assert.equal(result.problem,'');
});
test('a more expensive second pizza charges the higher price and counts both pizzas',()=>{
 const result=priceCart([line({freeId:'premium',quantity:2})],menu);
 assert.equal(result.total,3800);assert.equal(result.offer,3400);assert.equal(result.count,4);
});
test('same-recipe offer and XXL offer keep the selected size',()=>{
 assert.equal(priceCart([line({freeId:'margarita'})],menu).total,1700);
 assert.equal(priceCart([line({freeId:'premium',size:'xxl'})],menu).total,2500);
});
test('removed offers, unavailable items, invalid sizes and invalid garnishes block submission',()=>{
 for(const cart of [line({id:'reine',freeId:'margarita'}),line({freeId:'missing'}),line({size:'unique'}),line({id:'calzone'}),line({option:'Inventée'}),line({freeId:'calzone',freeOption:'Inventée'}),line({id:'canette',size:'xxl'})])assert.ok(priceCart([cart],menu).problem);
 assert.ok(priceCart([line()],menu.map(p=>({...p,available:false}))).problem);
 assert.equal(priceCart([line({id:'calzone',option:'Poulet'})],menu).problem,'');
});
test('one loyalty ticket discounts one Senior pizza, with only the XXL difference remaining',()=>{
 assert.equal(priceCart([line({size:'xxl',quantity:2})],menu,true).total,2700);
 assert.equal(priceCart([line({quantity:2})],menu,true).ticketDiscount,1700);
});
test('loyalty cannot discount an offer bundle or a drink; selects the highest eligible Senior value',()=>{
 const result=priceCart([line({freeId:'reine'}),line({id:'premium'}),line({id:'canette',size:'unique'})],menu,true);
 assert.equal(result.ticketLine,1);assert.equal(result.ticketDiscount,1900);assert.equal(result.total,1850);
 assert.equal(priceCart([line({freeId:'reine'})],menu,true).ticketLine,-1);
 assert.equal(priceCart([line({id:'canette',size:'unique'})],menu,true).ticketDiscount,0);
});
test('legacy XXL below Senior never produces a negative payable total',()=>{
 assert.equal(priceCart([line({size:'xxl'})],[{...pizza('margarita'),xxl:1000}],true).total,0);
});
test('invalid quantities and missing products return a recoverable problem',()=>{
 for(const quantity of [-1,0,1.5,21,NaN])assert.ok(priceCart([line({quantity})],menu).problem);
 assert.ok(priceCart([line({id:'gone'})],menu).problem);assert.equal(priceCart([],menu).total,0);
});

const openSettings=()=>({...structuredClone(defaultSettings),hoursConfirmed:true,hours:Array.from({length:7},()=>({open:'18:00',close:'00:00',closed:false}))});
const now=Date.parse('2026-09-24T15:00:00Z'); // 17:00 Paris
test('unconfirmed hours, pause, closures and full slots are excluded',()=>{
 assert.equal(slots(defaultSettings,{},now).length,0);
 assert.equal(slots({...openSettings(),enabled:false},{},now).length,0);
 const available=slots(openSettings(),{},now);assert.equal(available[0].label,'18:00');
 assert.ok(!slots({...openSettings(),closures:['2026-09-24']},{},now).some(s=>s.date==='2026-09-24'));
 assert.ok(!slots(openSettings(),{[available[0].iso]:4},now).some(s=>s.iso===available[0].iso));
});
test('lead, cutoff, midnight, 15-minute alignment and seven-day horizon are enforced',()=>{
 const s=openSettings();
 assert.equal(allowedSlot(Date.parse('2026-09-24T21:45:00Z'),s,now),true);
 for(const t of ['2026-09-24T15:15:00Z','2026-09-24T22:00:00Z','2026-09-24T16:01:00Z','2026-10-02T16:00:00Z'])assert.equal(allowedSlot(Date.parse(t),s,now),false);
 assert.equal(allowedSlot(NaN,s,now),false);
});
test('Paris summer and winter offsets yield the right opening slot across DST changes',()=>{
 assert.equal(parisParts(Date.parse('2026-07-01T16:00:00Z')).minute,1080);
 assert.equal(parisParts(Date.parse('2026-12-01T17:00:00Z')).minute,1080);
 for(const date of ['2026-03-29T12:00:00Z','2026-10-25T12:00:00Z']){
  const result=slots(openSettings(),{},Date.parse(date));assert.equal(result[0].label,'18:00');assert.equal(new Set(result.map(s=>s.iso)).size,result.length);
 }
});
test('order lifecycle permits kitchen handoff but prevents reopening or skipping payment',()=>{
 assert.equal(nextStatus('pending','preparing'),true);
 assert.equal(nextStatus('preparing','ready'),true);assert.equal(nextStatus('ready','completed'),true);
 for(const [from,to] of [['pending','completed'],['completed','cancelled'],['cancelled','confirmed'],['rejected','pending'],['ready','preparing']])assert.equal(nextStatus(from,to),false);
});
