import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../member-ui';
import {AdminEntry} from './admin';
export const dynamic='force-dynamic';export const metadata:Metadata={title:'Espace équipe'};
export default async function Page(){const user=await currentUser();return user?<AdminEntry/>:<AuthGate title="Espace réservé à l’équipe." text="Connectez-vous avec le numéro de mobile qui gère Dolce Pizz’." href={loginPath('/admin')}/>;}
