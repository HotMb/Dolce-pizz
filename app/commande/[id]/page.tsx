import type {Metadata} from 'next';
import {getChatGPTUser,chatGPTSignInPath} from '@/app/chatgpt-auth';
import {AuthGate} from '../../member-ui';
import {Tracking} from './tracking';
export const dynamic='force-dynamic';export const metadata:Metadata={title:'Suivre ma commande'};
export default async function Page({params}:{params:Promise<{id:string}>}){const user=await getChatGPTUser();const{id}=await params;return user?<Tracking id={id}/>:<AuthGate title="Retrouvez votre commande." text="Connectez-vous avec le compte utilisé pour envoyer cette commande." href={chatGPTSignInPath(`/commande/${encodeURIComponent(id)}`)}/>;}
