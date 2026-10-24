import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../../member-ui';
import {Cashier} from './cashier';
import '../staff.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {title: 'Caisse — retrait'};

export default async function Page() {
  const user = await currentUser();
  if (!user) return <AuthGate title="Caisse équipe." text="Connectez-vous pour encaisser les commandes retirées." href={loginPath('/equipe/caisse')}/>;
  return <Cashier/>;
}
