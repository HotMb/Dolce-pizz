import type {Metadata} from 'next';
import Link from 'next/link';
import {Banknote,ChefHat,Flame,MonitorSmartphone,PackageCheck,Printer,ShoppingBasket,ShieldCheck} from 'lucide-react';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../member-ui';
import './interne.css';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Exploitation interne'};

const postes=[
 {href:'/equipe/commande',title:'Prise de commande',text:'Comptoir et téléphone : créer la commande, choisir le retrait et encaisser au retrait.',icon:ShoppingBasket},
 {href:'/production?station=make_line',title:'Make Line',text:'Montage des pizzas et préparation manuelle avec modificateurs et allergènes.',icon:ChefHat},
 {href:'/production?station=oven',title:'Four',text:'Ordre d’enfournement, minuteries et validation de cuisson.',icon:Flame},
 {href:'/production?station=expeditor',title:'Expeditor',text:'Réunir les pizzas, boissons et desserts puis déclarer la commande prête.',icon:PackageCheck},
 {href:'/equipe/caisse',title:'Encaissement au retrait',text:'Retrouver une commande prête et enregistrer espèces ou carte.',icon:Banknote},
];

export default async function Page(){
 const user=await currentUser();
 if(!user)return <AuthGate title="Exploitation interne." text="Connectez-vous pour ouvrir les postes de travail de la pizzeria." href={loginPath('/interne')}/>;
 return <main className="internal-shell" id="contenu">
  <header className="internal-heading"><div><p className="internal-eyebrow"><MonitorSmartphone size={17}/> MODE INTERNE · RONCHIN</p><h1>Le service commence ici<span>.</span></h1><p>Un seul serveur local peut alimenter la prise de commande, la production, l’encaissement et les tablettes de la pizzeria.</p></div><Link className="internal-admin" href="/equipe"><ShieldCheck size={17}/> Administration équipe</Link></header>
  <section className="internal-notice"><strong>Avant le service</strong><span>Ouvrez chaque poste sur la tablette prévue, puis vérifiez que toutes les commandes de test apparaissent sur Make Line, Four et Expeditor.</span></section>
  <section className="internal-grid" aria-label="Postes de travail">{postes.map(({href,title,text,icon:Icon})=><Link className="internal-card" href={href} key={title}><Icon size={30}/><h2>{title}</h2><p>{text}</p><span>Ouvrir le poste →</span></Link>)}</section>
  <section className="internal-tools"><Link href="/equipe/sante"><MonitorSmartphone size={20}/> Vérifier les appareils et les files</Link><Link href="/equipe/impression"><Printer size={20}/> Vérifier les tickets imprimés</Link><Link href="/borne"><ShoppingBasket size={20}/> Ouvrir une borne client</Link></section>
  <p className="internal-footnote">Le site de commande en ligne reste volontairement hors de ce parcours jusqu’à la validation complète du fonctionnement en restaurant.</p>
 </main>;
}
