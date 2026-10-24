#!/usr/bin/env node
/* Restore a SQL export into an isolated SQLite memory database and validate it. */
import {readFileSync, existsSync} from 'node:fs';
import {resolve, relative} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const backupRoot = resolve(root, 'backups');
const argument = process.argv.find(value => value.startsWith('--file='))?.slice('--file='.length);
if (!argument) { console.error('Usage : npm run db:verify-backup -- --file=backups/export.sql'); process.exit(2); }
const file = resolve(argument);
const relativeFile = relative(backupRoot, file);
if (relativeFile.startsWith('..') || relativeFile.includes('..' + '\\') || relativeFile.includes('../')) { console.error('Le fichier doit rester dans backups/.'); process.exit(2); }
if (!existsSync(file)) { console.error(`Fichier introuvable : ${file}`); process.exit(2); }
const database = new DatabaseSync(':memory:');
try {
  database.exec('PRAGMA foreign_keys=ON');
  database.exec(readFileSync(file, 'utf8'));
  const violations = database.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) { console.error(`Restauration invalide : ${violations.length} violation(s) de clé étrangère.`); process.exit(1); }
  const tables = database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get();
  console.log(`Sauvegarde vérifiée : ${tables.count} tables restaurées, clés étrangères valides.`);
} finally { database.close(); }
