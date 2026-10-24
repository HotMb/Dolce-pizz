import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compareProductionPriority,productionPriority} from '../lib/production-priority';

const now=Date.parse('2026-10-24T10:00:00.000Z');

test('priority marks a ticket at risk without applying a permanent channel bonus',()=>{
 const urgent=productionPriority({slot:'2026-10-24T10:00:00.000Z',status:'in_progress',itemCount:4,pizzaCount:3,now});
 assert.equal(urgent.band,'urgent');
 assert.match(urgent.reason,/retard/i);
 const normal=productionPriority({slot:'2026-10-24T12:00:00.000Z',status:'in_progress',itemCount:1,pizzaCount:0,now});
 assert.equal(normal.band,'normal');
});

test('priority comparator puts the highest operational risk first and ready tickets last',()=>{
 const urgent=productionPriority({slot:'2026-10-24T10:00:00.000Z',status:'in_progress',itemCount:4,pizzaCount:3,now});
 const normal=productionPriority({slot:'2026-10-24T12:00:00.000Z',status:'in_progress',itemCount:1,pizzaCount:0,now});
 const ready=productionPriority({slot:'2026-10-24T10:00:00.000Z',status:'ready',itemCount:1,pizzaCount:1,now});
 assert.equal(compareProductionPriority(urgent,normal)<0,true);
 assert.equal(compareProductionPriority(normal,ready)<0,true);
});
