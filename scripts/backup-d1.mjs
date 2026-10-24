#!/usr/bin/env node
/* Export a D1 database without putting credentials or dumps in Git. */
import {existsSync, mkdirSync} from 'node:fs';
import {resolve, relative, dirname, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const backupRoot = resolve(root, 'backups');
const remote = process.argv.includes('--remote');
const database = process.env.CF_D1_DATABASE_NAME || 'DB';
const outputArg = process.argv.find(value => value.startsWith('--output='))?.slice('--output='.length);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const output = resolve(outputArg || join(backupRoot, `${database}-${remote ? 'remote' : 'local'}-${stamp}.sql`));
const relativeOutput = relative(backupRoot, output);
if (relativeOutput.startsWith('..') || relativeOutput.includes('..' + '\\') || relativeOutput.includes('../')) {
  console.error('Le fichier de sauvegarde doit rester dans le dossier backups/.');
  process.exit(2);
}
if (existsSync(output)) { console.error(`Le fichier existe déjà : ${output}`); process.exit(2); }
mkdirSync(dirname(output), {recursive: true});
const config = resolve(root, 'dist/server/wrangler.json');
if (!existsSync(config)) { console.error('Build requis avant export : dist/server/wrangler.json est absent.'); process.exit(2); }
const args = ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'd1', 'export', database, remote ? '--remote' : '--local', '--config', config, '--output', output, '--skip-confirmation'];
if (!remote) args.push('--persist-to', '.wrangler/state');
const result = spawnSync(process.execPath, args, {cwd: root, stdio: 'inherit'});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
