import {NextResponse} from 'next/server';
import {db,ensureSeed} from '@/lib/server';

export const dynamic='force-dynamic';

const tokenHash=async(token:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),byte=>byte.toString(16).padStart(2,'0')).join('');

export async function GET(request:Request){
  const token=request.headers.get('authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
  if(!token)return NextResponse.json({error:'Appareil non autorisé ou jeton expiré.'},{status:401,headers:{'Cache-Control':'no-store'}});
  // Do not seed or mutate the database before the bearer credential is proven.
  // This keeps an unauthenticated bootstrap probe strictly fail-closed in production.
  await ensureSeed();
  const hash=await tokenHash(token),now=Date.now();
  const row=await db().prepare(`SELECT c.device_id,c.expires_at,d.label,d.role,d.organization_id,d.location_id,
    o.name AS organization_name,l.name AS location_name
    FROM device_credentials c JOIN devices d ON d.id=c.device_id AND d.organization_id=c.organization_id AND d.location_id=c.location_id
    JOIN organizations o ON o.id=d.organization_id JOIN locations l ON l.organization_id=d.organization_id AND l.id=d.location_id
    WHERE c.token_hash=? AND c.revoked_at IS NULL AND c.expires_at>? AND d.status='active' AND o.status='active' AND l.status='active'`).bind(hash,now).first<{device_id:string;expires_at:number;label:string;role:string;organization_id:string;location_id:string;organization_name:string;location_name:string}>();
  if(!row)return NextResponse.json({error:'Appareil non autorisé ou jeton expiré.'},{status:401,headers:{'Cache-Control':'no-store'}});
  await db().batch([
    db().prepare('UPDATE device_credentials SET last_seen_at=? WHERE token_hash=? AND revoked_at IS NULL').bind(new Date().toISOString(),hash),
    db().prepare("UPDATE devices SET last_seen_at=? WHERE id=? AND organization_id=? AND location_id=? AND status='active'").bind(new Date().toISOString(),row.device_id,row.organization_id,row.location_id),
  ]);
  return NextResponse.json({device:{id:row.device_id,label:row.label,role:row.role,expiresAt:row.expires_at},scope:{organizationId:row.organization_id,organizationName:row.organization_name,locationId:row.location_id,locationName:row.location_name,roles:[row.role],stations:['make_line','oven','expeditor'].filter(station=>station===row.role),writeStations:['make_line','oven','expeditor'].filter(station=>station===row.role),canMarkReady:row.role==='expeditor',canManageStaff:false}},{headers:{'Cache-Control':'no-store'}});
}
