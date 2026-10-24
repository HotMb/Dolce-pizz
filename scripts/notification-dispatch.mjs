#!/usr/bin/env node
/* Minimal secret-safe scheduler for the ready-SMS outbox. */
const base = process.env.PUBLIC_BASE_URL?.trim() || '';
const secret = process.env.NOTIFICATION_DISPATCH_SECRET?.trim() || '';
if (!base || !secret) {
  console.error('PUBLIC_BASE_URL et NOTIFICATION_DISPATCH_SECRET sont requis.');
  process.exit(2);
}
let endpoint;
try { endpoint = new URL('/api/internal/notifications', base); } catch { console.error('PUBLIC_BASE_URL invalide.'); process.exit(2); }
if (endpoint.protocol !== 'https:' || endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1') {
  console.error('L’ordonnanceur exige une URL HTTPS publique.');
  process.exit(2);
}
const dryRun = process.argv.includes('--dry-run');
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {authorization: `Bearer ${secret}`, 'content-type': 'application/json', accept: 'application/json'},
  body: JSON.stringify({dryRun}),
  redirect: 'error',
  signal: AbortSignal.timeout(75000),
}).catch(() => null);
if (!response) { console.error('Le consommateur SMS est inaccessible.'); process.exit(1); }
if (!response.ok) { console.error(`Le consommateur SMS a répondu ${response.status}.`); process.exit(1); }
console.log(`Consommateur SMS exécuté (${dryRun ? 'dry-run' : 'production'}, HTTP ${response.status}).`);
