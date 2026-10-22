import type {Metadata} from 'next';
import {currentUser,localPhone} from '@/lib/auth';
import {Checkout} from './checkout';
import {AuthGate,loginPath} from '../member-ui';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Commander à emporter',description:'Choisissez votre créneau de retrait chez Dolce Pizz’ à Ronchin.'};
export default async function Page(){const user=await currentUser();return user?<Checkout user={{name:user.name,phone:localPhone(user.phone)}}/>:<AuthGate title="Votre commande vous attend." text="Connectez-vous avec votre numéro de mobile pour choisir un créneau, suivre la confirmation de la pizzeria et cumuler vos points fidélité." href={loginPath('/commander')}/>;}
