import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../../member-ui';
import {DomainsClient} from './domains-client';
import '../staff.css';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Domaines de l’enseigne'};

export default async function Page(){
 const user=await currentUser();
 if(!user)return <AuthGate title="Domaines de l’enseigne." text="Connectez-vous pour vérifier les domaines publics de vos établissements." href={loginPath('/equipe/domaines')}/>;
 return <DomainsClient/>;
}
