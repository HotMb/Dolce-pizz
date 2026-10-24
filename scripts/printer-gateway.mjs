#!/usr/bin/env node
/*
 * Small local print relay for an enrolled printer_gateway device.
 * It never logs the bearer token. Simulation is the default; use DRY_RUN=0
 * only after the relay has been tested against the chosen ESC/POS printer.
 */
import net from 'node:net';

const endpoint = process.env.PRINT_GATEWAY_URL || '';
const token = process.env.PRINT_GATEWAY_TOKEN || '';
const host = process.env.PRINTER_HOST || '127.0.0.1';
const port = Number(process.env.PRINTER_PORT || 9100);
const dryRun = process.env.DRY_RUN !== '0';
const intervalMs = Math.max(1000, Number(process.env.PRINT_GATEWAY_INTERVAL_MS || 5000));

if (!endpoint || !token) {
  console.error('PRINT_GATEWAY_URL et PRINT_GATEWAY_TOKEN sont requis.');
  process.exit(2);
}
if (!/^https?:\/\//i.test(endpoint) || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('URL du relais ou port imprimante invalide.');
  process.exit(2);
}

const text = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
const money = (cents) => `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',')} €`;
const parseItems = (value) => {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
};
const render = (ticket) => {
  const lines = ['DOLCE PIZZ’', `COMMANDE ${text(ticket.orderId).slice(0, 18)}`, `RETRAIT ${text(ticket.slot)}`, `${text(ticket.customerName)} ${text(ticket.phone)}`];
  for (const item of parseItems(ticket.items)) {
    const quantity = Number(item.quantity || 1);
    lines.push(`${quantity} x ${text(item.name || item.productName || 'Article').slice(0, 38)}`);
    if (item.size && item.size !== 'unique') lines.push(`  Taille: ${text(item.size)}`);
    if (item.option) lines.push(`  ${text(item.option).slice(0, 40)}`);
    if (Array.isArray(item.without) && item.without.length) lines.push(`  Sans: ${item.without.map(text).join(', ').slice(0, 40)}`);
    if (Array.isArray(item.extra) && item.extra.length) lines.push(`  + ${item.extra.map(text).join(', ').slice(0, 40)}`);
  }
  if (ticket.note) lines.push(`NOTE: ${text(ticket.note).slice(0, 120)}`);
  lines.push(`TOTAL ${money(ticket.totalCents)}`, '');
  return lines;
};
const escpos = (lines) => {
  const chunks = [Buffer.from([0x1b, 0x40]), Buffer.from([0x1b, 0x61, 0x01]), Buffer.from('DOLCE PIZZ’\n', 'utf8')];
  chunks.push(Buffer.from([0x1b, 0x61, 0x00]));
  for (const line of lines) chunks.push(Buffer.from(`${line}\n`, 'utf8'));
  chunks.push(Buffer.from('\n\n\n', 'utf8'), Buffer.from([0x1d, 0x56, 0x00]));
  return Buffer.concat(chunks);
};
const printTcp = (buffer) => new Promise((resolve, reject) => {
  const socket = net.createConnection({host, port});
  const timer = setTimeout(() => { socket.destroy(); reject(new Error('printer_timeout')); }, 10000);
  socket.once('error', error => { clearTimeout(timer); reject(error); });
  socket.once('connect', () => socket.end(buffer));
  socket.once('close', () => { clearTimeout(timer); resolve(); });
});

async function request(action, body = {}) {
  const response = await fetch(endpoint, {method: 'POST', headers: {'authorization': `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify({action, ...body})});
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.error || `gateway_http_${response.status}`));
  return payload;
}

async function drain() {
  const result = await request('claim', {limit: 10});
  for (const job of Array.isArray(result.jobs) ? result.jobs : []) {
    try {
      const lines = render(job.ticket || {});
      if (dryRun) console.log(JSON.stringify({jobId: job.id, mode: 'dry_run', lines}));
      else await printTcp(escpos(lines));
      await request('complete', {id: job.id, leaseToken: job.lease_token, providerJobId: dryRun ? `dry-run:${job.id}` : `${host}:${port}`});
    } catch (error) {
      await request('fail', {id: job.id, leaseToken: job.lease_token, error: error instanceof Error ? error.message : 'printer_failed'}).catch(() => undefined);
      console.error(`Échec impression job ${job.id}.`);
    }
  }
  return result.jobs?.length || 0;
}

const once = process.argv.includes('--once');
try {
  do { await drain(); if (!once) await new Promise(resolve => setTimeout(resolve, intervalMs)); } while (!once);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Relais indisponible.');
  process.exitCode = 1;
}
