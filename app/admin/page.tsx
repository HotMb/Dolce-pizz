import type {Metadata} from 'next';
import {getChatGPTUser,chatGPTSignInPath} from '@/app/chatgpt-auth';
import {AuthGate} from '../member-ui';
import {AdminEntry} from './admin';
export const dynamic='force-dynamic';export const metadata:Metadata={title:'Espace équipe'};
export default async function Page(){const user=await getChatGPTUser();return user?<AdminEntry/>:<AuthGate title="Espace réservé à l’équipe." text="Connectez-vous avec le compte qui gère Dolce Pizz’." href={chatGPTSignInPath('/admin')}/>;}
