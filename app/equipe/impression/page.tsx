import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../../member-ui';
import {PrintingMonitor} from './printing-client';
import '../staff.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Supervision impression'};
export default async function Page(){const user=await currentUser();if(!user)return <AuthGate title="Supervision impression." text="Connectez-vous avec le compte propriétaire de l’enseigne." href={loginPath('/equipe/impression')}/>;return <PrintingMonitor/>;}
