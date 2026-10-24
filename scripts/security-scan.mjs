import {readdir,readFile} from 'node:fs/promises';
import {join,relative} from 'node:path';

const root=process.cwd();
const includeEnv=process.argv.includes('--include-env')||process.env.SECURITY_SCAN_ENV==='1';
const ignored=new Set(['.git','.next','dist','node_modules','.wrangler','.vinext','.sites-runtime']);
const textExtensions=new Set(['.ts','.tsx','.js','.mjs','.jsx','.json','.toml','.yml','.yaml','.env','.md','.sql','.cmd','.sh']);
const rules=[
  {name:'private key',pattern:/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/},
  {name:'live provider key',pattern:/(?:sk_live_|rk_live_|xox[baprs]-|ghp_|xkeysib-)[A-Za-z0-9_-]{16,}/},
  {name:'hard-coded secret assignment',pattern:/(?:ADMIN_SETUP_CODE|BREVO_API_KEY|NOTIFICATION_DISPATCH_SECRET|MARKETING_STOP_SECRET)\s*=\s*['"]?[A-Za-z0-9+/=_-]{24,}/},
];
const findings=[];
async function walk(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    if(entry.isDirectory()){if(!ignored.has(entry.name))await walk(join(directory,entry.name));continue;}
    const file=join(directory,entry.name),extension=entry.name.includes('.')?`.${entry.name.split('.').pop()}`:'';
    const relativePath=relative(root,file);
    const envFile=entry.name.startsWith('.env');
    if(envFile&&!includeEnv)continue;
    if((!textExtensions.has(extension)&&!envFile)||relativePath.split(/[\\/]/)[0]==='tests')continue;
    const content=await readFile(file,'utf8');
    for(const rule of rules){if(rule.pattern.test(content))findings.push(`${relative(root,file)}: ${rule.name}`);}
  }
}
await walk(root);
if(findings.length){console.error('Potential secrets found:');for(const finding of findings)console.error(`- ${finding}`);process.exitCode=1;}
else console.log('Security scan passed: no supported secret signatures found in source files.');
