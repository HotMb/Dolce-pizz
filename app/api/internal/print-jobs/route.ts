import {handlePrintOutboxRequest} from '@/lib/print-outbox';
export const dynamic='force-dynamic';
export async function POST(request:Request){return handlePrintOutboxRequest(request);}
