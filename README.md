# Dolce Pizz’ — prototype de commande et fondations POS/KDS

Ce dépôt contient la commande web à emporter de Ronchin, un KDS persistant Make Line/Four/Expeditor, des accès nominatifs par organisation/site/poste, des profils clients/fidélité/campagnes isolés par enseigne et un consommateur de SMS « commande prête ». Le consommateur nécessite des secrets et un ordonnanceur serveur; aucun SMS réel n’est envoyé par les tests. POS complet, bornes, paiement au retrait, Uber Eats, menu par site et fonctionnement hors ligne restent à construire avant une offre SaaS de production.

> **Clone de travail Dolce Pizz’.** L’historique de `main` commence par `Build Dolce Pizz online ordering site`; le code, l’organisation `dolce-pizza`, le site `ronchin` et le script de mise en ligne ciblent Dolce Pizz’ et le Worker `dolce-pizz-demo`. Le libellé **Pizza Delizio — Commande & fidélité** correspond au projet Sites du clone utilisé pour modifier ce code, pas à la marque de l’application. La branche de travail est `codex/dolce-pos-saas-foundation`. Le Worker public reste une cible distincte : une mise en ligne doit être vérifiée séparément. Détails : [état des exigences](docs/implementation-status.md) et [revue de sécurité](docs/security-review.md).

- [Architecture cible et étapes](docs/architecture.md)
- [Installation et exploitation](docs/installation.md)
- [Offre produit et mise en service](docs/offre-commerciale.md)
- [Revue de sécurité et limites connues](docs/security-review.md)
- [État des exigences du produit complet](docs/implementation-status.md)
- [Accès de l’équipe et contrat API](docs/staff-api.md)
- [SMS de commande prête et exploitation de l’outbox](docs/notifications.md)

## Dolce Pizz’ configuration

Customers and staff sign in with a French mobile number and a 6-digit SMS code (see `lib/auth.ts`); the site no longer uses Sign in with ChatGPT, so it must be hosted as a public site.

| Secret | Purpose |
|---|---|
| `BREVO_API_KEY` | Brevo transactional SMS key. Without it, production refuses to send codes; loopback previews show the code on screen instead. |
| `SMS_SENDER` | Optional SMS sender name, 11 characters max (default `DolcePizz`). |
| `ADMIN_SETUP_CODE` | Private code (20+ characters) that grants the admin role to the first account that enters it on `/admin`. |
| `MARKETING_STOP_SECRET` | Separate random signing secret for recipient-bound marketing unsubscribe links. Keep it stable so links already sent remain usable. |
| `SMS_CAMPAIGNS_DEMO` | Optional `1` to simulate promotional SMS campaigns without sending messages. It never exposes login codes. |
| `NOTIFICATION_DISPATCH_SECRET` | Separate 32–256 character random secret for the server scheduler calling the ready-SMS consumer. Never put it in a browser or URL. |

For a local preview, put these in an ignored `.env.local`, apply pending migrations with `npm run db:migrate:local`, and start the dev server with Node 22+ using `node --env-file=.env.local scripts/run-framework.mjs dev`.

L’équipe valide les commandes sur `/admin` (les points sont alors crédités) et les envoie en production. `/equipe` affiche les établissements et postes autorisés; le propriétaire y attribue ou retire les accès nominatifs. Le KDS vérifie une adhésion active et les permissions du poste à chaque action; l’ancien rôle admin seul ne suffit plus. La migration `0005` convertit les administrateurs historiques du pilote en propriétaires de Dolce Pizz’; une installation neuve crée ce propriétaire lors de l’activation initiale par code privé. `/cuisine` redirige vers `/production`. La caisse et l’encaissement au retrait restent à livrer.

**Menu, ingredients and allergens.** The database is the only source of the menu (`lib/seed.ts` is the opening menu, written once). In `/admin`, the team adds, edits or deletes a product in **Carte** (recipe, prices, allergens, tagline, "2e offerte", photo); a product already ordered is archived rather than deleted, so past orders stay exact. **Ingrédients** holds each ingredient's allergens, its availability (out of stock tonight) and whether it is sold as a supplement; **Origines** holds meat origins (décret n° 2022-65), shown on each pizza and on `/allergenes`. Customers remove ingredients for free and add supplements at the single price set in **Réglages** (`extraPrice`, cents); the kitchen ticket prints the changes in capitals. Allergen data is prefilled from the printed menu and must be checked by the owner ("J’ai vérifié les allergènes").

