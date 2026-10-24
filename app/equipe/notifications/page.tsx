import {currentUser} from '@/lib/auth';
import {AuthGate,loginPath} from '../../member-ui';
import {NotificationMonitor} from './notifications-client';

export const dynamic='force-dynamic';
export default async function NotificationsPage(){
 const user=await currentUser();
 if(!user)return <AuthGate title="Supervision SMS." text="Connectez-vous avec le compte propriétaire de l’enseigne." href={loginPath('/equipe/notifications')}/>;
 return <NotificationMonitor/>;
}
