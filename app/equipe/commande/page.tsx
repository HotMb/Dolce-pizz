import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../../member-ui';
import {StaffOrderComposer} from './order-composer';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Nouvelle commande'};

export default async function Page(){
 const user=await currentUser();
 if(!user)return <AuthGate title="Caisse équipe." text="Connectez-vous pour saisir une commande du comptoir ou du centre d’appels." href={loginPath('/equipe/commande')}/>;
 return <StaffOrderComposer/>;
}