**Photos from the admin.** The tablet finds the pizza, centres and cuts it out, and uploads 320/640/1024 px WebP files (`app/admin/photo-tools.ts`, same treatment as `npm run photos`). They are stored in D1 (`product_photos`, no R2 bucket needed) and served by `/api/photos/<id>/<version>/<width>` with a one-year cache; each upload gets a new version.

**Promotional SMS.** Customers opt in (never pre-ticked) at sign-up, at checkout or in Mon compte. The current state is stored in `customer_profiles` for one organization and every change appends an immutable `marketing_consent_events` record. `/stop` unsubscribes only from the organization that signed the link; `MARKETING_STOP_SECRET` is mandatory and never falls back to the admin setup code. **Promos SMS** in `/admin` composes a message, then sends only to that organization’s opted-in profiles through Brevo (`type: marketing`) in batches of 20, Monday to Saturday 8:00–20:00. Without `BREVO_API_KEY`, local previews and a hosted prototype with `SMS_CAMPAIGNS_DEMO=1` simulate sending; no promotional messages are sent.

**Local database.** `lancer-site.cmd` (or `npm run db:migrate:local`) applies the pending `drizzle/*.sql` files to the local preview database before starting the dev server.

**Pizza photos.** Originals live in `assets-src/pizzas/<recipe-id>.(png|jpg|webp)`; `npm run photos` centres, cuts out and exports them to `public/assets/pizzas/<id>-{320,640,1024}.webp` and regenerates `lib/pizza-photos.ts`. Recipes without a photo show a named placeholder and stay off the home wheel. `assets-src/pizzas/A-GENERER.md` lists the missing ones with generation prompts. `npm test` runs the pricing, slot and lifecycle tests.

**Prototype on your own Cloudflare account.** `mettre-en-ligne-demo.cmd` (or `node scripts/deploy-demo.mjs` with Node 22+) signs in to Cloudflare, creates the `dolce-pizz-demo` D1 database, builds with `CF_WORKER_NAME`/`CF_D1_DATABASE_ID`, applies `drizzle/*.sql` once each, deploys, and stores `ADMIN_SETUP_CODE` in the ignored local `.env.demo` before provisioning it to the Worker. The script never prints the code; retrieve it only from that local file and do not share deployment logs containing secrets. The public demo keeps promotional SMS in simulation mode by default (`SMS_CAMPAIGNS_DEMO=1`), while hosted sign-in codes are never returned by the API: configure `BREVO_API_KEY` to enable hosted authentication. Without it, only loopback development can display a login code. Run the same command again to publish updates.

## Prerequisites

- Node.js `>=22.13.0`
- Portable: Windows, macOS, or Linux; no Bash required
- Managed Linux: managed Linux runtime with Bash, `flock`, `curl`, `sha256sum`, and GNU `timeout`
- Git is required only for publishing

## Sites Lifecycle

The Sites initializer copies the shared starter and selects managed-linux only when `SITES_MANAGED_LINUX_CONTAINER=1`; otherwise it selects portable. It saves the selection only in ignored `.sites-runtime/execution-profile.json`. Both profiles copy/configure first, then use the plugin's separate `install-dependencies.mjs` step to measure installation independently. Edit source under `app/` and follow the Sites skill for installation, preview, builds, and publishing.

Run `node <plugin-root>/scripts/configure-execution-profile.mjs` only when the profile is unknown for the current checkout and environment. Profile changes do not alter tracked source or require reinstalling otherwise-valid dependencies; restart an existing preview to use the new selection. Do not commit or upload `.sites-runtime/`.

This starter does not use `wrangler.jsonc`.

`install:ci` runs `npm ci` once against the shared lockfile, disables parent-workspace discovery, and includes required dev/optional dependencies despite production/omit settings. Sharp defaults to prebuilt binaries unless explicitly configured otherwise. Do not overlap installers.

- **Portable:** Preserve host HOME, npm cache, registry, proxy, temporary paths, retry/concurrency settings, and lifecycle-script policy. Use `--prefer-offline --no-audit --no-fund`.
- **Managed Linux:** Use the existing project-local HOME/cache/tmp setup and Linux install lock, tarball preflight, and timeout. Restore the image-seeded npm cache only when its lockfile hash matches; retain network fallback. Builds keep their existing timeout. These helpers are not invoked by the portable profile.

