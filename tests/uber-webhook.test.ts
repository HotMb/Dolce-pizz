import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {registerHooks,stripTypeScriptTypes} from 'node:module';
import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {test} from 'node:test';

const migrationDirectory=new URL('../drizzle/',import.meta.url);
const migrations=readdirSync(migrationDirectory).filter(name=>name.endsWith('.sql')).sort();
const migrate=(database:DatabaseSync)=>{database.exec('PRAGMA foreign_keys=ON');for(const migration of migrations)database.exec(readFileSync(new URL(migration,migrationDirectory),'utf8'));};
function d1(database:DatabaseSync):D1Database{
 const prepare=(sql:string,values:SQLInputValue[]=[]):D1PreparedStatement=>{const query=database.prepare(sql);return {bind(...parameters:unknown[]){return prepare(sql,parameters as SQLInputValue[])},async first(){return query.get(...values)||null},async all(){return {success:true,results:query.all(...values),meta:{changes:0}}},async run(){const result=query.run(...values);return {success:true,results:[],meta:{changes:Number(result.changes)}}}} as unknown as D1PreparedStatement;};
 return {prepare,async batch(statements:D1PreparedStatement[]){database.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());database.exec('COMMIT');return results;}catch(error){database.exec('ROLLBACK');throw error;}}} as unknown as D1Database;
}
const signature=async(secret:string,body:string)=>Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']),new TextEncoder().encode(body))),v=>v.toString(16).padStart(2,'0')).join('');

test('Uber webhook verifies, deduplicates and imports an order without SMS contact',async context=>{
 const database=new DatabaseSync(':memory:');migrate(database);const secret='uber-test-secret-01234567890123456789';
 const globals=globalThis as unknown as {__dolceUberEnvironment?:unknown};globals.__dolceUberEnvironment={DB:d1(database),UBER_EATS_WEBHOOK_SECRET:secret};
 database.exec("INSERT INTO organizations(id,name,slug,country_code,status,created_at,updated_at) VALUES('brand','Brand','brand','FR','active','2026-01-01','2026-01-01');INSERT INTO locations(id,organization_id,code,name,status,address_line1,postal_code,locality,phone,country_code,timezone,created_at,updated_at) VALUES('site','brand','site','Site','active','1 rue Test','59000','Lille','+33320000000','FR','Europe/Paris','2026-01-01','2026-01-01');INSERT INTO users(id,phone,name,created_at) VALUES('owner','+33600000001','Owner','2026-01-01');INSERT INTO delivery_integrations(organization_id,location_id,provider,external_store_id,status,created_at) VALUES('brand','site','uber_eats','store-1','active','2026-01-01');INSERT INTO products(id,name,category,description,price,xxl,available,options,offer,ingredients,allergens,allergens_checked,tagline,photo,status,spicy,sort,version,updated_at,organization_id) VALUES('pizza-1','Margherita','pizzas','Pizza',1200,1500,1,'[]',0,'[]','[]',1,'','','published',0,1,1,'2026-01-01','brand');");
 const hook=registerHooks({resolve(specifier,ctx,next){if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env=globalThis.__dolceUberEnvironment;',shortCircuit:true};if(specifier.startsWith('@/'))return next(new URL(`../${specifier.slice(2)}.ts`,import.meta.url).href,ctx);if(specifier==='next/server')return next('next/server.js',ctx);if((specifier.startsWith('./')||specifier.startsWith('../'))&&!specifier.endsWith('.js')&&!specifier.endsWith('.ts'))return next(new URL(`${specifier}.ts`,ctx.parentURL).href,ctx);return next(specifier,ctx);},load(url,ctx,next){const result=next(url,ctx);if(url.startsWith(new URL('../',import.meta.url).href)&&url.endsWith('.ts')){const source=typeof result.source==='string'?result.source:new TextDecoder().decode(result.source as Uint8Array);return {format:'module',source:stripTypeScriptTypes(source,{mode:'transform',sourceUrl:url}),shortCircuit:true};}return result;}});
 context.after(()=>{hook.deregister();delete globals.__dolceUberEnvironment;database.close();});
 const api=await import('../app/api/integrations/uber/webhook/route');const body=JSON.stringify({eventId:'event-123456',eventType:'order.created',storeId:'store-1',orderId:'order-1',customerName:'Client Uber',totalCents:1200,note:'',items:[{sku:'pizza-1',name:'Margherita',quantity:1,priceCents:1200,modifiers:[]}]});
 const call=async(payload:string)=>api.POST(new Request('http://localhost/api/integrations/uber/webhook',{method:'POST',headers:{'content-type':'application/json','x-uber-signature':await signature(secret,payload)},body:payload}));
 const first=await call(body);assert.equal(first.status,202);assert.equal(database.prepare("SELECT channel,fulfillment,payment_status,notification_phone,external_order_id FROM orders").get()?.channel,'uber_eats');assert.equal(database.prepare("SELECT notification_phone FROM orders").get()?.notification_phone,'');
 const statusBody=JSON.stringify({eventId:'event-323456',eventType:'order.status_updated',storeId:'store-1',orderId:'order-1',status:'in_preparation',note:'Pris en charge'});
 assert.equal((await call(statusBody)).status,200);assert.equal(database.prepare('SELECT external_status,status FROM orders').get()?.external_status,'in_preparation');assert.equal(database.prepare('SELECT status FROM orders').get()?.status,'pending');
 const duplicate=await call(body);assert.equal(duplicate.status,200);assert.equal(database.prepare('SELECT COUNT(*) AS n FROM orders').get()?.n,1);
 database.prepare("UPDATE delivery_inbox SET status='failed',error='temporary' WHERE provider='uber_eats' AND event_id='event-123456'").run();
 const replay=await call(body);assert.equal(replay.status,200);assert.equal(database.prepare("SELECT status,error FROM delivery_inbox WHERE event_id='event-123456'").get()?.status,'processed');
 const tampered=JSON.stringify({...JSON.parse(body),totalCents:1300});assert.equal((await call(tampered)).status,409);
 const cancel=JSON.stringify({eventId:'event-223456',eventType:'order.cancelled',storeId:'store-1',orderId:'order-1',customerName:'',totalCents:0,note:'',items:[]});assert.equal((await call(cancel)).status,200);assert.equal(database.prepare('SELECT status FROM orders').get()?.status,'cancelled');
});
