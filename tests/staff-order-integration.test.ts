import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {registerHooks,stripTypeScriptTypes} from 'node:module';
import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {test} from 'node:test';

const migrationDirectory=new URL('../drizzle/',import.meta.url);
const migrations=readdirSync(migrationDirectory).filter(name=>name.endsWith('.sql')).sort();
function migrate(database:DatabaseSync,files=migrations){
 database.exec('PRAGMA foreign_keys=ON');
 for(const file of files)database.exec(readFileSync(new URL(file,migrationDirectory),'utf8'));
}

/** Executes the application SQL against real SQLite while keeping all test data in memory. */
function d1(database:DatabaseSync):D1Database{
 const prepare=(sql:string,values:SQLInputValue[]=[]):D1PreparedStatement=>{
  const query=database.prepare(sql);
  return {
   bind(...parameters:unknown[]){return prepare(sql,parameters as SQLInputValue[]);},
   async first(column?:string){const row=query.get(...values)||null;return column?row?.[column]??null:row;},
   async all(){return {success:true,results:query.all(...values),meta:{changes:0}};},
   async run(){const result=query.run(...values);return {success:true,results:[],meta:{changes:Number(result.changes)}};},
  } as unknown as D1PreparedStatement;
 };
 return {prepare,async batch(statements:D1PreparedStatement[]){
  database.exec('BEGIN');
  try{const results=[];for(const statement of statements)results.push(await statement.run());database.exec('COMMIT');return results;}
  catch(error){database.exec('ROLLBACK');throw error;}
 }} as unknown as D1Database;
}

