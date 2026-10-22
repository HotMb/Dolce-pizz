// Ingredients, allergens and meat origins shared by the site, the admin and the kitchen.
import type {Product} from './catalog';

// The 14 allergens of EU regulation 1169/2011 (annex II), in the regulation's order.
export const allergens=[
 {id:'gluten',label:'Gluten'},{id:'crustaces',label:'Crustacés'},{id:'oeufs',label:'Œufs'},{id:'poissons',label:'Poissons'},
 {id:'arachides',label:'Arachides'},{id:'soja',label:'Soja'},{id:'lait',label:'Lait'},{id:'fruits-a-coque',label:'Fruits à coque'},
 {id:'celeri',label:'Céleri'},{id:'moutarde',label:'Moutarde'},{id:'sesame',label:'Sésame'},{id:'sulfites',label:'Sulfites'},
 {id:'lupin',label:'Lupin'},{id:'mollusques',label:'Mollusques'},
] as const;
export const allergenIds:string[]=allergens.map(a=>a.id);
export const allergenLabel=(id:string)=>allergens.find(a=>a.id===id)?.label||id;
// Meats whose origin must be shown in restaurants (décret n° 2022-65).
export const meats=[{id:'boeuf',label:'Bœuf'},{id:'porc',label:'Porc'},{id:'volaille',label:'Volaille'},{id:'agneau',label:'Agneau / mouton'}] as const;
export const meatLabel=(id:string)=>meats.find(m=>m.id===id)?.label||'';

/** `locked`: part of every recipe it is in (the dough), never removable nor sold as a supplement. */
export type Ingredient={id:string;name:string;allergens:string[];meat:string;origin:string;extra:boolean;available:boolean;locked:boolean;sort:number};

// Starting data, prefilled from the printed menu. Allergens of sauces and cured meats depend on the supplier:
// every recipe starts "to verify" until the owner ticks it in the admin.
const seed:[id:string,name:string,allergens:string[],meat:string,extra:boolean,locked?:boolean][]=[
 ['pate','Pâte à pizza',['gluten'],'',false,true],
 ['sauce-tomate','Sauce tomate',[],'',false],['creme-fraiche','Crème fraîche',['lait'],'',false],['creme-truffee','Crème truffée',['lait'],'',false],
 ['mozzarella','Mozzarella',['lait'],'',true],['chevre','Chèvre',['lait'],'',true],['bleu','Bleu',['lait'],'',true],['emmental','Emmental',['lait'],'',true],
 ['raclette','Raclette',['lait'],'',true],['parmesan','Parmesan',['lait'],'',true],['boursin','Boursin',['lait'],'',true],
 ['olives','Olives noires',[],'',true],['oignons-rouges','Oignons rouges',[],'',true],['oignons','Oignons',[],'',true],['tomates-cerises','Tomates cerises',[],'',true],
 ['poivrons','Poivrons',[],'',true],['champignons','Champignons',[],'',true],['pomme-de-terre','Pomme de terre',[],'',true],['roquette','Roquette',[],'',true],
 ['origan','Origan',[],'',false],['miel','Miel',[],'',true],['oeuf','Œuf',['oeufs'],'',true],
 ['thon','Thon',['poissons'],'',true],['saumon-fume','Saumon fumé',['poissons'],'',true],['anchois','Anchois',['poissons'],'',true],
 ['jambon-dinde','Jambon de dinde',[],'volaille',true],['jambon','Jambon',[],'porc',true],['lardons','Lardons fumés',[],'porc',true],['chorizo','Chorizo',[],'porc',true],
 ['merguez','Merguez',[],'boeuf',true],['boeuf-hache','Bœuf haché',[],'boeuf',true],['poulet','Poulet',[],'volaille',true],
 ['sauce-gruyere','Sauce gruyère',['lait'],'',false],['sauce-curry','Sauce curry',['moutarde'],'',false],['sauce-barbecue','Sauce barbecue',['moutarde'],'',false],
 ['sauce-algerienne','Sauce algérienne',['oeufs','moutarde'],'',false],['sauce-thai','Sauce thaï',[],'',false],['pesto','Sauce pesto maison',['lait','fruits-a-coque'],'',false],['sauce-tn','Sauce TN',[],'',false],
];
export const seedIngredients:Ingredient[]=seed.map(([id,name,list,meat,extra,locked],sort)=>({id,name,allergens:list,meat,origin:'',extra,available:true,locked:!!locked,sort}));

