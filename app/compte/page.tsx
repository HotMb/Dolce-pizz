import type {Metadata} from 'next';
import {getChatGPTUser,chatGPTSignInPath} from '@/app/chatgpt-auth';
import {AuthGate} from '../member-ui';
import {Account} from './account';
export const dynamic='force-dynamic';export const metadata:Metadata={title:'Mon compte fidélité'};
export default async function Page(){const user=await getChatGPTUser();return user?<Account/>:<AuthGate title="Le club Dolce, c’est ici." text="Connectez-vous pour retrouver vos commandes, suivre leur préparation et consulter votre fidélité." href={chatGPTSignInPath('/compte')}/>;}
