import {env} from 'cloudflare:workers';
import {db} from '@/lib/server';
import {createD1ReadyNotificationStore, handleReadyNotificationRequest, type ReadyNotificationEnvironment} from '@/lib/ready-notifications';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleReadyNotificationRequest(request, {
    environment: env as unknown as ReadyNotificationEnvironment,
    store: () => createD1ReadyNotificationStore(db()),
  });
}
