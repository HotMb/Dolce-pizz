import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../../member-ui';
import {IntegrationsClient} from './integrations-client';
import '../staff.css';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Intégrations de livraison'};

export default async function Page(){
 const user=await currentUser();
 if(!user)return <AuthGate title="Intégrations de livraison." text="Connectez-vous pour relier les partenaires de votre enseigne." href={loginPath('/equipe/integrations')}/>;
 return <IntegrationsClient/>;
}
