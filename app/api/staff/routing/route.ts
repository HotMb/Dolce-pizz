import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db,ensureSeed} from '@/lib/server';
import {sessionUser} from '@/lib/auth';
import {readBoundedRequestText} from '@/lib/staff-access';

export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
class ApiError extends Error{constructor(public status:number,message:string){super(message);}}
const scope=z.object({organizationId:z.string().min(1).max(128)}).strict();
const postal=z.string().regex(/^\d{5}$/);
const configInput=z.object({organizationId:z.string().min(1).max(128),locationId:z.string().min(1).max(128),postalCodes:z.array(postal).max(500),priority:z.number().int().min(-100).max(100).default(0)}).strict();

async function authorize(request:Request,organizationId:string,write:boolean,locationId?:string){
  const origin=request.headers.get('origin'); const url=new URL(request.url);
  if(write&&(!origin||origin!==url.origin))throw new ApiError(403,'Cette demande doit être envoyée depuis le site.');
  const user=await sessionUser(request.headers.get('cookie')); if(!user)throw new ApiError(401,'Connectez-vous avec un compte autorisé.');
  await ensureSeed();
  const row=await db().prepare(`SELECT 1 AS ok FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id AND o.status='active' WHERE m.organization_id=? AND m.principal_id=? AND m.status='active' AND ((m.role IN ('owner','call_center') AND m.location_id IS NULL) OR (m.role='manager' AND m.location_id=?)) LIMIT 1`).bind(organizationId,user.id,locationId||'').first<{ok:number}>();
  if(!row)throw new ApiError(403,write?'Seul un responsable autorisé peut modifier le routage.':'Vous n’avez pas accès au routage de cette enseigne.');
  return user;
}

export async function GET(request:Request){
  try{const url=new URL(request.url);const parsed=scope.safeParse({organizationId:url.searchParams.get('organizationId')});if(!parsed.success)throw new ApiError(400,'Choisissez une enseigne valide.');const postalCode=url.searchParams.get('postalCode')||'';if(!/^\d{5}$/.test(postalCode))throw new ApiError(400,'Indiquez un code postal français valide.');await authorize(request,parsed.data.organizationId,false);const rows=await db().prepare(`SELECT l.id,l.code,l.name,l.address_line1,l.postal_code AS pickup_postal_code,l.locality,l.phone,z.priority FROM location_service_zones z JOIN locations l ON l.organization_id=z.organization_id AND l.id=z.location_id AND l.status='active' JOIN organizations o ON o.id=l.organization_id AND o.status='active' WHERE z.organization_id=? AND z.postal_code=? AND z.enabled=1 ORDER BY z.priority DESC,l.id LIMIT 20`).bind(parsed.data.organizationId,postalCode).all<{id:string;code:string;name:string;address_line1:string|null;pickup_postal_code:string|null;locality:string|null;phone:string|null;priority:number}>();return json({postalCode,candidates:rows.results.map(row=>({locationId:row.id,code:row.code,name:row.name,addressLine1:row.address_line1,pickupPostalCode:row.pickup_postal_code,locality:row.locality,phone:row.phone,priority:row.priority}))});}
  catch(error){if(error instanceof ApiError)return json({error:error.message},error.status);console.error('Routing GET error',error);return json({error:'Le routage est momentanément indisponible.'},503);}
}

export async function POST(request:Request){
  try{const text=await readBoundedRequestText(request,16000);let raw:unknown;try{raw=JSON.parse(text);}catch{throw new ApiError(400,'La demande est illisible.');}const input=configInput.parse(raw);const user=await authorize(request,input.organizationId,true,input.locationId);const location=await db().prepare(`SELECT id FROM locations WHERE organization_id=? AND id=? AND status='active'`).bind(input.organizationId,input.locationId).first<{id:string}>();if(!location)throw new ApiError(404,'Cet établissement est introuvable ou inactif.');const now=new Date().toISOString();const statements=[db().prepare('DELETE FROM location_service_zones WHERE organization_id=? AND location_id=?').bind(input.organizationId,input.locationId),...input.postalCodes.map(code=>db().prepare(`INSERT INTO location_service_zones(organization_id,location_id,postal_code,enabled,priority,created_at,updated_at) VALUES(?,?,?,1,?,?,?)`).bind(input.organizationId,input.locationId,code,input.priority,now,now))];await db().batch(statements);return json({organizationId:input.organizationId,locationId:input.locationId,postalCodes:input.postalCodes,updatedBy:user.id},200);}
  catch(error){if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Vérifiez les informations.'},400);if(error instanceof ApiError)return json({error:error.message},error.status);console.error('Routing POST error',error);return json({error:'La configuration du routage n’a pas pu être enregistrée.'},503);}
}
