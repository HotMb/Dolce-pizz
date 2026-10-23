import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../member-ui';
import {ProductionKds} from './production-kds';
import './production.css';
import '../equipe/staff.css';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Postes de production'};

type Station='make_line'|'oven'|'expeditor';
const stations:readonly Station[]=['make_line','oven','expeditor'];

export default async function Page({searchParams}:{searchParams:Promise<{station?:string;organizationId?:string;locationId?:string}>}){
 const user=await currentUser();
 const params=await searchParams;
 const query=new URLSearchParams();
 if(params.organizationId)query.set('organizationId',params.organizationId);
 if(params.locationId)query.set('locationId',params.locationId);
 if(params.station)query.set('station',params.station);
 const returnTo=`/production${query.size?`?${query}`:''}`;
 if(!user)return <AuthGate title="Postes de production." text="Connectez-vous à votre compte pour accéder aux postes qui vous sont attribués." href={loginPath(returnTo)}/>;
 const station=stations.includes(params.station as Station)?params.station as Station:undefined;
 return <ProductionKds key={returnTo} station={station} organizationId={params.organizationId} locationId={params.locationId}/>;
}
