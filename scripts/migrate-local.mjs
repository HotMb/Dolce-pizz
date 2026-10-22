// Brings the local preview database up to date: applies each drizzle/*.sql file once, in order.
// Run by lancer-site.cmd before the dev server (`npm run db:migrate:local` does the same).
import {spawnSync} from 'node:child_process';
import {mkdirSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from './sites-env.mjs';

// Same database as the dev server (vite.config.ts uses this placeholder id when no real database is named).
const CONFIG=path.join(projectRoot,'.wrangler','local-d1.json');
mkdirSync(path.dirname(CONFIG),{recursive:true});
writeFileSync(CONFIG,JSON.stringify({name:'dolce-local',compatibility_date:'2026-01-01',d1_databases:[{binding:'DB',database_name:'site-creator-d1',database_id:'00000000-0000-4000-8000-000000000000'}]}));
function wrangler(args){
 const r=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config',CONFIG,'--persist-to','.wrangler/state',...args],{cwd:projectRoot,encoding:'utf8'});
 if(r.status!==0){console.error(r.stdout,r.stderr);console.error('\nLa mise à jour de la base locale a échoué : lisez le message ci-dessus.');process.exit(1);}
 return r.stdout;
}
const sql=command=>{const out=wrangler(['--json','--command',command]);return JSON.parse(out.slice(out.indexOf('[')))[0].results;};

sql('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)');
const applied=new Set(sql('SELECT name FROM local_migrations').map(r=>r.name));
if(!applied.size){
 // Databases migrated by hand before this script existed: recognise what is already there.
 const tables=new Set(sql("SELECT name FROM sqlite_master WHERE type='table'").map(r=>r.name));
 const probes={'0000_chilly_ultimatum.sql':'products','0001_comptes_sms_offres.sql':'users','0002_carte_ingredients_promos.sql':'ingredients'};
 for(const [file,table] of Object.entries(probes))if(tables.has(table)){sql(`INSERT OR IGNORE INTO local_migrations(name) VALUES('${file}')`);applied.add(file);}
}
let count=0;
for(const file of readdirSync(path.join(projectRoot,'drizzle')).filter(f=>f.endsWith('.sql')).sort()){
 if(applied.has(file))continue;
 console.log(`Base locale : migration ${file}`);
 wrangler(['--file',`drizzle/${file}`]);
 sql(`INSERT INTO local_migrations(name) VALUES('${file}')`);count++;
}
console.log(count?`Base locale à jour (${count} migration${count>1?'s':''} appliquée${count>1?'s':''}).`:'Base locale déjà à jour.');