test('real API flow binds OTP contact, grants scoped staff, completes all stations and queues one eligible notification',async context=>{
 const database=new DatabaseSync(':memory:');migrate(database);
 const setup='test-only-setup-01234567890123456789';
 const dispatchSecret='test-only-dispatch-01234567890123456789';
 const binding={DB:d1(database),ADMIN_SETUP_CODE:setup,NOTIFICATION_DISPATCH_SECRET:dispatchSecret};
 const globals=globalThis as unknown as {__dolceIntegrationEnvironment?:typeof binding};
 globals.__dolceIntegrationEnvironment=binding;
 const hook=registerHooks({resolve(specifier,ctx,next){
  if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env=globalThis.__dolceIntegrationEnvironment;',shortCircuit:true};
  if(specifier.startsWith('@/'))return next(new URL(`../${specifier.slice(2)}.ts`,import.meta.url).href,ctx);
  if(specifier==='next/server'||specifier==='next/headers')return next(`${specifier}.js`,ctx);
  return next(specifier,ctx);
 },load(url,ctx,next){
  const result=next(url,ctx);
  if(url.startsWith(new URL('../',import.meta.url).href)&&url.endsWith('.ts')){
   const source=typeof result.source==='string'?result.source:new TextDecoder().decode(result.source as Uint8Array);
   return {format:'module',source:stripTypeScriptTypes(source,{mode:'transform',sourceUrl:url}),shortCircuit:true};
  }
  return result;
 }});
 context.after(()=>{hook.deregister();delete globals.__dolceIntegrationEnvironment;database.close();});
 const web=await import('../app/api/[...path]/route');
 const staff=await import('../app/api/staff/route');
 const production=await import('../app/api/production/route');
 const notifications=await import('../app/api/internal/notifications/route');
 type Handler=(request:Request)=>Promise<Response>;
 async function call<T=Record<string,unknown>>(handler:Handler,path:string,method='GET',body?:unknown,cookie='',extraHeaders:Record<string,string>={}){
  const response=await handler(new Request(`http://localhost/api/${path}`,{method,
   headers:{origin:'http://localhost','content-type':'application/json',...(cookie?{cookie}:{}),...extraHeaders},
   ...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return {response,body:await response.json() as T};
 }
 async function login(phone:string){
  const code=await call<{devCode?:string}>(web.POST,'auth/code','POST',{phone});
  assert.equal(code.response.status,200);assert.match(code.body.devCode||'',/^\d{6}$/);
  const verified=await call(web.POST,'auth/verify','POST',{phone,code:code.body.devCode});
  assert.equal(verified.response.status,200);
  return verified.response.headers.get('set-cookie')!.split(';')[0];
 }
 const ownerCookie=await login('0600000001');
 const workerCookie=await login('0600000002');
 const before=await call<{account:{id:string};scopes:unknown[]}>(staff.GET,'staff','GET',undefined,ownerCookie);
 assert.deepEqual(before.body.scopes,[]);
 assert.equal((await call(production.GET,'production?station=oven','GET',undefined,ownerCookie)).response.status,403);
 assert.equal((await call(web.POST,'admin/claim','POST',{code:setup},ownerCookie)).response.status,200);
 const scope={organizationId:'dolce-pizza',locationId:'ronchin'};
 const query=new URLSearchParams(scope).toString();
 const owner=await call<{scopes:{locationId:string;canManageStaff:boolean}[]}>(staff.GET,'staff','GET',undefined,ownerCookie);
 assert.equal(owner.body.scopes.length,1);assert.equal(owner.body.scopes[0].canManageStaff,true);
 const worker=await call<{account:{id:string}}>(staff.GET,'staff','GET',undefined,workerCookie);
 const grant=await call<{membershipId:string}>(staff.POST,'staff','POST',{action:'grant',...scope,principalId:worker.body.account.id,role:'oven'},ownerCookie);
 assert.equal(grant.response.status,200);
 const duplicate=await call<{membershipId:string}>(staff.POST,'staff','POST',{action:'grant',...scope,principalId:worker.body.account.id,role:'oven'},ownerCookie);
 assert.equal(duplicate.body.membershipId,grant.body.membershipId);
 assert.equal(database.prepare("SELECT COUNT(*) AS n FROM organization_memberships WHERE principal_id=? AND role='oven'").get(worker.body.account.id)?.n,1);
 assert.equal((await call(production.GET,`production?${query}&station=oven`,'GET',undefined,workerCookie)).response.status,200);
 assert.equal((await call(production.GET,`production?${query}&station=make_line`,'GET',undefined,workerCookie)).response.status,403);
 assert.equal((await call(staff.POST,'staff','POST',{action:'grant',...scope,principalId:worker.body.account.id,role:'manager'},workerCookie)).response.status,403);
 assert.equal((await call(staff.POST,'staff','POST',{action:'grant',...scope,principalId:worker.body.account.id,role:'owner'},ownerCookie)).response.status,400);
 assert.equal((await call(staff.GET,`staff?${query}&members=1`,'GET',undefined,workerCookie)).response.status,403);
 assert.equal((await call(production.GET,'production?organizationId=other&locationId=other&station=oven','GET',undefined,ownerCookie)).response.status,403);
 assert.equal((await call(production.GET,'production?organizationId=dolce-pizza&locationId=tourcoing&station=oven','GET',undefined,ownerCookie)).response.status,403);

 const config=database.prepare('SELECT value FROM config WHERE id=1').get()!;
 const settings={...JSON.parse(String(config.value)),hoursConfirmed:true,leadMinutes:15,cutoffMinutes:0,capacity:1,hours:Array.from({length:7},()=>({open:'00:00',close:'00:00',closed:false}))};
 database.prepare('UPDATE config SET value=? WHERE id=1').run(JSON.stringify(settings));
 database.exec('UPDATE products SET allergens_checked=1');
 const product=database.prepare("SELECT id FROM products WHERE xxl IS NOT NULL AND available=1 AND status='published' LIMIT 1").get()!;
 const available=await call<{slots:{iso:string}[]}>(web.GET,'slots');assert.ok(available.body.slots.length);
 const input={key:crypto.randomUUID(),name:'Client de test',note:'',slot:available.body.slots[0].iso,ticket:false,
  items:[{id:product.id,size:'senior',quantity:1,option:''}]};
 const created=await call<{order:{id:string;version:number}}>(web.POST,'orders','POST',input,ownerCookie);
 assert.equal(created.response.status,201,JSON.stringify(created.body));
 const orderId=created.body.order.id;
 const repeated=await call<{order:{id:string}}>(web.POST,'orders','POST',input,ownerCookie);
 assert.equal(repeated.body.order.id,orderId);
 const equivalentSlot=input.slot.replace(/:00\.000Z$/, 'Z');
 assert.notEqual(equivalentSlot,input.slot);
 database.prepare('UPDATE orders SET slot=? WHERE id=?').run(equivalentSlot,orderId);
 const normalizedAvailability=await call<{slots:{iso:string}[]}>(web.GET,'slots');
 assert.equal(normalizedAvailability.body.slots.some(slot=>slot.iso===input.slot),false);
 const secondRepresentation=await call(web.POST,'orders','POST',{...input,key:crypto.randomUUID(),slot:equivalentSlot},ownerCookie);
 assert.equal(secondRepresentation.response.status,409);
 assert.equal(database.prepare("SELECT COUNT(*) AS n FROM orders WHERE organization_id=? AND location_id=? AND substr(slot,1,16)||':00.000Z'=?").get('dolce-pizza','ronchin',input.slot)?.n,1);
 const snapshot=database.prepare('SELECT notification_phone,notification_phone_basis,notification_phone_captured_at,payment_status FROM orders WHERE id=?').get(orderId)!;
 assert.equal(snapshot.notification_phone,'+33600000001');assert.equal(snapshot.notification_phone_basis,'account_otp');
 assert.ok(snapshot.notification_phone_captured_at);assert.equal(snapshot.payment_status,'due_at_pickup');
 const accepted=await call(web.PATCH,`admin/orders/${orderId}`,'PATCH',{status:'preparing',version:created.body.order.version},ownerCookie);
 assert.equal(accepted.response.status,200,JSON.stringify(accepted.body));
 // Separate active branches and tenants contain real competing tickets, not just forbidden empty scopes.
 database.exec("INSERT INTO organizations(id,name,slug,status,created_at,updated_at) VALUES('other-brand','Other','other','active','2026-10-22','2026-10-22'); INSERT INTO locations(id,organization_id,code,name,status,created_at,updated_at) VALUES('second-site','dolce-pizza','second','Deuxième site de test','active','2026-10-22','2026-10-22'),('other-site','other-brand','other','Autre enseigne','active','2026-10-22','2026-10-22');");
 const template=database.prepare('SELECT * FROM orders WHERE id=?').get(orderId)!;
 const columns=Object.keys(template);
 function competingOrder(organizationId:string,locationId:string){
  const id=crypto.randomUUID();
  const row:Record<string,SQLInputValue>={...template,id,idempotency:crypto.randomUUID(),organization_id:organizationId,location_id:locationId};
  database.prepare(`INSERT INTO orders(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(column=>row[column] as SQLInputValue));
  return id;
 }
 const secondOrder=competingOrder('dolce-pizza','second-site');competingOrder('other-brand','other-site');
 const secondQuery=new URLSearchParams({...scope,locationId:'second-site'}).toString();
 const secondTickets=await call<{orders:{id:string}[]}>(production.GET,`production?${secondQuery}&station=make_line`,'GET',undefined,ownerCookie);
 assert.equal(secondTickets.response.status,200);assert.deepEqual(secondTickets.body.orders.map(order=>order.id),[secondOrder]);
 assert.equal((await call(production.GET,`production?${secondQuery}&station=oven`,'GET',undefined,workerCookie)).response.status,403);
 assert.equal((await call(production.GET,'production?organizationId=other-brand&locationId=other-site&station=oven','GET',undefined,ownerCookie)).response.status,403);
 const initial=await call<{orders:{orderId:string;revision:number;items:{id:string}[]}[]}>(production.GET,`production?${query}&station=make_line`,'GET',undefined,ownerCookie);
 assert.equal(initial.response.status,200);assert.equal(initial.body.orders.length,1);
 const itemId=initial.body.orders[0].items[0].id;let revision=initial.body.orders[0].revision;
 assert.equal((await call(production.POST,`production?${query}`,'POST',{orderId,action:'ready',station:'expeditor',expectedRevision:revision},ownerCookie)).response.status,409);
 assert.equal((await call(production.POST,`production?${query}`,'POST',{orderId,action:'start',station:'make_line',itemId,expectedRevision:revision},workerCookie)).response.status,403);
 for(const station of ['make_line','oven','expeditor']){
  for(const action of ['start','complete']){
   const result=await call<{revision:number}>(production.POST,`production?${query}`,'POST',{orderId,action,station,itemId,expectedRevision:revision},station==='oven'?workerCookie:ownerCookie);
   assert.equal(result.response.status,200,`${station}/${action}: ${JSON.stringify(result.body)}`);revision=result.body.revision;
  }
 }
 const ready=await call(production.POST,`production?${query}`,'POST',{orderId,action:'ready',station:'expeditor',expectedRevision:revision},ownerCookie);
 assert.equal(ready.response.status,200,JSON.stringify(ready.body));
 assert.equal(database.prepare('SELECT status FROM orders WHERE id=?').get(orderId)?.status,'ready');
 assert.equal(database.prepare('SELECT COUNT(*) AS n FROM notification_outbox WHERE order_id=?').get(orderId)?.n,1);
 const dry=await call<{eligible:number;claimed:number}>(notifications.POST,'internal/notifications','POST',{dryRun:true},'',{authorization:`Bearer ${dispatchSecret}`});
 assert.equal(dry.response.status,200);assert.equal(dry.body.eligible,1);assert.equal(dry.body.claimed,0);
 const live=await call(notifications.POST,'internal/notifications','POST',{},'',{authorization:`Bearer ${dispatchSecret}`});
 assert.equal(live.response.status,503); // No provider key in the integration environment; no network send.
 assert.equal(database.prepare('SELECT status FROM notification_outbox WHERE order_id=?').get(orderId)?.status,'pending');
 const revoke=await call(staff.POST,'staff','POST',{action:'revoke',...scope,membershipId:grant.body.membershipId},ownerCookie);
 assert.equal(revoke.response.status,200);
 assert.equal((await call(production.GET,`production?${query}&station=oven`,'GET',undefined,workerCookie)).response.status,403);
 assert.ok(Number(database.prepare('SELECT COUNT(*) AS n FROM staff_audit').get()?.n)>=3);
 database.exec("UPDATE organizations SET status='suspended' WHERE id='dolce-pizza'");
 assert.deepEqual((await call<{slots:unknown[]}>(web.GET,'slots')).body.slots,[]);
 assert.equal((await call(web.POST,'orders','POST',{...input,key:crypto.randomUUID()},ownerCookie)).response.status,503);
 assert.equal((await call(production.GET,`production?${query}&station=make_line`,'GET',undefined,ownerCookie)).response.status,403);
 assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('upgrade bootstraps only existing legacy pilot administrators as explicit owners',()=>{
 const database=new DatabaseSync(':memory:');
 try{
  migrate(database,migrations.slice(0,5));
  database.exec("INSERT INTO users(id,phone,name,created_at) VALUES('old-admin','+33600000001','Admin','2026-10-01'),('customer','+33600000002','Client','2026-10-01'); INSERT INTO roles VALUES('old-admin','admin');");
  database.exec(readFileSync(new URL('0005_staff_and_notifications.sql',migrationDirectory),'utf8'));
  assert.deepEqual(database.prepare('SELECT principal_id,role,location_id FROM organization_memberships').all().map(row=>({...row})),[{principal_id:'old-admin',role:'owner',location_id:null}]);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{database.close();}
});
