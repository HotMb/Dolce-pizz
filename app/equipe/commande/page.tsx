import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../../member-ui';
import {StaffOrderComposer} from './order-composer';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Nouvelle commande'};

export default async function Page({searchParams}:{searchParams:Promise<{device?:string;channel?:string}>}){
 const user=await currentUser();
 const params=await searchParams;
 const fixedChannel=params.channel==='pos'?'pos':params.channel==='phone'?'phone':undefined;
 if(!user&&params.device==='1')return <StaffOrderComposer deviceMode fixedChannel={fixedChannel}/>;
 if(!user)return <AuthGate title="Caisse équipe." text="Connectez-vous pour saisir une commande du comptoir ou du centre d’appels." href={loginPath('/equipe/commande')}/>;
 return <StaffOrderComposer fixedChannel={fixedChannel}/>;
}
