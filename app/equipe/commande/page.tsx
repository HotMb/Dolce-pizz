import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../../member-ui';
import {StaffOrderComposer} from './order-composer';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Nouvelle commande'};

export default async function Page({searchParams}:{searchParams:Promise<{device?:string}>}){
 const user=await currentUser();
 const params=await searchParams;
 if(!user&&params.device==='1')return <StaffOrderComposer deviceMode/>;
 if(!user)return <AuthGate title="Caisse équipe." text="Connectez-vous pour saisir une commande du comptoir ou du centre d’appels." href={loginPath('/equipe/commande')}/>;
 return <StaffOrderComposer/>;
}
