import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../../member-ui';
import {StaffOrderComposer} from '../commande/order-composer';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Centre d’appels · Ronchin'};

export default async function Page(){
 const user=await currentUser();
 if(!user)return <AuthGate title="Centre d’appels." text="Connectez-vous avec le compte autorisé au centre d’appels." href={loginPath('/equipe/centre-appel')}/>;
 return <StaffOrderComposer fixedChannel="phone"/>;
}
