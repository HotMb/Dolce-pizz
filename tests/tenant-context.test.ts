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
