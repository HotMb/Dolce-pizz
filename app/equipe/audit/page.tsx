import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../../member-ui';
import {AuditClient} from './audit-client';
import '../staff.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Audit des accès'};
export default async function Page(){const user=await currentUser();if(!user)return <AuthGate title="Audit des accès." text="Connectez-vous avec le compte propriétaire de l’enseigne." href={loginPath('/equipe/audit')}/>;return <AuditClient/>;}