`scripts/sites-env.mjs` preserves the caller's HOME, npm cache, proxy, XDG, and temporary-directory configuration while defaulting Wrangler and Miniflare state to the checkout. If npm reports an unwritable cache, select a writable path with `npm_config_cache` for that install. The `dev` and `start` scripts also keep Wrangler logs inside the checkout. Generated `.sites-runtime/` and `.wrangler/` directories are disposable and ignored by Git.

On portable, `npm run dev` uses `vinext dev` with HMR, starting at port 5173. Vinext records the running server in ignored `.vinext/` state, rejects an ordinary duplicate launch, and recovers stale state after a stopped process; exactly simultaneous starts can race. Pass `--port <port>` or `--hostname <host>` after `npm run dev --` when needed; keep portable previews on loopback.

For browser QA on managed Linux, use `sites-preview start`. The project's dev script runs Vite and accepts the supervisor's `--host 0.0.0.0 --port 4173 --strictPort` arguments. The internal browser uses `http://terminal.local:4173/`; it is not a user-facing URL. The supervisor owns the preview lifecycle. The ignored local profile survives the supervisor's cleared process environment.

The portable profile simulates ChatGPT sign-in only for loopback development requests. Visit `/signin-with-chatgpt?return_to=/` to sign in as `local_seedy` (`seedy@sites.test`, display name `Seedy`) and `/signout-with-chatgpt?return_to=/` to sign out. The development cookie preserves that identity across server restarts. Mock auth is disabled in the managed-linux profile and is not included in production builds; hosted authentication remains dispatch-owned.

The Worker uses `vinext/server/fetch-handler`, including Vinext's config-aware image handling. After building, `npm start` runs that Worker locally through Wrangler on `127.0.0.1`, sharing `.wrangler/state` with dev preview and local D1 migrations; it does not deploy the site or simulate sign-in. Use the URL printed by the server. Pass `npm start -- --port <port>` to select a different built-preview port.

Local previews use Miniflare's placeholder `Request.cf` metadata without a network lookup. Set `CLOUDFLARE_CF_FETCH_ENABLED=true` to opt into fetching preview metadata; this setting does not change hosted request metadata.

Local tool usage metrics are disabled by default. Set `WRANGLER_SEND_METRICS=true` to opt in.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `@cloudflare/workers-types` provides Worker types; `cloudflare-env.d.ts` declares optional `DB`/`BUCKET` bindings—update these declarations if binding names change
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Use it as the durable user key; use email and name for display or contact purposes.

SIWC-authenticated workspace sites may also receive `oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty `name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use the returned `userId` as the stable user key for user-owned records; do not use email as a durable identifier.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send anonymous visitors through Sign in with ChatGPT.
- In a Server Component, start sign-in with `<a href={chatGPTSignInPath(returnTo)} target="_top">`. The auth helper module is server-only; do not import it into a Client Component.
- Do not use `fetch`, XHR, a client-side router, or a framework link that can prefetch the sign-in route. SIWC must start as a top-level navigation.
- Never request the AuthAPI authorization endpoint directly. The dispatch-owned `/signin-with-chatgpt` route must start the SIWC flow.
- Use `chatGPTSignOutPath(returnTo)` for browser sign-out links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the OAuth cookies, and identity header injection. Do not implement app routes for those reserved paths. Routes that do not import and call the helper remain anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the Sites hosting platform's access policy controls for workspace-wide restrictions, or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write actions tied to the current ChatGPT user. Leave public content anonymous.

## Local D1 migrations

For a D1-backed local preview, generate SQL with `npm run db:generate`. Build once through the Sites skill's build entrypoint (or `npm run build` for standalone use) to generate `dist/server/wrangler.json`, rebuilding if bindings change. From the project root, apply each pending migration in order:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_example.sql
```

Replace the filename with the pending migration and `DB` with your D1 binding name if different. Use `.wrangler/state`, not `.wrangler/state/v3`; Wrangler adds the versioned directories. Do not replay migrations already applied locally. This updates only the preview database; publishing applies production migrations separately.

## Diagnostic Commands

- `npm run install:ci`: perform the one locked dependency install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run start`: preview the built Worker locally with D1/R2 support
- `npm run db:generate`: generate Drizzle migrations after schema changes

When using the Sites plugin, follow its skill instructions for installation, builds, and publishing. These npm commands remain available for standalone use.

The portable build runs Vinext directly without a host `timeout` command. The managed-linux build uses `scripts/build-verified.sh` and its existing `SITES_BUILD_TIMEOUT` setting.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
