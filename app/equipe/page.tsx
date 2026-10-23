import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../member-ui';
import {StaffHome} from './staff-home';
import './staff.css';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Espace équipe'};

export default async function Page(){
 const user=await currentUser();
 if(!user)return <AuthGate title="Espace équipe." text="Connectez-vous à votre compte pour retrouver vos établissements et vos postes de travail." href={loginPath('/equipe')}/>;
 return <StaffHome/>;
}
