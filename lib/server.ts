import {env} from 'cloudflare:workers';
import {catalog} from './catalog';
import {defaultSettings,type Settings} from './rules';
type ProductRow={id:string;name:string;category:string;description:string;price:number;xxl:number|null;available:number;options:string};
export function db(){if(!env.DB)throw new Error('DB unavailable');return env.DB;}
export async function ensureSeed(){
 const existing=await db().prepare('SELECT id FROM config WHERE id=1').first();if(existing)return;
 await db().batch([
  ...catalog.map(p=>db().prepare('INSERT OR IGNORE INTO products(id,name,category,description,price,xxl,available,options) VALUES(?,?,?,?,?,?,?,?)').bind(p.id,p.name,p.category,p.description,p.price,p.xxl,1,JSON.stringify(p.options||[]))),
  db().prepare('INSERT OR IGNORE INTO config(id,value,version) VALUES(1,?,1)').bind(JSON.stringify(defaultSettings))
 ]);
}
export async function settings():Promise<Settings>{const r=await db().prepare('SELECT value,version FROM config WHERE id=1').first<{value:string;version:number}>();if(!r)throw new Error('Settings unavailable');return {...JSON.parse(r.value),version:r.version};}
export async function productList(){const r=await db().prepare('SELECT * FROM products ORDER BY rowid').all<ProductRow>();return r.results.map(p=>({...p,available:!!p.available,options:JSON.parse(p.options||'[]') as string[]}));}
export async function balance(userId:string){const r=await db().prepare('SELECT COALESCE(SUM(delta),0) AS balance FROM ledger WHERE user_id=?').bind(userId).first<{balance:number}>();return r?.balance||0;}
export async function isAdmin(userId:string){return !!await db().prepare("SELECT user_id FROM roles WHERE user_id=? AND role='admin'").bind(userId).first();}
export function orderView(r:Record<string,unknown>|null){if(!r||typeof r.items!=='string')throw new Error('Order unavailable');return {...r,items:JSON.parse(r.items) as unknown[]};}
export function secret(){return (env as unknown as Record<string,string>).ADMIN_SETUP_CODE||process.env.ADMIN_SETUP_CODE||'';}
