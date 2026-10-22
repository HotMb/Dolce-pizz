import type {Metadata} from 'next';
import Link from 'next/link';
import {currentUser} from '@/lib/auth';
import {isAdmin} from '@/lib/server';
import {AuthGate,loginPath} from '../member-ui';
import {ProductionKds} from './production-kds';
import './production.css';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Postes de production'};

type Station='make_line'|'oven'|'expeditor';
const stations:readonly Station[]=['make_line','oven','expeditor'];

export default async function Page({searchParams}:{searchParams:Promise<{station?:string}>}){
 const user=await currentUser();
 if(!user)return <AuthGate title="Postes de production." text="Connectez-vous avec le numéro de l’équipe pour accéder aux écrans de production." href={loginPath('/production')}/>;
 if(!(await isAdmin(user.id)))return <main id="contenu" className="production-denied"><div className="production-denied-card"><p className="production-eyebrow">ACCÈS ÉQUIPE</p><h1>Accès réservé au personnel autorisé.</h1><p>Ce compte ne peut pas ouvrir les postes de production. Demandez au responsable de votre établissement de vérifier vos droits.</p><Link href="/" className="production-back">Retour au site</Link></div></main>;
 const params=await searchParams;
 const station:Station=stations.includes(params.station as Station)?params.station as Station:'make_line';
 return <ProductionKds key={station} station={station}/>;
}
