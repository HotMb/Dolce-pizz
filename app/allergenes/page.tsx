import type {Metadata} from 'next';
import {ensureSeed,menu} from '@/lib/server';
import {categories} from '@/lib/catalog';
import {allergens,allergenLabel,allergensOf,meatLabel} from '@/lib/menu';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Allergènes et origine des viandes',description:'Les 14 allergènes réglementaires et l’origine des viandes de chaque recette Dolce Pizz’, à Ronchin.'};
// Written information on allergens, available before ordering (EU regulation 1169/2011, décret n° 2015-447).
export default async function Page(){
 await ensureSeed();const m=await menu();
 const origins=m.ingredients.filter(i=>i.meat&&i.origin.trim());
 return <main id="contenu" className="page-shell legal allergen-page">
  <div className="page-heading"><div className="eyebrow red">DOLCE PIZZ’ · INFORMATION CLIENTS</div><h1>ALLERGÈNES.</h1><p>Les 14 allergènes réglementaires présents dans chaque recette, calculés à partir de ses ingrédients. Au moment de commander, vous pouvez retirer un ingrédient de votre pizza : ses allergènes sont alors mis à jour.</p></div>
  <div className="banner">Nos pizzas sont préparées dans une même cuisine, où circulent tous ces allergènes : des traces restent possibles. En cas d’allergie sévère, appelez-nous au <a href="tel:0320400901"><u>03 20 40 09 01</u></a> avant de commander.</div>
  <p className="small muted allergen-legend">Les 14 allergènes : {allergens.map(a=>a.label).join(', ')}.</p>
  {categories.map(c=>{const items=m.products.filter(p=>p.category===c.id);if(!items.length)return null;return <section key={c.id}><h2>{c.name}</h2><div className="allergen-cards">{items.map(p=>{const list=allergensOf(p,m.ingredients);return <article className="allergen-card" key={p.id}><h3>{p.name}</h3>{p.description&&<p className="small">{p.description}</p>}<p className="allergen-tags">{list.length?list.map(a=><span key={a}>{allergenLabel(a)}</span>):<em>{p.allergensChecked?'Aucun des 14 allergènes':'Information à venir'}</em>}</p>{!p.allergensChecked&&list.length>0&&<p className="small muted">Liste en cours de validation par la pizzeria.</p>}{!!p.options?.length&&<p className="small muted">Au choix : {p.options.join(', ')}.</p>}</article>;})}</div></section>;})}
  <section id="origines"><h2>Origine des viandes</h2>{origins.length?<ul className="origin-public">{origins.map(i=><li key={i.id}><b>{i.name}</b> ({meatLabel(i.meat).toLocaleLowerCase('fr')}) : {i.origin}</li>)}</ul>:<p>L’origine de nos viandes est en cours de mise à jour sur le site. Demandez-la au comptoir ou par téléphone.</p>}</section>
 </main>;
}
