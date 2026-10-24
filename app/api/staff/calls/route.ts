import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db, ensureSeed} from '@/lib/server';
import {normalizePhone, sessionUser} from '@/lib/auth';
import {loadStaffScope, readBoundedRequestText} from '@/lib/staff-access';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, {status, headers: {'Cache-Control': 'no-store'}});
class ApiError extends Error {constructor(public status: number, message: string) {super(message);}}
const query = z.object({organizationId:z.string().min(1).max(128), locationId:z.string().min(1).max(128), phone:z.string().trim().min(1).max(30)}).strict();
const command = z.object({organizationId:z.string().min(1).max(128), locationId:z.string().min(1).max(128), phone:z.string().trim().min(1).max(30), customerUserId:z.string().min(1).max(128).optional(), orderId:z.string().min(1).max(128).optional(), outcome:z.enum(['order_created','customer_found','no_answer','callback_requested','other']), note:z.string().trim().max(500).default('')}).strict();
const digest = async (value:string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2,'0')).join('');

async function authorize(request:Request, organizationId:string, locationId:string, write:boolean) {
  if (write && request.headers.get('origin') !== new URL(request.url).origin) throw new ApiError(403, 'Cette demande doit être envoyée depuis le site.');
  const user = await sessionUser(request.headers.get('cookie')); if (!user) throw new ApiError(401, 'Connectez-vous pour gérer l’historique d’appel.');
  await ensureSeed();
  const access = await loadStaffScope(db(), user.id, {organizationId, locationId});
  if (!access || !access.roles.some(role => role === 'owner' || role === 'call_center')) throw new ApiError(403, 'L’historique d’appel est réservé au centre d’appels de l’enseigne.');
  return user;
}

export async function GET(request:Request) {
  try {
    const parsed=query.parse(Object.fromEntries(new URL(request.url).searchParams.entries())); const phone=normalizePhone(parsed.phone); if (!phone) throw new ApiError(400,'Saisissez un mobile français valide.');
    await authorize(request, parsed.organizationId, parsed.locationId, false); const phoneHash=await digest(`${parsed.organizationId}:${phone}`);
    const rows=await db().prepare(`SELECT id,customer_user_id AS customerUserId,order_id AS orderId,outcome,note,created_at AS createdAt FROM call_interactions WHERE organization_id=? AND location_id=? AND phone_hash=? ORDER BY created_at DESC LIMIT 50`).bind(parsed.organizationId,parsed.locationId,phoneHash).all();
    return json({organizationId:parsed.organizationId,locationId:parsed.locationId,interactions:rows.results});
  } catch(error) {if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Vérifiez les informations.'},400);if(error instanceof ApiError)return json({error:error.message},error.status);return json({error:'L’historique d’appel est momentanément indisponible.'},503);}
}

export async function POST(request:Request) {
  try {
    const raw=await readBoundedRequestText(request,8000);let parsed: z.infer<typeof command>;try{parsed=command.parse(JSON.parse(raw));}catch(error){if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Vérifiez les informations.'},400);throw new ApiError(400,'La demande est illisible.');}
    const phone=normalizePhone(parsed.phone);if(!phone)throw new ApiError(400,'Saisissez un mobile français valide.');const user=await authorize(request,parsed.organizationId,parsed.locationId,true);const phoneHash=await digest(`${parsed.organizationId}:${phone}`);
    const profile=await db().prepare('SELECT user_id AS userId FROM customer_profiles WHERE organization_id=? AND user_id IN (SELECT id FROM users WHERE phone=?)').bind(parsed.organizationId,phone).first<{userId:string}>();
    if(parsed.customerUserId&&(!profile||profile.userId!==parsed.customerUserId))throw new ApiError(409,'Le client ne correspond pas au mobile de l’appel.');
    if(parsed.orderId){const order=await db().prepare('SELECT id FROM orders WHERE id=? AND organization_id=? AND location_id=?').bind(parsed.orderId,parsed.organizationId,parsed.locationId).first();if(!order)throw new ApiError(404,'Cette commande n’appartient pas à l’établissement.');}
    const id=crypto.randomUUID(),now=new Date().toISOString();const result=await db().prepare('INSERT INTO call_interactions(id,organization_id,location_id,staff_user_id,customer_user_id,phone_hash,order_id,outcome,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,parsed.organizationId,parsed.locationId,user.id,profile?.userId||parsed.customerUserId||null,phoneHash,parsed.orderId||null,parsed.outcome,parsed.note,now).run();if(!result.meta.changes)throw new ApiError(409,'L’appel n’a pas été enregistré.');return json({interaction:{id,organizationId:parsed.organizationId,locationId:parsed.locationId,customerUserId:profile?.userId||parsed.customerUserId||null,orderId:parsed.orderId||null,outcome:parsed.outcome,note:parsed.note,createdAt:now}},201);
  } catch(error) {if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Vérifiez les informations.'},400);if(error instanceof ApiError)return json({error:error.message},error.status);return json({error:'L’appel n’a pas été enregistré.'},503);}
}
