import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';

const migrationDirectory=new URL('../drizzle/',import.meta.url);
const migrations=readdirSync(migrationDirectory).filter(name=>name.endsWith('.sql')).sort();
const apply=(database:DatabaseSync,file:string)=>database.exec(readFileSync(new URL(file,migrationDirectory),'utf8'));

test('tenant customer migration preserves Dolce data and enforces organization boundaries',()=>{
 const database=new DatabaseSync(':memory:');
 try{
  database.exec('PRAGMA foreign_keys=ON');
  for(const file of migrations.filter(name=>name<'0007_'))apply(database,file);
  database.exec("INSERT INTO users(id,phone,name,created_at,marketing,marketing_at,marketing_source) VALUES('legacy-customer','+33612345678','Client historique','2026-09-01T10:00:00.000Z',1,'2026-09-02T10:00:00.000Z','compte')");
  database.exec("INSERT INTO orders(id,user_id,idempotency,name,phone,email,items,note,slot,subtotal,offer_discount,discount,total,redeemed,earned,status,organization_id,location_id,channel,fulfillment,payment_status,notification_phone,notification_phone_basis,created_at,updated_at) VALUES('legacy-order','legacy-customer','legacy-key','Client historique','06 12 34 56 78','','[]','','2026-10-24T18:00:00.000Z',1200,0,0,1200,0,12,'preparing','dolce-pizza','ronchin','web','pickup','due_at_pickup','+33612345678','account_otp','2026-10-23T10:00:00.000Z','2026-10-23T10:00:00.000Z')");
  database.exec("INSERT INTO ledger(id,user_id,order_id,delta,kind,created_at) VALUES('legacy-earned','legacy-customer','legacy-order',12,'earned','2026-10-23T10:01:00.000Z')");
  database.exec("INSERT INTO campaigns(id,message,status,total,sent,failed,simulated,created_by,created_at) VALUES('legacy-campaign','Dolce Pizz : promotion','sending',1,0,0,1,'legacy-customer','2026-10-23T11:00:00.000Z')");
  database.exec("INSERT INTO campaign_recipients(campaign_id,user_id,phone) VALUES('legacy-campaign','legacy-customer','+33612345678')");

  apply(database,'0007_tenant_customers_loyalty_campaigns.sql');

  assert.deepEqual(database.prepare('SELECT organization_id,user_id,name,marketing,marketing_at,marketing_source FROM customer_profiles').all().map(row=>({...row})),[{
   organization_id:'dolce-pizza',user_id:'legacy-customer',name:'Client historique',marketing:1,
   marketing_at:'2026-09-02T10:00:00.000Z',marketing_source:'compte',
  }]);
  assert.equal(database.prepare('SELECT customer_user_id FROM orders WHERE id=?').get('legacy-order')?.customer_user_id,'legacy-customer');
  assert.deepEqual({...database.prepare('SELECT organization_id,user_id,order_id,delta FROM ledger').get()},{organization_id:'dolce-pizza',user_id:'legacy-customer',order_id:'legacy-order',delta:12});
  assert.equal(database.prepare('SELECT organization_id FROM campaigns WHERE id=?').get('legacy-campaign')?.organization_id,'dolce-pizza');
  assert.equal(database.prepare('SELECT organization_id FROM campaign_recipients WHERE campaign_id=?').get('legacy-campaign')?.organization_id,'dolce-pizza');
  assert.deepEqual({...database.prepare('SELECT status,attempts,lease_token,lease_expires_at,last_error FROM campaign_recipients WHERE campaign_id=?').get('legacy-campaign')},{status:'pending',attempts:0,lease_token:null,lease_expires_at:null,last_error:''});
  const userColumns=database.prepare('PRAGMA table_info(users)').all().map(column=>column.name);
  assert.equal(userColumns.includes('marketing'),false);assert.equal(userColumns.includes('marketing_at'),false);assert.equal(userColumns.includes('marketing_source'),false);

  database.exec("INSERT INTO organizations(id,name,slug,status,created_at,updated_at) VALUES('other-brand','Autre enseigne','other-brand','active','2026-10-23','2026-10-23')");
  database.exec("INSERT INTO customer_profiles(organization_id,user_id,name,marketing,created_at,updated_at) VALUES('other-brand','legacy-customer','Client autre enseigne',0,'2026-10-23','2026-10-23')");
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM customer_profiles WHERE user_id=?').get('legacy-customer')?.n,2);
  assert.throws(()=>database.exec("UPDATE orders SET organization_id='other-brand',location_id='other-site' WHERE id='legacy-order'"),/order commercial scope is immutable|constraint failed/i);
  assert.throws(()=>database.exec("INSERT INTO ledger(id,organization_id,user_id,order_id,delta,kind,created_at) VALUES('wrong-ledger','other-brand','legacy-customer','legacy-order',10,'earned','2026-10-23')"),/invalid loyalty ledger scope|constraint failed|FOREIGN KEY/i);
  database.exec("INSERT INTO campaigns(id,organization_id,message,status,created_by,created_at) VALUES('other-campaign','other-brand','Autre promotion','sending','legacy-customer','2026-10-23')");
  assert.throws(()=>database.exec("INSERT INTO campaigns(id,organization_id,message,status,created_by,created_at) VALUES('other-campaign-2','other-brand','Autre promotion simultanée','sending','legacy-customer','2026-10-23')"),/UNIQUE constraint failed|constraint failed/i);
  assert.throws(()=>database.exec("INSERT INTO campaign_recipients(organization_id,campaign_id,user_id,phone) VALUES('dolce-pizza','other-campaign','legacy-customer','+33612345678')"),/constraint failed|FOREIGN KEY/i);
  assert.throws(()=>database.exec("INSERT INTO marketing_consent_events(id,organization_id,user_id,marketing,source,actor,occurred_at) VALUES('bad-source','other-brand','legacy-customer',1,'browser-controlled','self','2026-10-23')"),/CHECK constraint failed|constraint failed/i);
  assert.throws(()=>database.exec("DELETE FROM customer_profiles WHERE organization_id='dolce-pizza' AND user_id='legacy-customer'"),/marketing consent history is immutable|FOREIGN KEY constraint failed|constraint failed/i);
  assert.throws(()=>database.exec("UPDATE marketing_consent_events SET source='tampered'"),/immutable|constraint failed/i);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{database.close();}
});
