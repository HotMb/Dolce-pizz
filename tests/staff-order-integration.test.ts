import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {registerHooks,stripTypeScriptTypes} from 'node:module';
import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {test} from 'node:test';
import {createMarketingStopProof} from '../lib/marketing-stop';

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
 const marketingSecret='test-only-marketing-stop-012345678901';
 const binding={DB:d1(database),ADMIN_SETUP_CODE:setup,NOTIFICATION_DISPATCH_SECRET:dispatchSecret,MARKETING_STOP_SECRET:marketingSecret};
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
 const staffOrders=await import('../app/api/staff/orders/route');
 const devices=await import('../app/api/staff/devices/route');
 const deviceBootstrap=await import('../app/api/device/bootstrap/route');
 const production=await import('../app/api/production/route');
 const productionStream=await import('../app/api/production/stream/route');
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
  const verified=await call(web.POST,'auth/verify','POST',{phone,code:code.body.devCode,audience:'staff'});
  assert.equal(verified.response.status,200);
  assert.match(verified.response.headers.get('set-cookie')||'',/Max-Age=43200/);
  return verified.response.headers.get('set-cookie')!.split(';')[0];
 }
 const ownerCookie=await login('0600000001');
 const publicCatalog=await call<{location:{id:string;locality:string;postalCode:string;phone:string}}>(web.GET,'catalog');
 assert.equal(publicCatalog.response.status,200);
 assert.deepEqual(publicCatalog.body.location,{id:'ronchin',name:'Dolce Pizz’ — Ronchin',addressLine1:'191 avenue Jean-Jaurès',postalCode:'59790',locality:'Ronchin',phone:'+33 3 20 40 09 01',countryCode:'FR',timezone:'Europe/Paris'});
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
 const managerGrant=await call<{membershipId:string}>(staff.POST,'staff','POST',{action:'grant',...scope,principalId:worker.body.account.id,role:'manager'},ownerCookie);
 assert.equal(managerGrant.response.status,200);
 assert.equal((await call(web.GET,'admin/campaigns','GET',undefined,workerCookie)).response.status,403);
 assert.equal((await call(web.POST,'admin/campaigns','POST',{message:'Un responsable de site ne peut pas envoyer cette promotion.'},workerCookie)).response.status,403);
 assert.equal((await call(staff.POST,'staff','POST',{action:'revoke',...scope,membershipId:managerGrant.body.membershipId},ownerCookie)).response.status,200);
 const ovenDeviceResponse=await devices.POST(new Request('http://localhost/api/staff/devices',{method:'POST',headers:new Headers({'content-type':'application/json',origin:'http://localhost',cookie:ownerCookie}),body:JSON.stringify({...scope,action:'enroll',label:'Four KDS',role:'oven'})}));
 assert.equal(ovenDeviceResponse.status,201);
 const ovenDevice=await ovenDeviceResponse.json() as {credential:string;device:{id:string}};
 const bootstrap=await deviceBootstrap.GET(new Request('http://localhost/api/device/bootstrap',{headers:{authorization:`Bearer ${ovenDevice.credential}`}}));
 assert.equal(bootstrap.status,200);
 assert.equal((await bootstrap.json() as {scope:{locationId:string};device:{role:string}}).scope.locationId,'ronchin');
  for(let attempt=0;attempt<20;attempt++){
   const allowed=await deviceBootstrap.GET(new Request('http://localhost/api/device/bootstrap',{headers:{authorization:`Bearer ${ovenDevice.credential}`,'cf-connecting-ip':'10.0.0.10'}}));
   assert.equal(allowed.status,200);
  }
  const throttled=await deviceBootstrap.GET(new Request('http://localhost/api/device/bootstrap',{headers:{authorization:`Bearer ${ovenDevice.credential}`,'cf-connecting-ip':'10.0.0.10'}}));
  assert.equal(throttled.status,429);assert.equal(throttled.headers.get('retry-after'),'3600');
 assert.equal((await call(production.GET,`production?${query}&station=oven`,'GET',undefined,'',{authorization:`Bearer ${ovenDevice.credential}`,'origin':''})).response.status,200);
 assert.equal((await call(production.GET,`production?${query}&station=make_line`,'GET',undefined,'',{authorization:`Bearer ${ovenDevice.credential}`,'origin':''})).response.status,403);
 const deviceStream=await productionStream.GET(new Request(`http://localhost/api/production/stream?${query}&station=oven`,{headers:{authorization:`Bearer ${ovenDevice.credential}`}}));
 assert.equal(deviceStream.status,200);deviceStream.body?.cancel();
 const crossSiteStream=await productionStream.GET(new Request('http://localhost/api/production/stream?organizationId=dolce-pizza&locationId=tourcoing&station=oven',{headers:{authorization:`Bearer ${ovenDevice.credential}`}}));
 assert.equal(crossSiteStream.status,403);
 const revokedDevice=await call(staff.POST,'staff','POST',{action:'revoke',...scope,membershipId:'not-used'},ownerCookie);
 assert.equal(revokedDevice.response.status,404);
 const deviceRevoke=await devices.POST(new Request('http://localhost/api/staff/devices',{method:'POST',headers:new Headers({'content-type':'application/json',origin:'http://localhost',cookie:ownerCookie}),body:JSON.stringify({...scope,action:'revoke',deviceId:ovenDevice.device.id})}));
 assert.equal(deviceRevoke.status,200);
 assert.equal((await call(production.GET,`production?${query}&station=oven`,'GET',undefined,'',{authorization:`Bearer ${ovenDevice.credential}`,'origin':''})).response.status,401);
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
 assert.deepEqual({...database.prepare('SELECT organization_id,location_id,order_id,job_type,status FROM print_outbox WHERE order_id=?').get(orderId)},{organization_id:'dolce-pizza',location_id:'ronchin',order_id:orderId,job_type:'kitchen_ticket',status:'pending'});
 // Separate active branches and tenants contain real competing tickets, not just forbidden empty scopes.
 database.exec("INSERT INTO organizations(id,name,slug,status,created_at,updated_at) VALUES('other-brand','Other','other','active','2026-10-22','2026-10-22'); INSERT INTO locations(id,organization_id,code,name,status,created_at,updated_at) VALUES('second-site','dolce-pizza','second','Deuxième site de test','active','2026-10-22','2026-10-22'),('other-site','other-brand','other','Autre enseigne','active','2026-10-22','2026-10-22');");
 database.prepare("INSERT INTO customer_profiles(organization_id,user_id,name,created_at,updated_at) VALUES('other-brand',?,'Client autre enseigne',?,?)").run(before.body.account.id,new Date().toISOString(),new Date().toISOString());
 const template=database.prepare('SELECT * FROM orders WHERE id=?').get(orderId)!;
 const columns=Object.keys(template);
 function competingOrder(organizationId:string,locationId:string){
  const id=crypto.randomUUID();
  const row:Record<string,SQLInputValue>={...template,id,idempotency:crypto.randomUUID(),organization_id:organizationId,location_id:locationId};
  database.prepare(`INSERT INTO orders(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(column=>row[column] as SQLInputValue));
  return id;
 }
 const secondOrder=competingOrder('dolce-pizza','second-site');const otherOrder=competingOrder('other-brand','other-site');const tenantNow=new Date().toISOString();
 database.prepare("INSERT INTO ledger(id,organization_id,user_id,order_id,delta,kind,created_at) VALUES(?,?,?,?,?,'tenant-test',?)").run('dolce-points',scope.organizationId,before.body.account.id,orderId,40,tenantNow);
 database.prepare("INSERT INTO ledger(id,organization_id,user_id,order_id,delta,kind,created_at) VALUES(?,?,?,?,?,'tenant-test',?)").run('other-points','other-brand',before.body.account.id,otherOrder,1000,tenantNow);
 const account=await call<{user:{name:string;marketing:boolean};balance:number;orders:{id:string}[]}>(web.GET,'me','GET',undefined,ownerCookie);
 const expectedDolceBalance=Number(database.prepare('SELECT COALESCE(SUM(delta),0) AS n FROM ledger WHERE organization_id=? AND user_id=?').get(scope.organizationId,before.body.account.id)?.n||0);
 assert.equal(account.response.status,200);assert.equal(account.body.balance,expectedDolceBalance);assert.notEqual(account.body.balance,expectedDolceBalance+1000);
 assert.equal(account.body.user.name,'Client de test');assert.equal(account.body.orders.some(order=>order.id===otherOrder),false);
 assert.equal((await call(web.GET,`orders/${otherOrder}`,'GET',undefined,ownerCookie)).response.status,404);
 assert.equal((await call(web.PATCH,'me','PATCH',{name:'Client Dolce',marketing:true,source:'browser-controlled'},ownerCookie)).response.status,200);
 assert.deepEqual({...database.prepare('SELECT name,marketing,marketing_source FROM customer_profiles WHERE organization_id=? AND user_id=?').get(scope.organizationId,before.body.account.id)},{name:'Client Dolce',marketing:1,marketing_source:'compte'});
 assert.equal(database.prepare('SELECT name FROM users WHERE id=?').get(before.body.account.id)?.name,'');
 assert.deepEqual({...database.prepare('SELECT name,marketing FROM customer_profiles WHERE organization_id=? AND user_id=?').get('other-brand',before.body.account.id)},{name:'Client autre enseigne',marketing:0});
 database.prepare('UPDATE customer_profiles SET marketing=1,marketing_at=?,marketing_source=? WHERE organization_id=? AND user_id=?').run(tenantNow,'other-test','other-brand',before.body.account.id);
 database.prepare("INSERT INTO campaigns(id,organization_id,message,status,total,sent,failed,simulated,created_by,created_at) VALUES('other-campaign','other-brand','Other promo','sending',0,0,0,1,?,?)").run(before.body.account.id,tenantNow);
 const creationAttempts=await Promise.all([
  call<{campaign:{id:string;total:number}}>(web.POST,'admin/campaigns','POST',{message:'Une promotion Dolce réservée aux abonnés.'},ownerCookie),
  call<{campaign:{id:string;total:number}}>(web.POST,'admin/campaigns','POST',{message:'Une promotion concurrente qui doit être refusée.'},ownerCookie),
 ]);
 assert.deepEqual(creationAttempts.map(result=>result.response.status).sort(),[201,409]);
 const campaign=creationAttempts.find(result=>result.response.status===201)!;
 assert.equal(campaign.response.status,201,JSON.stringify(campaign.body));assert.equal(campaign.body.campaign.total,1);
 assert.deepEqual(database.prepare('SELECT organization_id,user_id FROM campaign_recipients WHERE campaign_id=?').all(campaign.body.campaign.id).map(row=>({...row})),[{organization_id:'dolce-pizza',user_id:before.body.account.id}]);
 const campaignList=await call<{campaigns:{id:string}[]}>(web.GET,'admin/campaigns','GET',undefined,ownerCookie);
 assert.equal(campaignList.body.campaigns.some(item=>item.id==='other-campaign'),false);
 assert.equal((await call(web.POST,'admin/campaigns/other-campaign/cancel','POST',{},ownerCookie)).response.status,404);
 const concurrentSends=await Promise.all([
  call<{campaign:{status:string;sent:number}}>(web.POST,`admin/campaigns/${campaign.body.campaign.id}/send`,'POST',{},ownerCookie),
  call<{campaign:{status:string;sent:number}}>(web.POST,`admin/campaigns/${campaign.body.campaign.id}/send`,'POST',{},ownerCookie),
 ]);
 assert.equal(concurrentSends.every(result=>result.response.status===200),true);
 assert.deepEqual({...database.prepare('SELECT status,attempts FROM campaign_recipients WHERE organization_id=? AND campaign_id=?').get(scope.organizationId,campaign.body.campaign.id)},{status:'simulated',attempts:1});
 assert.deepEqual({...database.prepare('SELECT status,sent FROM campaigns WHERE organization_id=? AND id=?').get(scope.organizationId,campaign.body.campaign.id)},{status:'done',sent:1});
 // Simulate revocation after the route-level authorization but before the campaign
 // mutation. The repeated check and SQL write guard must still reject the write.
 const ownerMembership=database.prepare("SELECT id FROM organization_memberships WHERE organization_id=? AND principal_id=? AND role='owner' AND status='active'").get(scope.organizationId,before.body.account.id)!;
 const beforeRevokedWrite=Number(database.prepare('SELECT COUNT(*) AS n FROM campaigns WHERE organization_id=?').get(scope.organizationId)?.n||0);
 const revokedWriteRequest=new Request('http://localhost/api/admin/campaigns',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json',cookie:ownerCookie},body:'{}'});
 Object.defineProperty(revokedWriteRequest,'text',{value:async()=>{
  database.prepare("UPDATE organization_memberships SET status='revoked' WHERE id=?").run(ownerMembership.id as string);
  return JSON.stringify({message:'Cette promotion ne doit pas être créée après révocation.'});
 }});
 const revokedWrite=await web.POST(revokedWriteRequest);
 assert.equal(revokedWrite.status,403);assert.equal(Number(database.prepare('SELECT COUNT(*) AS n FROM campaigns WHERE organization_id=?').get(scope.organizationId)?.n||0),beforeRevokedWrite);
 database.prepare("UPDATE organization_memberships SET status='active' WHERE id=?").run(ownerMembership.id as string);
 const cancelCampaign=await call<{campaign:{id:string}}>(web.POST,'admin/campaigns','POST',{message:'Cette promotion sera annulée avant tout envoi.'},ownerCookie);
 assert.equal(cancelCampaign.response.status,201);
 assert.equal((await call(web.POST,`admin/campaigns/${cancelCampaign.body.campaign.id}/cancel`,'POST',{},ownerCookie)).response.status,200);
 assert.equal((await call(web.POST,`admin/campaigns/${cancelCampaign.body.campaign.id}/send`,'POST',{},ownerCookie)).response.status,200);
 assert.deepEqual({...database.prepare('SELECT status,attempts FROM campaign_recipients WHERE organization_id=? AND campaign_id=?').get(scope.organizationId,cancelCampaign.body.campaign.id)},{status:'skipped',attempts:0});
 const uncertainCampaign=await call<{campaign:{id:string}}>(web.POST,'admin/campaigns','POST',{message:'Cette promotion simule un worker interrompu après réservation.'},ownerCookie);
 assert.equal(uncertainCampaign.response.status,201);
 database.prepare("UPDATE campaign_recipients SET status='processing',attempts=1,lease_token='stale-claim',lease_expires_at='2026-01-01T00:00:00.000Z' WHERE organization_id=? AND campaign_id=?").run(scope.organizationId,uncertainCampaign.body.campaign.id);
 const uncertainResult=await call<{campaign:{status:string;failed:number}}>(web.POST,`admin/campaigns/${uncertainCampaign.body.campaign.id}/send`,'POST',{},ownerCookie);
 assert.equal(uncertainResult.response.status,200);assert.deepEqual({status:uncertainResult.body.campaign.status,failed:uncertainResult.body.campaign.failed},{status:'done',failed:1});
 assert.deepEqual({...database.prepare('SELECT status,attempts,last_error FROM campaign_recipients WHERE organization_id=? AND campaign_id=?').get(scope.organizationId,uncertainCampaign.body.campaign.id)},{status:'failed',attempts:1,last_error:'claim_expired_without_provider_receipt'});
 const skipCampaign=await call<{campaign:{id:string;total:number}}>(web.POST,'admin/campaigns','POST',{message:'Cette promotion vérifiera le consentement au moment du claim.'},ownerCookie);
 assert.equal(skipCampaign.response.status,201);assert.equal(skipCampaign.body.campaign.total,1);
 const stopToken=await createMarketingStopProof(scope.organizationId,'+33600000001',marketingSecret);
 const stopLink=await web.GET(new Request(`http://localhost/api/marketing/stop?token=${stopToken}`));
 const stopCookie=stopLink.headers.get('set-cookie')?.split(';')[0]||'';assert.ok(stopCookie);
 assert.equal((await call(web.POST,'marketing/stop','POST',{phone:'0600000001'},stopCookie)).response.status,200);
 assert.equal(database.prepare('SELECT marketing FROM customer_profiles WHERE organization_id=? AND user_id=?').get(scope.organizationId,before.body.account.id)?.marketing,0);
 assert.equal(database.prepare('SELECT marketing FROM customer_profiles WHERE organization_id=? AND user_id=?').get('other-brand',before.body.account.id)?.marketing,1);
 assert.equal(database.prepare("SELECT COUNT(*) AS n FROM marketing_consent_events WHERE organization_id=? AND user_id=? AND source='stop'").get(scope.organizationId,before.body.account.id)?.n,1);
 const sentCampaign=await call<{campaign:{status:string;sent:number}}>(web.POST,`admin/campaigns/${skipCampaign.body.campaign.id}/send`,'POST',{},ownerCookie);
 assert.equal(sentCampaign.response.status,200);assert.equal(sentCampaign.body.campaign.status,'done');assert.equal(sentCampaign.body.campaign.sent,0);
 assert.equal(database.prepare('SELECT status FROM campaign_recipients WHERE organization_id=? AND campaign_id=?').get(scope.organizationId,skipCampaign.body.campaign.id)?.status,'skipped');
 const secondQuery=new URLSearchParams({...scope,locationId:'second-site'}).toString();
 const secondTickets=await call<{orders:{id:string}[]}>(production.GET,`production?${secondQuery}&station=make_line`,'GET',undefined,ownerCookie);
 assert.equal(secondTickets.response.status,200);assert.deepEqual(secondTickets.body.orders.map(order=>order.id),[secondOrder]);
 assert.equal((await call(production.GET,`production?${secondQuery}&station=oven`,'GET',undefined,workerCookie)).response.status,403);
 assert.equal((await call(production.GET,'production?organizationId=other-brand&locationId=other-site&station=oven','GET',undefined,ownerCookie)).response.status,403);
 const initial=await call<{orders:{orderId:string;revision:number;items:{id:string}[]}[]}>(production.GET,`production?${query}&station=make_line`,'GET',undefined,ownerCookie);
 assert.equal(initial.response.status,200);assert.equal(initial.body.orders.length,1);
 const productionOrder=initial.body.orders[0];
 const activeOrderId=orderId;
 const itemId=productionOrder.items[0].id;let revision=productionOrder.revision;
 const premature=await call(production.POST,`production?${query}`,'POST',{orderId:activeOrderId,action:'ready',station:'expeditor',expectedRevision:revision},ownerCookie);
 assert.equal(premature.response.status,409,JSON.stringify({request:{orderId:activeOrderId,revision},response:premature.body,initial:initial.body}));
 assert.equal((await call(production.POST,`production?${query}`,'POST',{orderId:activeOrderId,action:'start',station:'make_line',itemId,expectedRevision:revision},workerCookie)).response.status,403);
 for(const station of ['make_line','oven','expeditor']){
  for(const action of ['start','complete']){
   const result=await call<{revision:number}>(production.POST,`production?${query}`,'POST',{orderId:activeOrderId,action,station,itemId,expectedRevision:revision},station==='oven'?workerCookie:ownerCookie);
   assert.equal(result.response.status,200,`${station}/${action}: ${JSON.stringify(result.body)}`);revision=result.body.revision;
  }
 }
 const ready=await call(production.POST,`production?${query}`,'POST',{orderId:activeOrderId,action:'ready',station:'expeditor',expectedRevision:revision},ownerCookie);
 assert.equal(ready.response.status,200,JSON.stringify(ready.body));
 assert.equal(database.prepare('SELECT status FROM orders WHERE id=?').get(activeOrderId)?.status,'ready');
 assert.equal(database.prepare('SELECT COUNT(*) AS n FROM notification_outbox WHERE order_id=?').get(activeOrderId)?.n,1);
 const dry=await call<{eligible:number;claimed:number}>(notifications.POST,'internal/notifications','POST',{dryRun:true},'',{authorization:`Bearer ${dispatchSecret}`});
 assert.equal(dry.response.status,200);assert.equal(dry.body.eligible,1);assert.equal(dry.body.claimed,0);
 const live=await call(notifications.POST,'internal/notifications','POST',{},'',{authorization:`Bearer ${dispatchSecret}`});
 assert.equal(live.response.status,503); // No provider key in the integration environment; no network send.
 assert.equal(database.prepare('SELECT status FROM notification_outbox WHERE order_id=?').get(activeOrderId)?.status,'pending');
 database.prepare('UPDATE customer_profiles SET marketing=1,marketing_source=? WHERE organization_id=? AND user_id=?').run('compte','dolce-pizza',before.body.account.id);
 const otherProfileBeforeErasure=database.prepare('SELECT name,marketing FROM customer_profiles WHERE organization_id=? AND user_id=?').get('other-brand',before.body.account.id);
 const otherOrderBeforeErasure=database.prepare('SELECT name,phone,notification_phone FROM orders WHERE id=?').get(otherOrder);
 const erasure=await call(web.DELETE,'me','DELETE',undefined,ownerCookie);
 assert.equal(erasure.response.status,200,JSON.stringify(erasure.body));
 assert.deepEqual({...database.prepare('SELECT name,marketing FROM customer_profiles WHERE organization_id=? AND user_id=?').get(scope.organizationId,before.body.account.id)},{name:'',marketing:0});
 assert.deepEqual({...database.prepare('SELECT name,notification_phone FROM orders WHERE id=?').get(orderId)},{name:'Client anonymisé',notification_phone:''});
 assert.deepEqual({...database.prepare('SELECT name,marketing FROM customer_profiles WHERE organization_id=? AND user_id=?').get('other-brand',before.body.account.id)},{...otherProfileBeforeErasure});
 assert.deepEqual({...database.prepare('SELECT name,phone,notification_phone FROM orders WHERE id=?').get(otherOrder)},{...otherOrderBeforeErasure});
 assert.equal(database.prepare("SELECT COUNT(*) AS n FROM marketing_consent_events WHERE organization_id=? AND user_id=? AND actor='self_delete'").get(scope.organizationId,before.body.account.id)?.n,1);
 const kioskHeaders=new Headers({'content-type':'application/json',origin:'http://localhost',cookie:ownerCookie});
 const kioskEnrollment=await devices.POST(new Request('http://localhost/api/staff/devices',{method:'POST',headers:kioskHeaders,body:JSON.stringify({...scope,action:'enroll',label:'Borne client',role:'kiosk'})}));
 assert.equal(kioskEnrollment.status,201);
 const kioskCredential=(await kioskEnrollment.json() as {credential:string}).credential;
 const kioskBootstrap=await deviceBootstrap.GET(new Request('http://localhost/api/device/bootstrap',{headers:{authorization:`Bearer ${kioskCredential}`}}));
 assert.equal(kioskBootstrap.status,200);
 assert.equal((await kioskBootstrap.json() as {scope:{locationId:string};device:{role:string}}).device.role,'kiosk');
 const kioskOrder=await staffOrders.POST(new Request('http://localhost/api/staff/orders',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json',authorization:`Bearer ${kioskCredential}`},body:JSON.stringify({key:crypto.randomUUID(),...scope,channel:'kiosk',customerName:'Client borne',customerPhone:'',readySmsConfirmed:false,slot:new Date(Date.parse(input.slot)+3600000).toISOString(),note:'',items:[{id:product.id,size:'senior',quantity:1,option:''}]})}));
 assert.equal(kioskOrder.status,201,await kioskOrder.text());
 const kioskOrderRow={...(database.prepare("SELECT id,channel,status FROM orders WHERE channel='kiosk' ORDER BY created_at DESC LIMIT 1").get() as {id:string;channel:string;status:string})};
 assert.deepEqual(kioskOrderRow,{id:kioskOrderRow.id,channel:'kiosk',status:'preparing'});
 assert.deepEqual(database.prepare("SELECT job_type,status FROM print_outbox WHERE order_id=? ORDER BY job_type").all(kioskOrderRow.id).map(row=>({...row as {job_type:string;status:string}})),[
  {job_type:'customer_receipt',status:'pending'},
  {job_type:'kitchen_ticket',status:'pending'},
 ]);
 const revisionProduct=database.prepare('SELECT id,version,available FROM products WHERE organization_id=? AND id=?').get('dolce-pizza',product.id) as {id:string;version:number;available:number};
 const menuUpdate=await call<{product:{version:number;available:boolean}}>(web.PUT,`admin/products/${revisionProduct.id}`,'PUT',{available:!Boolean(revisionProduct.available),version:revisionProduct.version},ownerCookie);
 assert.equal(menuUpdate.response.status,200,JSON.stringify(menuUpdate.body));
 const menuUpdateAgain=await call<{product:{version:number;available:boolean}}>(web.PUT,`admin/products/${revisionProduct.id}`,'PUT',{available:Boolean(revisionProduct.available),version:menuUpdate.body.product.version},ownerCookie);
 assert.equal(menuUpdateAgain.response.status,200,JSON.stringify(menuUpdateAgain.body));
 const menuHistory=await call<{revisions:{id:string;product_id:string;product_version:number;action:string;actor_id:string;snapshot:string}[]}>(web.GET,`admin/products/revisions?productId=${revisionProduct.id}`,'GET',undefined,ownerCookie);
 assert.equal(menuHistory.response.status,200,JSON.stringify(menuHistory.body));
 assert.ok(menuHistory.body.revisions.some(row=>row.product_version===menuUpdate.body.product.version&&row.action==='updated'&&row.actor_id===before.body.account.id));
 assert.doesNotThrow(()=>JSON.parse(menuHistory.body.revisions[0].snapshot));
 const originalRevision=menuHistory.body.revisions.find(row=>row.product_version===menuUpdate.body.product.version);
 assert.ok(originalRevision,'La version précédente du menu doit rester restaurable.');
 const expectedAvailable=(JSON.parse(originalRevision!.snapshot) as {available:boolean}).available;
 const restored=await call<{product:{version:number;available:boolean}}>(web.POST,`admin/products/${revisionProduct.id}/restore`,'POST',{revisionId:originalRevision!.id,version:menuUpdateAgain.body.product.version},ownerCookie);
 assert.equal(restored.response.status,200,JSON.stringify(restored.body));
 assert.equal(restored.body.product.version,menuUpdateAgain.body.product.version+1);
 assert.equal(restored.body.product.available,expectedAvailable);
 const staleRestore=await call(web.POST,`admin/products/${revisionProduct.id}/restore`,'POST',{revisionId:originalRevision!.id,version:menuUpdateAgain.body.product.version},ownerCookie);
 assert.equal(staleRestore.response.status,409);
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
