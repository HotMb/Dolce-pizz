#!/usr/bin/env node
/* Validate production configuration without printing secret values. */
const failures = [];
const publicHost = /^(?=.{1,253}$)(?!localhost$)(?!.*\.dolcepizza\.workers\.dev$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const required = (name, minimum) => {
  const value = process.env[name]?.trim() || '';
  if (value.length < minimum) failures.push(`${name} absent ou trop court (minimum ${minimum})`);
};

required('ADMIN_SETUP_CODE', 20);
required('MARKETING_STOP_SECRET', 32);
required('NOTIFICATION_DISPATCH_SECRET', 32);
required('BREVO_API_KEY', 20);
required('SMS_SENDER', 1);
if (!/^[A-Za-z][A-Za-z0-9 ]{0,10}$/.test(process.env.SMS_SENDER?.trim() || '')) failures.push('SMS_SENDER doit commencer par une lettre et contenir au plus 11 caractères alphanumériques ou espaces');
if (process.env.SMS_CAMPAIGNS_DEMO === '1' || process.env.SMS_DEMO === '1') failures.push('les modes SMS de démonstration doivent être désactivés');
if (!process.env.CF_D1_DATABASE_ID?.trim()) failures.push('CF_D1_DATABASE_ID absent');
if (!process.env.CF_WORKER_NAME?.trim()) failures.push('CF_WORKER_NAME absent');
const publicBase = process.env.PUBLIC_BASE_URL?.trim() || '';
try {
  const parsed = new URL(publicBase);
  if (parsed.protocol !== 'https:' || !publicHost.test(parsed.hostname) || parsed.pathname !== '/' || parsed.search || parsed.hash) failures.push('PUBLIC_BASE_URL doit être une URL HTTPS publique sans chemin ni paramètres');
} catch { failures.push('PUBLIC_BASE_URL absent ou invalide'); }
if (process.env.TENANT_HOSTS_JSON) {
  try {
    const bindings = JSON.parse(process.env.TENANT_HOSTS_JSON);
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings) || !Object.keys(bindings).length) failures.push('TENANT_HOSTS_JSON doit contenir au moins un domaine');
    const normalizedHosts = new Set();
    for (const [host, value] of Object.entries(bindings || {})) {
      const normalizedHost = host.toLowerCase();
      const validId = (candidate) => typeof candidate === 'string' && /^[a-z0-9][a-z0-9_-]{0,127}$/.test(candidate);
      if (!publicHost.test(normalizedHost) || normalizedHosts.has(normalizedHost) || !value || typeof value !== 'object' || !validId(value.organizationId) || !validId(value.locationId)) failures.push(`liaison tenant invalide pour ${host}`);
      normalizedHosts.add(normalizedHost);
    }
  } catch { failures.push('TENANT_HOSTS_JSON n’est pas un JSON valide'); }
} else failures.push('TENANT_HOSTS_JSON absent');

if (failures.length) {
  console.error('Préflight production refusé :');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Préflight production réussi : secrets, mode SMS, base D1 et domaines sont configurés.');
