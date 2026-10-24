import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/server';
import {sessionUser} from '@/lib/auth';

export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
class ApiError extends Error{constructor(public status:number,message:string){super(message);}}
const id=z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const owner=async(userId:string,organizationId:string)=>!!await db().prepare("SELECT 1 FROM organization_memberships WHERE organization_id=? AND principal_id=? AND role='owner' AND location_id IS NULL AND status='active'").bind(organizationId,userId).first();
const dayAfter=(value:string)=>{const parsed=new Date(`${value}T00:00:00.000Z`);parsed.setUTCDate(parsed.getUTCDate()+1);return parsed.toISOString().slice(0,10);};

/** Consolidated organization metrics; raw order/customer records never cross this owner scope. */
export async function GET(request:Request){
 try{
  const user=await sessionUser(request.headers.get('cookie'));if(!user)throw new ApiError(401,'Connectez-vous pour consulter les rapports.');
  const query=new URL(request.url).searchParams;const parsed=z.object({organizationId:id,from:date.optional(),to:date.optional()}).strict().parse(Object.fromEntries(query));
  if(!await owner(user.id,parsed.organizationId))throw new ApiError(403,'Les rapports sont réservés au propriétaire de l’enseigne.');
  const now=new Date();const to=parsed.to||now.toISOString().slice(0,10),from=parsed.from||new Date(now.getTime()-29*86400000).toISOString().slice(0,10);if(new Date(`${from}T00:00:00Z`)>new Date(`${to}T00:00:00Z`))throw new ApiError(400,'La période est inversée.');
  const end=dayAfter(to);if((Date.parse(`${end}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000>31)throw new ApiError(400,'La période est limitée à 31 jours.');
  const scope={organizationId:parsed.organizationId,from,to};
  const [locations,totals,channels,payments]=await Promise.all([
   db().prepare(`SELECT l.id AS locationId,l.code,l.name,l.locality,l.status,COUNT(o.id) AS orders,COALESCE(SUM(CASE WHEN o.status='completed' THEN o.total ELSE 0 END),0) AS completedRevenue,COALESCE(SUM(CASE WHEN o.status='completed' THEN 1 ELSE 0 END),0) AS completed,COALESCE(SUM(CASE WHEN o.status IN ('cancelled','rejected') THEN 1 ELSE 0 END),0) AS cancelled
    FROM locations l LEFT JOIN orders o ON o.organization_id=l.organization_id AND o.location_id=l.id AND o.created_at>=? AND o.created_at<?
    WHERE l.organization_id=? GROUP BY l.id,l.code,l.name,l.locality,l.status ORDER BY l.name`).bind(`${from}T00:00:00.000Z`,`${end}T00:00:00.000Z`,parsed.organizationId).all(),
   db().prepare(`SELECT COUNT(*) AS orders,COALESCE(SUM(CASE WHEN status='completed' THEN total ELSE 0 END),0) AS completedRevenue,COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),0) AS completed,COALESCE(SUM(CASE WHEN status IN ('cancelled','rejected') THEN 1 ELSE 0 END),0) AS cancelled FROM orders WHERE organization_id=? AND created_at>=? AND created_at<?`).bind(parsed.organizationId,`${from}T00:00:00.000Z`,`${end}T00:00:00.000Z`).first(),
   db().prepare(`SELECT channel,COUNT(*) AS orders,COALESCE(SUM(CASE WHEN status='completed' THEN total ELSE 0 END),0) AS completedRevenue FROM orders WHERE organization_id=? AND created_at>=? AND created_at<? GROUP BY channel ORDER BY orders DESC`).bind(parsed.organizationId,`${from}T00:00:00.000Z`,`${end}T00:00:00.000Z`).all(),
   db().prepare(`SELECT method,COUNT(*) AS payments,COALESCE(SUM(amount),0) AS amount FROM payments WHERE organization_id=? AND created_at>=? AND created_at<? GROUP BY method ORDER BY amount DESC`).bind(parsed.organizationId,`${from}T00:00:00.000Z`,`${end}T00:00:00.000Z`).all(),
  ]);
  return json({period:{from,to},scope,...{totals,locations:locations.results,channels:channels.results,payments:payments.results}});
 }catch(error){if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Paramètres de rapport invalides.'},400);if(error instanceof ApiError)return json({error:error.message},error.status);console.error('Admin report error',error instanceof Error?error.message:'unknown');return json({error:'Le rapport est momentanément indisponible.'},503);}
}
