import type {Metadata} from 'next';
import {currentUser} from '@/lib/auth';
import {AuthGate, loginPath} from '../../member-ui';
import {LocationsClient} from './locations-client';
import '../staff.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {title: 'Établissements de l’enseigne'};

export default async function Page() {
  const user = await currentUser();
  if (!user) return <AuthGate title="Établissements de l’enseigne." text="Connectez-vous pour gérer les sites de votre enseigne." href={loginPath('/equipe/etablissements')} />;
  return <LocationsClient />;
}
