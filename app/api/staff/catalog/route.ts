import {NextResponse} from 'next/server';
import {z} from 'zod';
import {sessionUser} from '@/lib/auth';
import {db, ingredientList, productList, settings} from '@/lib/server';
import {loadStaffScope} from '@/lib/staff-access';
import {hasStaffOrderAccess} from '@/lib/staff-orders';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, {status, headers: {'Cache-Control': 'no-store'}});
class CatalogApiError extends Error {
  constructor(public status: number, message: string) {super(message);}
}

export async function GET(request: Request) {
  try {
    const user = await sessionUser(request.headers.get('cookie'));
    if (!user) throw new CatalogApiError(401, 'Connectez-vous avec un compte de l’équipe.');
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some(key => !['organizationId', 'locationId'].includes(key))
      || [...new Set(url.searchParams.keys())].some(key => url.searchParams.getAll(key).length !== 1)) {
      throw new CatalogApiError(400, 'La sélection d’établissement est invalide.');
    }
    const scope = z.object({organizationId: z.string().min(1).max(128), locationId: z.string().min(1).max(128)}).strict()
      .safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!scope.success) throw new CatalogApiError(400, 'Sélectionnez un établissement valide.');
    const access = await loadStaffScope(db(), user.id, scope.data);
    if (!access || !hasStaffOrderAccess(access.roles)) throw new CatalogApiError(403, 'Vous n’avez pas accès à la carte de cet établissement.');

    const [products, ingredients, currentSettings] = await Promise.all([
      productList(false, scope.data.organizationId), ingredientList(scope.data.organizationId), settings(scope.data.organizationId,scope.data.locationId),
    ]);
    return json({products, ingredients, extraPrice: currentSettings.extraPrice});
  } catch (error) {
    if (error instanceof CatalogApiError) return json({error: error.message}, error.status);
    console.error('Staff catalogue request failed:', error instanceof Error ? error.message : 'unknown error');
    return json({error: 'La carte de cet établissement est momentanément indisponible.'}, 503);
  }
}
