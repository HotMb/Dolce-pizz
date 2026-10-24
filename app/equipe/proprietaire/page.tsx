import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../../member-ui';
import {OwnershipClient} from './ownership-client';
import '../staff.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Transférer la propriété'};
export default async function Page(){const user=await currentUser();if(!user)return <AuthGate title="Transfert de propriété." text="Connectez-vous avec le compte propriétaire de l’enseigne." href={loginPath('/equipe/proprietaire')}/>;return <OwnershipClient/>;}
