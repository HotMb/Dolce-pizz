import {staffSessionUser} from '@/lib/auth';
import {db,ensureSeed} from '@/lib/server';
import {canOperateStation,loadStaffScope} from '@/lib/staff-access';
import {productionDeviceSession} from '@/lib/device-access';
import {z} from 'zod';

export const dynamic='force-dynamic';
const querySchema=z.object({organizationId:z.string().min(1).max(128),locationId:z.string().min(1).max(128),station:z.enum(['make_line','oven','expeditor'])}).strict();
const encoder=new TextEncoder();

export async function GET(request:Request){
 const parsed=querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
 if(!parsed.success)return new Response('invalid_scope',{status:400});
 const user=await staffSessionUser(request.headers.get('cookie'));const device=!user?await productionDeviceSession(db(),request):null;if(!user&&!device)return new Response('unauthorized',{status:401});
 await ensureSeed();const scope=device?.scope||await loadStaffScope(db(),user!.id,{organizationId:parsed.data.organizationId,locationId:parsed.data.locationId});
 if(!scope||!canOperateStation(scope,parsed.data.station,'read'))return new Response('forbidden',{status:403});
 let closed=false;let timer:number|undefined;let closeTimer:number|undefined;
 const stream=new ReadableStream<Uint8Array>({start(controller){
  const send=(event:string,data:unknown)=>{if(!closed)controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));};
  const close=()=>{if(closed)return;closed=true;if(timer!==undefined)clearInterval(timer);if(closeTimer!==undefined)clearTimeout(closeTimer);try{controller.close();}catch{}}
  const poll=async()=>{try{
    const snapshot=await db().prepare(`SELECT COUNT(*) AS count,COALESCE(MAX(t.updated_at),'') AS updatedAt,COALESCE(MAX(t.revision),0) AS revision
      FROM production_tickets t JOIN orders o ON o.id=t.order_id AND o.organization_id=t.organization_id AND o.location_id=t.location_id
      WHERE t.organization_id=? AND t.location_id=? AND o.status IN ('preparing','ready')`).bind(parsed.data.organizationId,parsed.data.locationId).first<{count:number;updatedAt:string;revision:number}>();
    send('tickets',{count:Number(snapshot?.count||0),updatedAt:snapshot?.updatedAt||'',revision:Number(snapshot?.revision||0)});
   }catch{send('error',{retry:true});}}
  void poll();timer=setInterval(()=>{void poll();},4000) as unknown as number;closeTimer=setTimeout(close,55000) as unknown as number;request.signal.addEventListener('abort',close,{once:true});
 },cancel(){closed=true;if(timer!==undefined)clearInterval(timer);if(closeTimer!==undefined)clearTimeout(closeTimer);}});
 return new Response(stream,{status:200,headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'}});
}
