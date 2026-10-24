// Publishes a prototype to the developer's own Cloudflare account (free plan):
// login, D1 database, build, migrations, Worker and secrets. Run it again to publish updates.
// Hosted login codes are never exposed; a real SMS provider is required for login.
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {projectRoot} from './sites-env.mjs';

const NAME='dolce-pizz-demo';
const CONFIG='dist/server/wrangler.json';
const SECRETS_FILE=path.join(projectRoot,'.env.demo');

function run(args,{capture=false,input,env}={}){
 const stdio=input!==undefined?['pipe','inherit','inherit']:capture?['ignore','pipe','inherit']:'inherit';
 const r=spawnSync(process.execPath,args,{cwd:projectRoot,encoding:'utf8',stdio,input,env:{...process.env,...env}});
 if(r.status!==0){console.error('\nCette étape a échoué : lisez le message [ERROR] ci-dessus, corrigez le problème puis relancez mettre-en-ligne-demo.cmd (le script reprend là où il s’est arrêté).');process.exit(1);}
 return r.stdout||'';
}
const wrangler=(args,options)=>run(['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js',...args],options);
const json=output=>JSON.parse(output.slice(output.indexOf('[')));
const sql=command=>json(wrangler(['d1','execute',NAME,'--remote','--config',CONFIG,'--json','--yes','--command',command],{capture:true}))[0].results;
const step=text=>console.log(`\n=== ${text}`);

step('Connexion à Cloudflare');
// --reconnexion forgets the saved Cloudflare sign-in: switch account or refresh it after verifying the e-mail.
if(process.argv.includes('--reconnexion'))wrangler(['logout']);
if(/not authenticated/i.test(wrangler(['whoami'],{capture:true})))wrangler(['login']);

step('Base de données D1');
const find=()=>json(wrangler(['d1','list','--json'],{capture:true})).find(db=>db.name===NAME);
if(!find())wrangler(['d1','create',NAME,'--location','weur'],{capture:true});
const database=find();if(!database)throw new Error('La base D1 n’a pas pu être créée.');
console.log(`${NAME} : ${database.uuid}`);

step('Photos des pizzas');
run(['scripts/optimize-photos.mjs']);

step('Build du site');
run(['scripts/run-framework.mjs','build'],{env:{CF_WORKER_NAME:NAME,CF_D1_DATABASE_ID:database.uuid}});

step('Tables de la base');
sql('CREATE TABLE IF NOT EXISTS demo_migrations(name TEXT PRIMARY KEY)');
const applied=new Set(sql('SELECT name FROM demo_migrations').map(r=>r.name));
for(const file of readdirSync(path.join(projectRoot,'drizzle')).filter(f=>f.endsWith('.sql')).sort()){
 if(applied.has(file))continue;
 console.log(`Migration ${file}`);
 wrangler(['d1','execute',NAME,'--remote','--config',CONFIG,'--yes','--file',`drizzle/${file}`],{capture:true});
 sql(`INSERT INTO demo_migrations(name) VALUES('${file}')`);
}

step('Mise en ligne');
wrangler(['deploy','--config',CONFIG]);

step('Secrets');
const secrets=existsSync(SECRETS_FILE)?Object.fromEntries(readFileSync(SECRETS_FILE,'utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)])):{};
secrets.ADMIN_SETUP_CODE||=`demo-${randomBytes(12).toString('hex')}`;
secrets.MARKETING_STOP_SECRET||=randomBytes(32).toString('hex');
// Keep promotional-SMS simulation for the public demo, but never enable OTP disclosure on the Worker.
secrets.SMS_DEMO='0';
secrets.SMS_CAMPAIGNS_DEMO??='1';
writeFileSync(SECRETS_FILE,Object.entries(secrets).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
const temp=path.join(projectRoot,'.env.demo.upload.json');
try{writeFileSync(temp,JSON.stringify(secrets));wrangler(['secret','bulk',temp,'--name',NAME],{capture:true});}finally{rmSync(temp,{force:true});}

step('Contrôle HTTP post-déploiement');
const publicBase=(process.env.PUBLIC_BASE_URL||'').trim();
if(publicBase){
  run(['scripts/check-http-security.mjs',`--url=${publicBase}`]);
}else{
  console.warn('PUBLIC_BASE_URL absent : la publication est terminée, mais les en-têtes du domaine public restent à vérifier avec npm run security:http.');
}

console.log(`
=== Prototype en ligne
Adresse : affichée plus haut par « Deployed ... https://${NAME}.<votre-sous-domaine>.workers.dev »
Code d’installation admin : conservé dans le fichier local ignoré .env.demo (ne le partagez pas).
1. Configurez BREVO_API_KEY pour recevoir un vrai code SMS, puis ouvrez /admin, connectez-vous avec le numéro du patron et entrez le code d’installation depuis .env.demo.
2. Onglet Réglages : cochez « J’ai vérifié les horaires », activez la fidélité, enregistrez.
3. Onglet Carte : activez « 2e pizza offerte » sur les pizzas voulues.
Les SMS promotionnels restent simulés par défaut sur le prototype; l’authentification hébergée exige un SMS réel.`);
