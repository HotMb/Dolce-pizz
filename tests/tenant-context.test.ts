import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveTenant} from '../lib/tenant';

test('tenant resolver keeps the local pilot fallback and rejects unknown hosts',()=>{
 const local=resolveTenant(new Request('http://localhost/api/catalog'));
 assert.deepEqual(local&&{organizationId:local.organizationId,locationId:local.locationId},{organizationId:'dolce-pizza',locationId:'ronchin'});
 assert.equal(resolveTenant(new Request('https://unknown.example.test/api/catalog')),null);
});

test('tenant resolver never uses a query string to change the tenant',()=>{
 const local=resolveTenant(new Request('http://localhost/api/catalog?organizationId=other&locationId=other'));
 assert.equal(local?.organizationId,'dolce-pizza');
 assert.equal(local?.locationId,'ronchin');
});

test('tenant resolver ignores malformed or shared demo host bindings',()=>{
 const valid=JSON.stringify({
  'ronchin.example.fr':{organizationId:'brand',locationId:'ronchin'},
  'bad..example.fr':{organizationId:'attacker',locationId:'site'},
  'dolce-pizz-demo.dolcepizza.workers.dev':{organizationId:'attacker',locationId:'site'},
 });
 assert.deepEqual(resolveTenant(new Request('https://ronchin.example.fr/menu'),valid),{
  organizationId:'brand',locationId:'ronchin',host:'ronchin.example.fr',
 });
 assert.equal(resolveTenant(new Request('https://bad..example.fr/menu'),valid),null);
 assert.equal(resolveTenant(new Request('https://dolce-pizz-demo.dolcepizza.workers.dev/menu'),valid)?.organizationId,'dolce-pizza');
});

test('tenant resolver fails closed on case-insensitive duplicate bindings',()=>{
 const bindings=JSON.stringify({
  'ronchin.example.fr':{organizationId:'brand',locationId:'ronchin'},
  'RONCHIN.EXAMPLE.FR':{organizationId:'other',locationId:'other'},
 });
 assert.equal(resolveTenant(new Request('https://ronchin.example.fr/menu'),bindings),null);
});
