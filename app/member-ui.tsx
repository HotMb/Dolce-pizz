import {LockKeyhole,ArrowUpRight} from 'lucide-react';
export const loginPath=(returnTo:string)=>`/connexion?retour=${encodeURIComponent(returnTo)}`;
export function AuthGate({title,text,href}:{title:string;text:string;href:string}){return <main id="contenu" className="page-shell"><div className="panel auth-panel"><LockKeyhole size={43}/><h1>{title}</h1><p>{text}</p><a className="btn btn-primary" href={href}>Se connecter par SMS <ArrowUpRight size={18}/></a><p className="auth-note">Un code à 6 chiffres suffit : pas de mot de passe à retenir.</p></div></main>;}
