import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../../member-ui';
import {HealthClient} from './health-client';
import '../staff.css';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Santé des établissements'};

export default async function Page(){
 const user=await currentUser();
 if(!user)return <AuthGate title="Santé des établissements." text="Connectez-vous avec le compte propriétaire de l’enseigne." href={loginPath('/equipe/sante')}/>;
 return <HealthClient/>;
}
