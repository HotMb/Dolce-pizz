import type {Product} from './catalog';
import type {Ingredient} from './menu';
export type Size='senior'|'xxl'|'unique';
/** `removed`/`added`: ingredient ids of the customer's changes; `freeRemoved`/`freeAdded` for the free pizza of an offer. */
export type CartLine={id:string;size:Size;option:string;quantity:number;freeId?:string;freeOption?:string;removed?:string[];added?:string[];freeRemoved?:string[];freeAdded?:string[]};
/** Stored with the order: names, so the ticket stays readable if the menu changes. */
export type FreePizza={id:string;name:string;option:string;unitPrice:number;without?:string[];extra?:string[]};
export type PricedLine=CartLine&{name:string;unitPrice:number;extras:number;without:string[];extra:string[];free?:FreePizza;total:number;problem:string};
/** The live menu. A bare product list (tests, old callers) means no ingredient data and free supplements. */
export type Menu={products:Product[];ingredients:Ingredient[];extraPrice:number};
export const isPizza=(p:Pick<Product,'xxl'>)=>p.xxl!==null;
export const unitPrice=(p:Product,size:Size)=>size==='xxl'?p.xxl??0:p.price;
export const MAX_EXTRAS=5;
const optionProblem=(p:Product,option:string)=>p.options?.length?(p.options.includes(option)?'':`Choisissez la garniture de ${p.name}.`):option?'Cette option n’est pas proposée.':'';
/** Checks the customer's changes to one pizza. Removing is free; each supplement costs the admin's single supplement price. */
export function customize(p:Product,menu:Menu,removed:string[]=[],added:string[]=[]){
 const find=(id:string)=>menu.ingredients.find(i=>i.id===id),base=p.ingredients||[];
 const result=(problem:string)=>({problem,extras:added.length*menu.extraPrice,without:removed.map(id=>find(id)?.name||id),extra:added.map(id=>find(id)?.name||id)});
 if(!Array.isArray(removed)||!Array.isArray(added)||new Set(removed).size!==removed.length||new Set(added).size!==added.length)return result('Vérifiez la composition de votre pizza.');
 if(added.length>MAX_EXTRAS)return result(`${MAX_EXTRAS} suppléments maximum par pizza.`);
 if((removed.length||added.length)&&!base.length)return result(`${p.name} ne se personnalise pas.`);
 for(const id of removed)if(!base.includes(id)||find(id)?.locked)return result(`Cet ingrédient ne peut pas être retiré de ${p.name}.`);
 for(const id of added){const i=find(id);if(!i||!i.extra||i.locked||removed.includes(id))return result('Ce supplément n’est plus proposé. Retirez-le de votre pizza.');if(!i.available)return result(`${i.name} est en rupture : retirez ce supplément.`);}
 for(const id of base){const i=find(id);if(i&&!i.available&&!removed.includes(id))return result(`${i.name} manque aujourd’hui : choisissez ${p.name} sans ${i.name.toLocaleLowerCase('fr')}, ou une autre pizza.`);}
 return result('');
}
// Single source of truth for the cart: the browser uses it for display, the API re-runs it on the stored menu.
// "2e pizza offerte": the free pizza has the same size and the cheaper of the two is free; supplements are always paid.
// Loyalty ticket: one Senior pizza outside an offer is free; on an XXL only the size difference is paid.
export function priceCart(cart:CartLine[],source:Product[]|Menu,ticket=false){
 const menu:Menu=Array.isArray(source)?{products:source,ingredients:[],extraPrice:0}:source;const products=menu.products;
 const find=(id?:string)=>products.find(p=>p.id===id);
 const lines:PricedLine[]=cart.map(l=>{
  const p=find(l.id);if(!p)return {...l,name:'Article indisponible',unitPrice:0,extras:0,without:[],extra:[],total:0,problem:'Un article n’est plus proposé. Retirez-le du panier.'};
  const unit=unitPrice(p,l.size),mods=customize(p,menu,l.removed,l.added);
  const base={...l,name:p.name,unitPrice:unit,without:mods.without,extra:mods.extra};
  if(!Number.isInteger(l.quantity)||l.quantity<1||l.quantity>20)return {...base,extras:0,total:0,problem:'La quantité doit être comprise entre 1 et 20.'};
  let problem=!p.available?`${p.name} est momentanément indisponible. Retirez-la du panier.`:(isPizza(p)?!['senior','xxl'].includes(l.size):l.size!=='unique')?'Choisissez une taille valide.':optionProblem(p,l.option)||mods.problem;
  if(!l.freeId)return {...base,extras:mods.extras,total:(unit+mods.extras)*l.quantity,problem};
  const f=find(l.freeId);const freeUnit=f?unitPrice(f,l.size):0;const freeMods=f?customize(f,menu,l.freeRemoved,l.freeAdded):null;
  if(!problem)problem=!p.offer||!isPizza(p)?`L’offre « 2e pizza offerte » n’est plus active sur ${p.name}. Retirez la pizza offerte.`:!f||!isPizza(f)||!f.available?'La pizza offerte choisie n’est plus disponible.':optionProblem(f,l.freeOption||'')||freeMods!.problem;
  const extras=mods.extras+(freeMods?.extras||0);
  return {...base,extras,free:f?{id:f.id,name:f.name,option:l.freeOption||'',unitPrice:freeUnit,...(freeMods?.without.length?{without:freeMods.without}:{}),...(freeMods?.extra.length?{extra:freeMods.extra}:{})}:undefined,total:(Math.max(unit,freeUnit)+extras)*l.quantity,problem};
 });
 const candidate=lines.map((l,i)=>({i,p:find(l.id)})).filter(({i,p})=>p&&isPizza(p)&&!lines[i].freeId&&!lines[i].problem).sort((a,b)=>b.p!.price-a.p!.price)[0];
 const ticketLine=ticket&&candidate?candidate.i:-1;const ticketDiscount=ticketLine>=0?Math.min(candidate.p!.price,lines[ticketLine].unitPrice):0;
 const subtotal=lines.reduce((n,l)=>n+l.total,0);
 return {lines,subtotal,offer:lines.reduce((n,l)=>n+(l.free?Math.min(l.unitPrice,l.free.unitPrice)*l.quantity:0),0),extras:lines.reduce((n,l)=>n+l.extras*l.quantity,0),ticketLine,ticketDiscount,ticketCandidate:candidate?.i??-1,total:subtotal-ticketDiscount,count:lines.reduce((n,l)=>n+l.quantity*(l.freeId?2:1),0),problem:lines.find(l=>l.problem)?.problem||''};
}