const tomato=['pate','sauce-tomate','mozzarella'],cream=['pate','creme-fraiche','mozzarella'];
export const seedRecipes:Record<string,string[]>={
 margarita:[...tomato,'olives'],'4-fromages':[...tomato,'chevre','bleu','emmental'],thon:[...tomato,'oignons-rouges','tomates-cerises','olives','thon'],
 orientale:[...tomato,'merguez','poivrons','olives','oeuf'],chorizo:[...tomato,'jambon-dinde','chorizo','poivrons','oeuf'],reine:[...tomato,'champignons','jambon-dinde'],
 vegetarienne:[...tomato,'oignons-rouges','tomates-cerises','olives','poivrons'],bolognaise:[...tomato,'boeuf-hache','poivrons','oignons-rouges'],royale:[...tomato,'boeuf-hache','oeuf','merguez'],
 'chevre-miel':[...cream,'chevre','miel'],boursin:[...cream,'poulet','champignons','boursin'],chicken:[...cream,'poulet','pomme-de-terre','olives','oignons'],
 saumon:[...cream,'saumon-fume','pomme-de-terre','oignons'],paysanne:[...cream,'jambon','pomme-de-terre','olives','oignons'],savoyarde:[...cream,'lardons','pomme-de-terre','raclette'],
 forestiere:[...cream,'lardons','jambon','champignons','origan'],boisee:[...cream,'poulet','poivrons','olives','sauce-gruyere','pomme-de-terre'],indienne:[...cream,'poulet','champignons','sauce-curry'],
 cannibale:[...tomato,'poulet','merguez','boeuf-hache','poivrons','sauce-barbecue'],'cream-beef':[...cream,'boeuf-hache','pomme-de-terre','oignons','chevre'],
 salsa:[...cream,'poulet','merguez','poivrons','oignons','sauce-algerienne'],thai:[...cream,'poulet','poivrons','olives','sauce-thai'],
 calzone:[...tomato],pesto:[...tomato,'poulet','pesto'],tartuffo:['pate','creme-truffee','mozzarella','jambon-dinde','roquette','parmesan'],
 pimiento:[...tomato,'poulet','olives','sauce-tn'],napoli:[...tomato,'anchois'],fromagesque:[...cream,'emmental','raclette','sauce-gruyere'],
 diavulo:[...tomato,'merguez','chorizo','poivrons','parmesan'],kids:[...tomato,'champignons','jambon-dinde'],
};
// Items without an ingredient list carry their allergens directly (flavours vary with the delivery).
export const seedProductAllergens:Record<string,string[]>={
 daim:['gluten','oeufs','lait','fruits-a-coque','soja'],tiramisu:['gluten','oeufs','lait'],'ben-jerrys':['lait','oeufs','gluten','soja','fruits-a-coque'],
 'haagen-dazs':['lait','oeufs'],mars:['lait','gluten','soja'],
};

const fold=(s:string)=>s.toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/œ/g,'oe').replace(/æ/g,'ae').trim();
export const normalizeText=fold;
export const slugify=(s:string)=>fold(s).replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);
/** A garnish option ("Poulet") counts as the ingredient of the same name for allergens and origins. */
export const optionIngredient=(option:string,list:Ingredient[])=>option?list.find(i=>fold(i.name)===fold(option)):undefined;
/** The ingredients actually in the pizza once the customer's changes are applied. */
export function composition(p:Pick<Product,'ingredients'>,list:Ingredient[],removed:string[]=[],added:string[]=[],option=''){
 const byId=(id:string)=>list.find(i=>i.id===id);
 const ids=[...(p.ingredients||[]).filter(id=>!removed.includes(id)),...added];
 const chosen=optionIngredient(option,list);if(chosen&&!ids.includes(chosen.id))ids.push(chosen.id);
 return ids.map(byId).filter((i):i is Ingredient=>!!i);
}
export function allergensOf(p:Pick<Product,'ingredients'|'allergens'>,list:Ingredient[],removed:string[]=[],added:string[]=[],option=''){
 const found=new Set([...(p.allergens||[]),...composition(p,list,removed,added,option).flatMap(i=>i.allergens)]);
 return allergenIds.filter(id=>found.has(id));
}
/** "Poulet : France" lines for the meats of a pizza whose origin the owner has filled in. */
export const originsOf=(items:Ingredient[])=>items.filter(i=>i.meat&&i.origin.trim()).map(i=>`${i.name} : ${i.origin.trim()}`);
/** Menu text generated from the ingredients, the dough left out. */
export function describe(ids:string[],list:Ingredient[]){const names=ids.map(id=>list.find(i=>i.id===id)).filter(i=>i&&!i.locked).map(i=>i!.name);if(!names.length)return '';const text=names.map((n,i)=>i?n.charAt(0).toLocaleLowerCase('fr')+n.slice(1):n).join(', ');return `${text}.`;}
