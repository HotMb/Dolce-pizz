#!/usr/bin/env node
/* Restore a D1 SQL export into a new local SQLite file for a controlled rehearsal. */
import {readFileSync, existsSync, mkdirSync, unlinkSync} from 'node:fs';
import {resolve, relative, dirname, basename, extname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const backupRoot = resolve(root, 'backups');
const argument = process.argv.find(value => value.startsWith('--file='))?.slice('--file='.length);
const outputArgument = process.argv.find(value => value.startsWith('--output='))?.slice('--output='.length);
const replace = process.argv.includes('--replace');
if (!argument || !outputArgument) {
  console.error('Usage : npm run db:restore-isolated -- --file=backups/export.sql --output=backups/restore-check.sqlite');
  process.exit(2);
}
const input = resolve(argument);
const output = resolve(outputArgument);
const insideBackups = (file) => {
  const relativeFile = relative(backupRoot, file);
  return !relativeFile.startsWith('..') && !relativeFile.includes('..' + '\\') && !relativeFile.includes('../');
};
if (!insideBackups(input) || !insideBackups(output)) {
  console.error('Les fichiers d’entrée et de sortie doivent rester dans backups/.');
  process.exit(2);
}
if (input === output || extname(output).toLowerCase() !== '.sqlite') {
  console.error('La sortie doit être un fichier .sqlite différent de l’export SQL.');
  process.exit(2);
}
if (!existsSync(input)) { console.error(`Export introuvable : ${input}`); process.exit(2); }
if (existsSync(output) && !replace) { console.error(`La sortie existe déjà : ${output}. Utilisez --replace après vérification.`); process.exit(2); }
mkdirSync(dirname(output), {recursive: true});
if (existsSync(output)) unlinkSync(output);

const database = new DatabaseSync(output);
try {
  database.exec('PRAGMA foreign_keys=ON');
  database.exec(readFileSync(input, 'utf8'));
  database.exec('PRAGMA foreign_keys=ON');
  const integrity = database.prepare('PRAGMA integrity_check').get();
  if (String(integrity?.integrity_check || '').toLowerCase() !== 'ok') throw new Error('integrity_check SQLite invalide.');
  const violations = database.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) throw new Error(`${violations.length} violation(s) de clé étrangère.`);
  const tables = database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get();
  console.log(`Restauration isolée réussie : ${basename(output)} · ${tables.count} tables · intégrité et clés étrangères valides.`);
} catch (error) {
  database.close();
  try { unlinkSync(output); } catch {}
  console.error(`Restauration isolée refusée : ${error instanceof Error ? error.message : 'erreur inconnue'}`);
  process.exit(1);
} finally {
  try { database.close(); } catch {}
}
