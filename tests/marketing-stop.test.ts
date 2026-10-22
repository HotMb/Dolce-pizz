import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createMarketingStopProof,matchesMarketingStopProof} from '../lib/marketing-stop';

test('unsubscribe proof is opaque, stable for its recipient and accepted with the right key',async()=>{
 const token=await createMarketingStopProof('+33612345678','random-long-secret');
 assert.match(token,/^[A-Za-z0-9_-]{22}$/);
 assert.equal(await matchesMarketingStopProof('+33612345678','random-long-secret',token),true);
});

test('unsubscribe proof cannot be transferred to another phone or signing secret',async()=>{
 const token=await createMarketingStopProof('+33612345678','random-long-secret');
 assert.equal(await matchesMarketingStopProof('+33687654321','random-long-secret',token),false);
 assert.equal(await matchesMarketingStopProof('+33612345678','other-secret',token),false);
});

test('malformed unsubscribe proofs are rejected before comparison',async()=>{
 assert.equal(await matchesMarketingStopProof('+33612345678','random-long-secret','not-a-token'),false);
 assert.equal(await matchesMarketingStopProof('+33612345678','','A'.repeat(22)),false);
});
