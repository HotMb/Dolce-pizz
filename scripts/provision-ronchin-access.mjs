// Provisions the fixed Ronchin screens in the local D1 database.
// Plaintext device credentials are printed once and are never written to D1 or Git.
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from './sites-env.mjs';

const configPath=path.join(projectRoot,'.wrangler','local-d1.json');
mkdirSync(path.dirname(configPath),{recursive:true});
writeFileSync(configPath,JSON.stringify({name:'dolce-local',compatibility_date:'2026-01-01',d1_databases:[{binding:'DB',database_name:'site-creator-d1',database_id:'00000000-0000-4000-8000-000000000000'}]}));

const run=(args)=>{
  const result=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config',configPath,'--persist-to','.wrangler/state',...args],{cwd:projectRoot,encoding:'utf8'});
  if(result.status!==0){console.error(result.stdout||'',result.stderr||'');throw new Error('La commande D1 a échoué.');}
  return result.stdout||'';
};
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
const query=command=>{
  const output=run(['--json','--command',command]);
  const start=output.indexOf('[');
  if(start<0)throw new Error('Réponse D1 illisible.');
  const payload=JSON.parse(output.slice(start));
  return payload[0]?.results||[];
};
const execute=command=>{query(command);};
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const token=()=>randomBytes(32).toString('hex');
const now=()=>new Date().toISOString();

// Always apply the same migrations as lancer-interne.cmd before touching D1.
const migration=spawnSync(process.execPath,['scripts/migrate-local.mjs'],{cwd:projectRoot,stdio:'inherit'});
if(migration.status!==0)process.exit(migration.status||1);

const ownerId=process.env.DEVICE_SEED_OWNER_ID?.trim()||'';
const ownerRows=query(`SELECT u.id,u.phone,u.name FROM users u JOIN organization_memberships m ON m.principal_id=u.id WHERE m.organization_id='dolce-pizza' AND m.role='owner' AND m.location_id IS NULL AND m.status='active' ${ownerId?`AND u.id=${quote(ownerId)}`:''} ORDER BY u.created_at LIMIT 1`);
if(!ownerRows[0]){
  console.error('Aucun propriétaire actif de Dolce Pizz’ n’existe dans la base locale. Connectez d’abord le compte responsable, puis activez l’administration, ou relancez avec DEVICE_SEED_OWNER_ID=<identifiant>.');
  process.exit(2);
}
const owner=ownerRows[0];

const screens=[
  {id:'ronchin-pos',label:'POS Ronchin',role:'pos',route:'/equipe/commande?device=1&channel=pos'},
  {id:'ronchin-make-line',label:'Make Line Ronchin',role:'make_line',route:'/production?station=make_line&organizationId=dolce-pizza&locationId=ronchin'},
  {id:'ronchin-four',label:'Four Ronchin',role:'oven',route:'/production?station=oven&organizationId=dolce-pizza&locationId=ronchin'},
  {id:'ronchin-borne-1',label:'Borne 1 Ronchin',role:'kiosk',route:'/borne'},
];
const expiresAt=Date.now()+365*86400000;
const credentials=[];
for(const screen of screens){
  const plain=token(),tokenHash=await hash(plain),timestamp=now();
  const existing=query(`SELECT id FROM devices WHERE id=${quote(screen.id)} AND organization_id='dolce-pizza' AND location_id='ronchin' LIMIT 1`)[0];
  if(existing){
    execute(`UPDATE devices SET label=${quote(screen.label)},role=${quote(screen.role)},status='active' WHERE id=${quote(screen.id)} AND organization_id='dolce-pizza' AND location_id='ronchin'`);
    execute(`UPDATE device_credentials SET revoked_at=${Date.now()} WHERE device_id=${quote(screen.id)} AND organization_id='dolce-pizza' AND location_id='ronchin' AND revoked_at IS NULL`);
  }else{
    execute(`INSERT INTO devices(id,organization_id,location_id,label,role,status,created_at,last_seen_at) VALUES(${quote(screen.id)},'dolce-pizza','ronchin',${quote(screen.label)},${quote(screen.role)},'active',${quote(timestamp)},NULL)`);
  }
  execute(`INSERT INTO device_credentials(token_hash,organization_id,location_id,device_id,expires_at,revoked_at,created_by,created_at,last_seen_at) VALUES(${quote(tokenHash)},'dolce-pizza','ronchin',${quote(screen.id)},${expiresAt},NULL,${quote(owner.id)},${quote(timestamp)},NULL)`);
  credentials.push({...screen,token:plain,expiresAt});
}

// A temporary owner key makes recovery possible when the SMS provider is not configured.
// It is deliberately printed only to the terminal; it is not persisted in the database.
const adminKey=token();
const internalKeys=JSON.stringify([{id:'otto-admin-ronchin',key:adminKey,principalId:owner.id,name:owner.name||'Responsable Ronchin',role:'owner',organizationId:'dolce-pizza',target:'/equipe'}]);
console.log('\nAccès Ronchin créés (copiez chaque jeton dans le poste correspondant) :');
for(const credential of credentials){console.log(`${credential.label}\n  Jeton : ${credential.token}\n  URL : ${credential.route}\n  Expire le : ${new Date(credential.expiresAt).toLocaleString('fr-FR')}`);}
console.log(`\nClé de récupération administrateur (à mettre temporairement dans .env.local) :\nINTERNAL_ACCESS_KEYS_JSON=${internalKeys}`);
console.log('\nSécurité : les jetons sont hashés dans device_credentials. Une nouvelle exécution invalide les anciens jetons de ces quatre postes.');
