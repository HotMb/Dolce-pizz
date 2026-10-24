import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const script=path.resolve('scripts/preflight-production.mjs');
const valid={
  NODE_ENV:'production',
  ADMIN_SETUP_CODE:'a'.repeat(24),MARKETING_STOP_SECRET:'b'.repeat(40),NOTIFICATION_DISPATCH_SECRET:'c'.repeat(40),BREVO_API_KEY:'d'.repeat(24),SMS_SENDER:'DolcePizz',
  CF_D1_DATABASE_ID:'db-prod',CF_WORKER_NAME:'dolce-pizz',PUBLIC_BASE_URL:'https://pos.example.fr',NOTIFICATION_SCHEDULER_CONFIGURED:'1',TENANT_HOSTS_JSON:JSON.stringify({'pos.example.fr':{organizationId:'dolce-pizza',locationId:'ronchin'}}),
};
const run=(extra:Record<string,string|undefined>={})=>spawnSync(process.execPath,[script],{encoding:'utf8',env:{PATH:process.env.PATH||'',...valid,...extra} as NodeJS.ProcessEnv});

test('production preflight requires a public HTTPS base URL',()=>{
 const result=run({PUBLIC_BASE_URL:undefined});
 assert.notEqual(result.status,0);
 assert.match(`${result.stdout}${result.stderr}`,/PUBLIC_BASE_URL/);
});

test('production preflight accepts a real HTTPS domain and tenant binding',()=>{
 const result=run();
 assert.equal(result.status,0,`${result.stdout}${result.stderr}`);
 assert.match(result.stdout,/Préflight production réussi/);
});

test('production preflight rejects an invalid SMS sender',()=>{
 const result=run({SMS_SENDER:'<script>'});
 assert.notEqual(result.status,0);
 assert.match(`${result.stdout}${result.stderr}`,/SMS_SENDER/);
});

test('production preflight rejects an undeclared scheduler',()=>{
 const result=run({NOTIFICATION_SCHEDULER_CONFIGURED:undefined});
 assert.notEqual(result.status,0);
 assert.match(`${result.stdout}${result.stderr}`,/NOTIFICATION_SCHEDULER_CONFIGURED/);
});

test('production preflight rejects a dispatch secret with spaces',()=>{
 const result=run({NOTIFICATION_DISPATCH_SECRET:'a'.repeat(31)+' secret'});
 assert.notEqual(result.status,0);
 assert.match(`${result.stdout}${result.stderr}`,/NOTIFICATION_DISPATCH_SECRET/);
});
