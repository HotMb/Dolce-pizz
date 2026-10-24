// Verifies that a fresh local restore can apply the complete migration set.
// This is a deterministic schema check; it does not contact Cloudflare or a provider.
import {DatabaseSync} from 'node:sqlite';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from './sites-env.mjs';

const migrationDir = path.join(projectRoot, 'drizzle');
const migrations = readdirSync(migrationDir)
  .filter(file => /^\d{4}_.+\.sql$/.test(file))
  .sort();

if (!migrations.length) {
  console.error('Vérification restauration échouée : aucune migration drizzle trouvée.');
  process.exit(1);
}

const db = new DatabaseSync(':memory:');
try {
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of migrations) {
    const sql = readFileSync(path.join(migrationDir, file), 'utf8');
    try {
      db.exec(sql);
    } catch (error) {
      throw new Error(`migration ${file}: ${error.message}`);
    }
  }

  const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeyErrors.length) {
    throw new Error(`références étrangères invalides (${foreignKeyErrors.length})`);
  }

  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
  for (const required of ['organizations', 'locations', 'users', 'orders', 'print_outbox']) {
    if (!tables.has(required)) throw new Error(`table essentielle absente : ${required}`);
  }

  console.log(`Restauration vérifiée : ${migrations.length} migrations appliquées, clés étrangères valides.`);
} catch (error) {
  console.error(`Vérification restauration échouée : ${error.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
