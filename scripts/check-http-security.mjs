#!/usr/bin/env node
/* Verify security headers on the deployed public origin without logging response bodies. */
const argument = process.argv.slice(2).find(value => value.startsWith('--url='));
const rawUrl = argument?.slice('--url='.length) || process.env.PUBLIC_BASE_URL || '';
if (!rawUrl) {
  console.error('Usage : npm run security:http -- --url=https://restaurant.example.fr');
  process.exit(2);
}

let url;
try { url = new URL(rawUrl); } catch { console.error('URL publique invalide.'); process.exit(2); }
const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
if (url.protocol !== 'https:' && !local) {
  console.error('Le contrôle distant exige HTTPS (HTTP est accepté uniquement en local).');
  process.exit(1);
}

const response = await fetch(url, {redirect: 'manual', signal: AbortSignal.timeout(10000)}).catch(() => null);
if (!response) { console.error('Origine publique inaccessible.'); process.exit(1); }
if (response.status >= 300 && response.status < 400) { console.error('L’origine répond par une redirection; contrôlez le domaine final directement.'); process.exit(1); }

const required = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
const failures = Object.entries(required).filter(([name, expected]) => response.headers.get(name)?.trim() !== expected).map(([name, expected]) => `${name} doit valoir ${expected}`);
if (failures.length) {
  console.error('Contrôle des en-têtes HTTP refusé :');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Contrôle des en-têtes HTTP réussi (${response.status}).`);
