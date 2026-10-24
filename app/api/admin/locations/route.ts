import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/server';
import {defaultSettings} from '@/lib/rules';
import {sessionUser, underLimit} from '@/lib/auth';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, {status, headers: {'Cache-Control': 'no-store'}});
class ApiError extends Error {constructor(public status: number, message: string) {super(message);}}
const id = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/);
const locationInput = z.object({organizationId: id, locationId: id, locationCode: id, locationName: z.string().trim().min(2).max(120), addressLine1: z.string().trim().min(3).max(160), postalCode: z.string().regex(/^\d{5}$/), locality: z.string().trim().min(2).max(80), phone: z.string().trim().max(30)}).strict();
const owner = async (userId: string, organizationId: string) => !!await db().prepare("SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id AND o.status='active' WHERE m.organization_id=? AND m.principal_id=? AND m.role='owner' AND m.location_id IS NULL AND m.status='active'").bind(organizationId, userId).first();
const normalizeLocationPhone = (raw: string) => {
  const compact = raw.replace(/[\s.\-()]/g, '');
  const digits = compact.startsWith('+33') ? compact.slice(3) : compact.startsWith('0033') ? compact.slice(4) : compact.startsWith('0') ? compact.slice(1) : '';
  return /^\d{9}$/.test(digits) && digits[0] !== '0' ? `+33${digits}` : null;
};

/** Return only sites belonging to an organization owned by the caller. */
export async function GET(request: Request) {
  try {
    const user = await sessionUser(request.headers.get('cookie')); if (!user) throw new ApiError(401, 'Connectez-vous pour consulter les établissements.');
    const organizationId = new URL(request.url).searchParams.get('organizationId') || '';
    if (!id.safeParse(organizationId).success || !await owner(user.id, organizationId)) throw new ApiError(403, 'Cette action est réservée au propriétaire de l’enseigne.');
    const rows = await db().prepare('SELECT id,code,name,status,address_line1,postal_code,locality,phone,country_code,timezone,created_at,updated_at FROM locations WHERE organization_id=? ORDER BY name,id').bind(organizationId).all();
    return json({organizationId, locations: rows.results});
  } catch (error) {if (error instanceof ApiError) return json({error: error.message}, error.status); return json({error: 'Impossible de charger les établissements.'}, 503);}
}

/** Add a pickup site without creating a second tenant or bypassing owner scope. */
export async function POST(request: Request) {
  try {
    const url = new URL(request.url); if (request.headers.get('origin') !== url.origin) throw new ApiError(403, 'Cette demande doit être envoyée depuis le site.');
    const user = await sessionUser(request.headers.get('cookie')); if (!user) throw new ApiError(401, 'Connectez-vous avant d’ajouter un établissement.');
    const ip = request.headers.get('cf-connecting-ip') || 'local'; if (!await underLimit(`locations:${user.id}:${ip}`, 10)) throw new ApiError(429, 'Trop de tentatives. Réessayez plus tard.');
    const length = Number(request.headers.get('content-length') || 0); if (Number.isFinite(length) && length > 8000) throw new ApiError(413, 'La demande est trop volumineuse.');
    const raw = await request.text(); if (raw.length > 8000) throw new ApiError(413, 'La demande est trop volumineuse.');
    let input: z.infer<typeof locationInput>; try {input = locationInput.parse(JSON.parse(raw));} catch (error) {if (error instanceof z.ZodError) return json({error: error.issues[0]?.message || 'Vérifiez les informations.'}, 400); throw new ApiError(400, 'La demande est illisible.');}
    if (!await owner(user.id, input.organizationId)) throw new ApiError(403, 'Cette action est réservée au propriétaire de l’enseigne.');
    const phone = normalizeLocationPhone(input.phone); if (!phone) throw new ApiError(400, 'Indiquez un numéro français valide pour l’établissement.');
    const organization = await db().prepare("SELECT id FROM organizations WHERE id=? AND status='active'").bind(input.organizationId).first(); if (!organization) throw new ApiError(404, 'Cette enseigne est introuvable ou inactive.');
    const existing = await db().prepare('SELECT id,organization_id,code,status FROM locations WHERE id=? OR (organization_id=? AND code=?)').bind(input.locationId, input.organizationId, input.locationCode).first<{id:string;organization_id:string;code:string;status:string}>();
    if (existing && !(existing.id === input.locationId && existing.organization_id === input.organizationId && existing.status === 'unconfigured')) throw new ApiError(409, 'Cet identifiant ou code d’établissement existe déjà.');
    const now = new Date().toISOString();
    const results = await db().batch([
      existing
        ? db().prepare("UPDATE locations SET code=?,name=?,status='active',address_line1=?,postal_code=?,locality=?,phone=?,country_code='FR',timezone='Europe/Paris',updated_at=? WHERE id=? AND organization_id=? AND status='unconfigured' AND EXISTS(SELECT 1 FROM organization_memberships WHERE organization_id=? AND principal_id=? AND location_id IS NULL AND role='owner' AND status='active')").bind(input.locationCode, input.locationName, input.addressLine1, input.postalCode, input.locality, phone, now, input.locationId, input.organizationId, input.organizationId, user.id)
        : db().prepare("INSERT INTO locations(id,organization_id,code,name,status,address_line1,postal_code,locality,phone,country_code,timezone,created_at,updated_at) SELECT ?,?,?,?,'active',?,?,?,?, 'FR','Europe/Paris',?,? WHERE EXISTS(SELECT 1 FROM organization_memberships WHERE organization_id=? AND principal_id=? AND location_id IS NULL AND role='owner' AND status='active')").bind(input.locationId, input.organizationId, input.locationCode, input.locationName, input.addressLine1, input.postalCode, input.locality, phone, now, now, input.organizationId, user.id),
      db().prepare('INSERT INTO location_config(organization_id,location_id,value,version) SELECT ?,?,?,1 WHERE EXISTS(SELECT 1 FROM locations WHERE organization_id=? AND id=?) ON CONFLICT(organization_id,location_id) DO NOTHING').bind(input.organizationId, input.locationId, JSON.stringify(defaultSettings), input.organizationId, input.locationId),
    ]);
    if (!results[0]?.meta.changes) throw new ApiError(409, 'L’établissement a changé pendant la création.');
    return json({location: {id: input.locationId, organizationId: input.organizationId, code: input.locationCode, name: input.locationName, status: 'active', addressLine1: input.addressLine1, postalCode: input.postalCode, locality: input.locality, phone, countryCode: 'FR', timezone: 'Europe/Paris'}}, 201);
  } catch (error) {if (error instanceof ApiError) return json({error: error.message}, error.status); console.error('Location provisioning error', error instanceof Error ? error.message : 'unknown'); return json({error: 'La création de l’établissement a échoué.'}, 503);}
}
