import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../member-ui';
import {Account} from './account';
export const dynamic='force-dynamic';export const metadata:Metadata={title:'Mon compte fidélité'};
export default async function Page(){const user=await currentUser();return user?<Account/>:<AuthGate title="Le club Dolce, c’est ici." text="Connectez-vous pour retrouver vos commandes, suivre leur préparation et consulter vos tickets pizza offerte." href={loginPath('/compte')}/>;}
