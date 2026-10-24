import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/server';
import {sessionUser,underLimit} from '@/lib/auth';

export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
class ApiError extends Error{constructor(public status:number,message:string){super(message);}}
const id=z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/);
const provider=z.literal('uber_eats');
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),organizationId:id,locationId:id,provider,externalStoreId:z.string().trim().min(1).max(160)}).strict(),
 z.object({action:z.literal('disable'),organizationId:id,locationId:id,provider,externalStoreId:z.string().trim().min(1).max(160)}).strict(),
]);
const owner=async(userId:string,organizationId:string)=>!!await db().prepare("SELECT 1 FROM organization_memberships WHERE organization_id=? AND principal_id=? AND role='owner' AND location_id IS NULL AND status='active'").bind(organizationId,userId).first();

export async function GET(request:Request){
 try{
  const user=await sessionUser(request.headers.get('cookie'));if(!user)throw new ApiError(401,'Connectez-vous avant de gérer les intégrations.');
  const organizationId=new URL(request.url).searchParams.get('organizationId')||'';if(!id.safeParse(organizationId).success||!await owner(user.id,organizationId))throw new ApiError(403,'Cette action est réservée au propriétaire de l’enseigne.');
  const rows=await db().prepare('SELECT organization_id,location_id,provider,external_store_id,status,created_at FROM delivery_integrations WHERE organization_id=? ORDER BY created_at DESC').bind(organizationId).all();return json({integrations:rows.results});
 }catch(error){if(error instanceof ApiError)return json({error:error.message},error.status);return json({error:'Impossible de charger les intégrations.'},503);}
}

export async function POST(request:Request){
 try{
  const url=new URL(request.url),origin=request.headers.get('origin');if(!origin||origin!==url.origin)throw new ApiError(403,'Cette demande doit être envoyée depuis le site.');
  const user=await sessionUser(request.headers.get('cookie'));if(!user)throw new ApiError(401,'Connectez-vous avant de gérer les intégrations.');
  const ip=request.headers.get('cf-connecting-ip')||'local';if(!await underLimit(`delivery-integrations:${user.id}:${ip}`,20))throw new ApiError(429,'Trop de tentatives. Réessayez plus tard.');
  const raw=await request.text();if(raw.length>8000)throw new ApiError(413,'La demande est trop volumineuse.');
  const parsed=input.parse(JSON.parse(raw));if(!await owner(user.id,parsed.organizationId))throw new ApiError(403,'Cette action est réservée au propriétaire de l’enseigne.');
  if(parsed.action==='create'){
   const location=await db().prepare("SELECT 1 FROM locations l JOIN organizations o ON o.id=l.organization_id AND o.status='active' WHERE l.organization_id=? AND l.id=? AND l.status='active'").bind(parsed.organizationId,parsed.locationId).first();if(!location)throw new ApiError(400,'Cet établissement est introuvable ou inactif.');
   try{await db().prepare("INSERT INTO delivery_integrations(organization_id,location_id,provider,external_store_id,status,created_at) VALUES(?,?,? ,?,'active',?)").bind(parsed.organizationId,parsed.locationId,parsed.provider,parsed.externalStoreId,new Date().toISOString()).run();}catch{throw new ApiError(409,'Ce magasin partenaire est déjà relié.');}
   return json({ok:true,integration:{organizationId:parsed.organizationId,locationId:parsed.locationId,provider:parsed.provider,externalStoreId:parsed.externalStoreId,status:'active'}},201);
  }
  const result=await db().prepare("UPDATE delivery_integrations SET status='disabled' WHERE organization_id=? AND location_id=? AND provider=? AND external_store_id=? AND status='active'").bind(parsed.organizationId,parsed.locationId,parsed.provider,parsed.externalStoreId).run();if(!result.meta.changes)throw new ApiError(404,'Cette intégration est introuvable ou déjà désactivée.');return json({ok:true,status:'disabled'});
 }catch(error){if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Vérifiez les informations.'},400);if(error instanceof ApiError)return json({error:error.message},error.status);return json({error:'La configuration de l’intégration a échoué.'},503);}
}
