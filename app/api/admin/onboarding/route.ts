import {env} from 'cloudflare:workers';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db,insertProduct} from '@/lib/server';
import {seedCatalog} from '@/lib/seed';
import {seedIngredients} from '@/lib/menu';
import {defaultSettings} from '@/lib/rules';
import {sessionUser,normalizePhone,underLimit} from '@/lib/auth';

export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
class ApiError extends Error{constructor(public status:number,message:string){super(message);}}
const id=z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/,'Utilisez un identifiant minuscule sans espace.');
const input=z.object({installationCode:z.string().min(20).max(200),organizationId:id,name:z.string().trim().min(2).max(120),slug:id,locationId:id,locationCode:id,locationName:z.string().trim().min(2).max(120),addressLine1:z.string().trim().min(3).max(160),postalCode:z.string().regex(/^\d{5}$/,'Le code postal doit comporter 5 chiffres.'),locality:z.string().trim().min(2).max(80),phone:z.string().trim().max(30)}).strict();
const secret=()=>{const vars=env as unknown as Record<string,string|undefined>;return vars.ADMIN_SETUP_CODE||process.env.ADMIN_SETUP_CODE||'';};
const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
const equalSecret=async(a:string,b:string)=>{if(!b)return false;const left=await digest(a),right=await digest(b);if(left.length!==right.length)return false;let diff=0;for(let i=0;i<left.length;i++)diff|=left[i]^right[i];return diff===0;};

/** Create one tenant and its first active pickup site. This is intentionally a one-shot setup route, not a public signup. */
export async function POST(request:Request){
 try{
  const url=new URL(request.url);const origin=request.headers.get('origin');if(!origin||origin!==url.origin)throw new ApiError(403,'Cette demande doit être envoyée depuis le site.');
  const user=await sessionUser(request.headers.get('cookie'));if(!user)throw new ApiError(401,'Connectez-vous avant de créer une enseigne.');
  const ip=request.headers.get('cf-connecting-ip')||'local';if(!await underLimit(`onboarding:${ip}`,5))throw new ApiError(429,'Trop de tentatives. Réessayez plus tard.');
  const length=Number(request.headers.get('content-length')||0);if(Number.isFinite(length)&&length>12000)throw new ApiError(413,'La demande est trop volumineuse.');
  const raw=await request.text();if(raw.length>12000)throw new ApiError(413,'La demande est trop volumineuse.');
  let parsed: z.infer<typeof input>;try{parsed=input.parse(JSON.parse(raw));}catch(error){if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Vérifiez les informations.'},400);throw new ApiError(400,'La demande est illisible.');}
  if(!await equalSecret(parsed.installationCode,secret()))throw new ApiError(403,'Code d’installation incorrect.');
  const phone=normalizePhone(parsed.phone);if(!phone)throw new ApiError(400,'Indiquez un mobile français valide pour l’établissement.');
  const now=new Date().toISOString();
  const existing=await db().prepare('SELECT id FROM organizations WHERE id=? OR slug=?').bind(parsed.organizationId,parsed.slug).first();if(existing)throw new ApiError(409,'Cette enseigne existe déjà.');
  const location=await db().prepare('SELECT id FROM locations WHERE id=?').bind(parsed.locationId).first();if(location)throw new ApiError(409,'Cet identifiant d’établissement existe déjà.');
  const statements=[
   db().prepare('INSERT INTO organizations(id,name,slug,country_code,status,created_at,updated_at) VALUES(?,?,?,\'FR\',\'active\',?,?)').bind(parsed.organizationId,parsed.name,parsed.slug,now,now),
   db().prepare('INSERT INTO locations(id,organization_id,code,name,status,address_line1,postal_code,locality,phone,country_code,timezone,created_at,updated_at) VALUES(?,?,?,? ,\'active\',?,?,?,?,\'FR\',\'Europe/Paris\',?,?)').bind(parsed.locationId,parsed.organizationId,parsed.locationCode,parsed.locationName,parsed.addressLine1,parsed.postalCode,parsed.locality,phone,now,now),
   db().prepare('INSERT INTO config(id,value,version,organization_id) VALUES(1,?,?,?)').bind(JSON.stringify(defaultSettings),1,parsed.organizationId),
   db().prepare('INSERT INTO organization_memberships(id,organization_id,location_id,principal_id,role,status,created_at,updated_at) VALUES(?,?,NULL,?,\'owner\',\'active\',?,?)').bind(`onboarding-owner:${parsed.organizationId}:${user.id}`,parsed.organizationId,user.id,now,now),
   ...seedIngredients.map(item=>db().prepare('INSERT INTO ingredients(id,name,allergens,meat,origin,extra,available,locked,sort,organization_id) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(item.id,item.name,JSON.stringify(item.allergens),item.meat,item.origin,item.extra?1:0,1,item.locked?1:0,item.sort,parsed.organizationId)),
   ...seedCatalog.map(item=>insertProduct(item,parsed.organizationId)),
  ];
  await db().batch(statements);
  return json({organization:{id:parsed.organizationId,name:parsed.name,slug:parsed.slug},location:{id:parsed.locationId,name:parsed.locationName,postalCode:parsed.postalCode,locality:parsed.locality},owner:{principalId:user.id},tenantBinding:{organizationId:parsed.organizationId,locationId:parsed.locationId}},201);
 }catch(error){if(error instanceof ApiError)return json({error:error.message},error.status);if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Vérifiez les informations.'},400);console.error('Tenant onboarding error',error instanceof Error?error.message:'unknown');return json({error:'La création de l’enseigne a échoué.'},503);}
}
