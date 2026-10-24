import {NextResponse} from 'next/server';
import {z} from 'zod';
import {sessionUser,normalizePhone} from '@/lib/auth';
import {db,ensureSeed} from '@/lib/server';

export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
class CustomerApiError extends Error{constructor(public status:number,message:string){super(message);}}
const querySchema=z.object({organizationId:z.string().min(1).max(128),locationId:z.string().min(1).max(128),phone:z.string().trim().min(1).max(30)}).strict();

export async function GET(request:Request){
 try{
  const user=await sessionUser(request.headers.get('cookie'));if(!user)throw new CustomerApiError(401,'Connectez-vous pour rechercher un client.');
  const query=querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if(!query.success)throw new CustomerApiError(400,'Indiquez une enseigne et un mobile valides.');
  const phone=normalizePhone(query.data.phone);if(!phone)throw new CustomerApiError(400,'Saisissez un mobile français valide.');
  await ensureSeed();
  const access=await db().prepare("SELECT 1 AS ok FROM organization_memberships WHERE organization_id=? AND principal_id=? AND status='active' AND role IN ('owner','call_center') AND (location_id IS NULL OR location_id=?) LIMIT 1").bind(query.data.organizationId,user.id,query.data.locationId).first<{ok:number}>();
  if(!access)throw new CustomerApiError(403,'La recherche client est réservée au centre d’appels de l’enseigne.');
  const result=await db().prepare(`SELECT u.phone,COALESCE(p.name,'') AS name,COUNT(o.id) AS order_count,MAX(o.created_at) AS last_order_at
    FROM users u JOIN customer_profiles p ON p.user_id=u.id AND p.organization_id=?
    LEFT JOIN orders o ON o.organization_id=p.organization_id AND o.customer_user_id=p.user_id AND o.channel='web' AND o.location_id=?
    WHERE u.phone=? GROUP BY u.id,u.phone,p.name LIMIT 2`).bind(query.data.organizationId,query.data.locationId,phone).all<{phone:string;name:string;order_count:number;last_order_at:string|null}>();
  const customer=result.results[0];
  if(!customer)return json({customer:null});
  return json({customer:{name:customer.name,phone:customer.phone,orderCount:Number(customer.order_count)||0,lastOrderAt:customer.last_order_at}});
 }catch(error){if(error instanceof CustomerApiError)return json({error:error.message},error.status);console.error('Staff customer lookup failed',error);return json({error:'La recherche client est momentanément indisponible.'},503);}
}
