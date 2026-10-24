#!/usr/bin/env node
/* Validate production configuration without printing secret values. */
const failures = [];
const required = (name, minimum) => {
  const value = process.env[name]?.trim() || '';
  if (value.length < minimum) failures.push(`${name} absent ou trop court (minimum ${minimum})`);
};

required('ADMIN_SETUP_CODE', 20);
required('MARKETING_STOP_SECRET', 32);
required('NOTIFICATION_DISPATCH_SECRET', 32);
required('BREVO_API_KEY', 20);
if (process.env.SMS_CAMPAIGNS_DEMO === '1' || process.env.SMS_DEMO === '1') failures.push('les modes SMS de démonstration doivent être désactivés');
if (!process.env.CF_D1_DATABASE_ID?.trim()) failures.push('CF_D1_DATABASE_ID absent');
if (!process.env.CF_WORKER_NAME?.trim()) failures.push('CF_WORKER_NAME absent');
if (process.env.TENANT_HOSTS_JSON) {
  try {
    const bindings = JSON.parse(process.env.TENANT_HOSTS_JSON);
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings) || !Object.keys(bindings).length) failures.push('TENANT_HOSTS_JSON doit contenir au moins un domaine');
    for (const [host, value] of Object.entries(bindings || {})) {
      if (!/^[a-z0-9.-]+$/i.test(host) || !value || typeof value !== 'object' || !('organizationId' in value) || !('locationId' in value)) failures.push(`liaison tenant invalide pour ${host}`);
    }
  } catch { failures.push('TENANT_HOSTS_JSON n’est pas un JSON valide'); }
} else failures.push('TENANT_HOSTS_JSON absent');

if (failures.length) {
  console.error('Préflight production refusé :');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Préflight production réussi : secrets, mode SMS, base D1 et domaines sont configurés.');
