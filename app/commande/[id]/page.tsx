import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../../member-ui';
import {Tracking} from './tracking';
export const dynamic='force-dynamic';export const metadata:Metadata={title:'Suivre ma commande'};
export default async function Page({params}:{params:Promise<{id:string}>}){const user=await currentUser();const{id}=await params;return user?<Tracking id={id}/>:<AuthGate title="Retrouvez votre commande." text="Connectez-vous avec le numéro de mobile utilisé pour envoyer cette commande." href={loginPath(`/commande/${encodeURIComponent(id)}`)}/>;}
