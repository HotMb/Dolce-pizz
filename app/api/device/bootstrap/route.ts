import {NextResponse} from 'next/server';
import {db,ensureSeed} from '@/lib/server';
import {productionDeviceSession} from '@/lib/device-access';

export const dynamic='force-dynamic';

export async function GET(request:Request){
  await ensureSeed();
  const device=await productionDeviceSession(db(),request);
  if(!device)return NextResponse.json({error:'Appareil non autorisé ou jeton expiré.'},{status:401,headers:{'Cache-Control':'no-store'}});
  return NextResponse.json({device:{id:device.deviceId,label:device.label,role:device.role,expiresAt:device.expiresAt},scope:device.scope},{headers:{'Cache-Control':'no-store'}});
}
