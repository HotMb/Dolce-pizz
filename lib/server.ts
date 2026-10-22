import {env} from 'cloudflare:workers';
import {categories,type Product,type ProductStatus} from './catalog';
import {seedCatalog} from './seed';
import {seedIngredients,type Ingredient} from './menu';
import {pizzaPhotos} from './pizza-photos';
import {defaultSettings,type Settings} from './rules';
type ProductRow={id:string;name:string;category:string;description:string;price:number;xxl:number|null;available:number;options:string;offer:number;ingredients:string;allergens:string;allergens_checked:number;tagline:string;photo:string;status:string;spicy:number;sort:number;version:number};
type IngredientRow={id:string;name:string;allergens:string;meat:string;origin:string;extra:number;available:number;locked:number;sort:number};
export function db(){if(!env.DB)throw new Error('DB unavailable');return env.DB;}
const list=(value:string|null|undefined)=>{try{const v=JSON.parse(value||'[]');return Array.isArray(v)?v.filter((x):x is string=>typeof x==='string'):[];}catch{return [];}};
export const insertProduct=(p:Product)=>db().prepare('INSERT OR IGNORE INTO products(id,name,category,description,price,xxl,available,options,offer,ingredients,allergens,allergens_checked,tagline,photo,status,spicy,sort,version,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)')
 .bind(p.id,p.name,p.category,p.description,p.price,p.xxl,p.available?1:0,JSON.stringify(p.options||[]),p.offer?1:0,JSON.stringify(p.ingredients||[]),JSON.stringify(p.allergens||[]),p.allergensChecked?1:0,p.tagline||'',p.photo||'',p.status||'published',p.spicy?1:0,p.sort||0,new Date().toISOString());
export async function ensureSeed(){
 const existing=await db().prepare('SELECT id FROM config WHERE id=1').first();if(existing)return;
 await db().batch([
  ...seedIngredients.map(i=>db().prepare('INSERT OR IGNORE INTO ingredients(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES(?,?,?,?,?,?,?,?,?)').bind(i.id,i.name,JSON.stringify(i.allergens),i.meat,i.origin,i.extra?1:0,1,i.locked?1:0,i.sort)),
  ...seedCatalog.map(insertProduct),
  db().prepare('INSERT OR IGNORE INTO config(id,value,version) VALUES(1,?,1)').bind(JSON.stringify(defaultSettings))
 ]);
}
// Settings saved before a new field existed get its default value.
export async function settings():Promise<Settings>{const r=await db().prepare('SELECT value,version FROM config WHERE id=1').first<{value:string;version:number}>();if(!r)throw new Error('Settings unavailable');return {...defaultSettings,...JSON.parse(r.value),version:r.version};}
const categoryOrder=(id:string)=>{const i=categories.findIndex(c=>c.id===id);return i<0?categories.length:i;};
export function toProduct(p:ProductRow):Product{
 // A photo dropped in assets-src/pizzas and exported by `npm run photos` shows up without touching the database.
 const photo=p.photo==='none'?'':p.photo||(pizzaPhotos.has(p.id)?'static':'');
 return {id:p.id,name:p.name,category:p.category,description:p.description,price:p.price,xxl:p.xxl,available:!!p.available,options:list(p.options),offer:!!p.offer,ingredients:list(p.ingredients),allergens:list(p.allergens),allergensChecked:!!p.allergens_checked,tagline:p.tagline,photo,status:p.status as ProductStatus,spicy:!!p.spicy,sort:p.sort,version:p.version};
}
/** Published products for the site; `all` adds drafts and archived ones for the admin. Menu order: category, then position. */
export async function productList(all=false){
 const r=await db().prepare(`SELECT * FROM products${all?'':" WHERE status='published'"} ORDER BY sort,rowid`).all<ProductRow>();
 return r.results.map(toProduct).sort((a,b)=>categoryOrder(a.category)-categoryOrder(b.category));
}
export const toIngredient=(i:IngredientRow):Ingredient=>({id:i.id,name:i.name,allergens:list(i.allergens),meat:i.meat,origin:i.origin,extra:!!i.extra,available:!!i.available,locked:!!i.locked,sort:i.sort});
export async function ingredientList(){const r=await db().prepare('SELECT * FROM ingredients ORDER BY sort,name').all<IngredientRow>();return r.results.map(toIngredient);}
export async function menu(){const[products,ingredients,s]=await Promise.all([productList(),ingredientList(),settings()]);return {products,ingredients,settings:s};}
export async function balance(userId:string){const r=await db().prepare('SELECT COALESCE(SUM(delta),0) AS balance FROM ledger WHERE user_id=?').bind(userId).first<{balance:number}>();return r?.balance||0;}
export async function isAdmin(userId:string){return !!await db().prepare("SELECT user_id FROM roles WHERE user_id=? AND role='admin'").bind(userId).first();}
export function orderView(r:Record<string,unknown>|null){if(!r||typeof r.items!=='string')throw new Error('Order unavailable');return {...r,items:JSON.parse(r.items) as unknown[]};}
export function secret(){return (env as unknown as Record<string,string>).ADMIN_SETUP_CODE||process.env.ADMIN_SETUP_CODE||'';}
export function marketingStopSecret(){const vars=env as unknown as Record<string,string|undefined>;return vars.MARKETING_STOP_SECRET||process.env.MARKETING_STOP_SECRET||secret();}
