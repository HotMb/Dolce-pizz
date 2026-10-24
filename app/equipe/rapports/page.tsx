import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../../member-ui';
import {ReportsClient} from './reports-client';
import '../staff.css';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Rapports enseigne'};

export default async function Page(){
 const user=await currentUser();
 if(!user)return <AuthGate title="Rapports enseigne." text="Connectez-vous pour consulter les résultats de vos établissements." href={loginPath('/equipe/rapports')}/>;
 return <ReportsClient/>;
}
