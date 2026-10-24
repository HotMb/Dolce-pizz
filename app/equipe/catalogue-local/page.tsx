import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../../member-ui';
import {LocalCatalogClient} from './local-catalog-client';
import '../staff.css';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Carte par établissement'};

export default async function Page(){
 const user=await currentUser();
 if(!user)return <AuthGate title="Carte locale." text="Connectez-vous pour régler la disponibilité et les prix de vos établissements." href={loginPath('/equipe/catalogue-local')}/>;
 return <LocalCatalogClient/>;
}
