import type {Metadata} from 'next';
import Link from 'next/link';
import {currentUser} from '@/lib/auth';
import {isAdmin} from '@/lib/server';
import {AuthGate,loginPath} from '../member-ui';
import {Kitchen} from './kitchen';
export const dynamic='force-dynamic';export const metadata:Metadata={title:'Écran cuisine'};
export default async function Page(){
 const user=await currentUser();
 if(!user)return <AuthGate title="Écran cuisine." text="Connectez-vous avec le numéro de l’équipe pour recevoir les tickets de préparation." href={loginPath('/cuisine')}/>;
 if(!(await isAdmin(user.id)))return <main id="contenu" className="page-shell"><div className="panel auth-panel"><h1>Accès réservé à l’équipe.</h1><p>Ce compte n’est pas autorisé à ouvrir le poste cuisine. Demandez au responsable de votre établissement de vérifier vos droits.</p><Link className="text-link" href="/">Retour au site</Link></div></main>;
 return <Kitchen/>;
}
