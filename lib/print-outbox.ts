import {db} from '@/lib/server';
import {readBoundedRequestText} from '@/lib/staff-access';

type Device = {organization_id:string; location_id:string; device_id:string; role:string};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});

async function tokenHash(token:string){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}

async function deviceFromRequest(request:Request):Promise<Device|null>{
  const token=(request.headers.get('authorization')||'').match(/^Bearer ([a-f0-9]{64})$/)?.[1]||'';
  if(!token)return null;
  const hash=await tokenHash(token);const now=Date.now();
  return db().prepare(`SELECT c.organization_id,c.location_id,c.device_id,d.role
    FROM device_credentials c JOIN devices d ON d.organization_id=c.organization_id AND d.location_id=c.location_id AND d.id=c.device_id
    JOIN locations l ON l.organization_id=c.organization_id AND l.id=c.location_id AND l.status='active'
    JOIN organizations o ON o.id=c.organization_id AND o.status='active'
    WHERE c.token_hash=? AND c.revoked_at IS NULL AND c.expires_at>? AND d.status='active'`).bind(hash,now).first<Device>();
}

export async function handlePrintOutboxRequest(request:Request):Promise<Response>{
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type')||''))return json({error:'json_required'},415);
  const device=await deviceFromRequest(request);if(!device||device.role!=='printer_gateway')return json({error:'unauthorized'},401);
  let text:string;try{text=await readBoundedRequestText(request,20000);}catch(error){if(error instanceof RangeError)return json({error:'body_too_large'},413);throw error;}
  let input:unknown;try{input=JSON.parse(text);}catch{return json({error:'invalid_json'},400);}
  if(!input||typeof input!=='object')return json({error:'invalid_body'},400);
  const value=input as Record<string,unknown>;const action=value.action;
  const now=new Date().toISOString();
  await db().prepare('UPDATE device_credentials SET last_seen_at=? WHERE token_hash=?').bind(now,await tokenHash((request.headers.get('authorization')||'').slice(7))).run();
  if(action==='claim'){
    const limit=typeof value.limit==='number'&&Number.isInteger(value.limit)?Math.min(Math.max(value.limit,1),20):10;
    await db().prepare("UPDATE print_outbox SET status='unknown',lease_token=NULL,lease_expires_at=NULL,last_error='lease_expired',updated_at=? WHERE organization_id=? AND location_id=? AND status='printing' AND (lease_expires_at IS NULL OR lease_expires_at<=?)").bind(now,device.organization_id,device.location_id,now).run();
    const rows=await db().prepare("SELECT id FROM print_outbox WHERE organization_id=? AND location_id=? AND status='pending' AND available_at<=? ORDER BY available_at,created_at,id LIMIT ?").bind(device.organization_id,device.location_id,now,limit).all<{id:string}>();
    const jobs=[];for(const row of rows.results){const lease=crypto.randomUUID();const expires=new Date(Date.now()+120000).toISOString();const claimed=await db().prepare("UPDATE print_outbox SET status='printing',attempts=attempts+1,lease_token=?,lease_expires_at=?,updated_at=? WHERE id=? AND organization_id=? AND location_id=? AND status='pending' AND available_at<=?").bind(lease,expires,now,row.id,device.organization_id,device.location_id,now).run();if(claimed.meta.changes){const job=await db().prepare(`SELECT p.id,p.order_id,p.job_type,p.payload,p.attempts,p.lease_token,p.lease_expires_at,
        o.name AS customer_name,o.phone,o.slot,o.note,o.total,o.items,o.channel
        FROM print_outbox p JOIN orders o ON o.id=p.order_id AND o.organization_id=p.organization_id AND o.location_id=p.location_id
        WHERE p.id=? AND p.organization_id=? AND p.location_id=?`).bind(row.id,device.organization_id,device.location_id).first();if(job)jobs.push({...job,ticket:{jobType:job.job_type,orderId:job.order_id,customerName:job.customer_name,phone:job.phone,slot:job.slot,note:job.note,totalCents:job.total,channel:job.channel,items:job.items}});}}
    return json({jobs},200);
  }
  const id=typeof value.id==='string'&&value.id.length<=128?value.id:'';const lease=typeof value.leaseToken==='string'&&value.leaseToken.length<=128?value.leaseToken:'';
  if(!id||!lease)return json({error:'job_and_lease_required'},400);
  if(action==='complete'){
    const result=await db().prepare("UPDATE print_outbox SET status='printed',printed_at=?,provider_job_id=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND organization_id=? AND location_id=? AND status='printing' AND lease_token=?").bind(now,typeof value.providerJobId==='string'?value.providerJobId.slice(0,128):null,now,id,device.organization_id,device.location_id,lease).run();
    return result.meta.changes?json({ok:true}):json({error:'lease_conflict'},409);
  }
  if(action==='fail'){
    const reason=typeof value.error==='string'?value.error.slice(0,250):'printer_failed';
    const result=await db().prepare("UPDATE print_outbox SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,last_error=?,available_at=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND organization_id=? AND location_id=? AND status='printing' AND lease_token=?").bind(reason,new Date(Date.now()+30000).toISOString(),now,id,device.organization_id,device.location_id,lease).run();
    return result.meta.changes?json({ok:true}):json({error:'lease_conflict'},409);
  }
  return json({error:'unknown_action'},400);
}
