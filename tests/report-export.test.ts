import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reportCsv} from '../lib/report-export';

test('report CSV exports aggregates with French separators and no customer fields',()=>{
 const csv=reportCsv({period:{from:'2026-10-01',to:'2026-10-02'},totals:{orders:2,completedRevenue:2500,completed:1,cancelled:1},locations:[{locationId:'ronchin',name:'Ronchin; centre',locality:'Ronchin',orders:2,completedRevenue:2500,completed:1,cancelled:1}],channels:[{channel:'web',orders:2,completedRevenue:2500}],payments:[{method:'cash',payments:1,amount:1200}]});
 assert.match(csv,/^\ufeff/);assert.match(csv,/"Ronchin; centre"/);assert.match(csv,/CA encaissé \(centimes\)/);assert.equal(csv.includes('phone'),false);assert.equal(csv.includes('email'),false);
});
