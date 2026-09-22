import type {Metadata} from 'next';
import {getChatGPTUser,chatGPTSignInPath} from '@/app/chatgpt-auth';
import {Checkout} from './checkout';
import {AuthGate} from '../member-ui';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Commander à emporter',description:'Choisissez votre créneau de retrait chez Dolce Pizz’ à Ronchin.'};
export default async function Page(){const user=await getChatGPTUser();return user?<Checkout user={{name:user.displayName,email:user.email}}/>:<AuthGate title="Votre commande vous attend." text="Connectez-vous pour choisir un créneau, suivre la confirmation de la pizzeria et cumuler vos avantages fidélité." href={chatGPTSignInPath('/commander')}/>;}
