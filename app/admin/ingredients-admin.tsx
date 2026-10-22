'use client';
import {useEffect,useMemo,useState} from 'react';
import {Plus,Search,X,Trash2,Beef,Save} from 'lucide-react';
import {Switch} from '@/components/ui/switch';
import {toast} from 'sonner';
import {api,Button,ErrorBox,Field} from '../components';
import {allergenLabel,meats,meatLabel,normalizeText,originsOf,type Ingredient} from '@/lib/menu';
import type {Product} from '@/lib/catalog';
import {AllergenToggles} from './menu-admin';

type Props={ingredients:Ingredient[];products:Product[];refresh:()=>Promise<void>};
const usage=(products:Product[],id:string)=>products.filter(p=>p.status!=='archived'&&p.ingredients?.includes(id));

/** Every ingredient once: its allergens flow into all the pizzas using it; "Disponible" off = out of stock tonight. */
export function IngredientsAdmin({ingredients,products,refresh}:Props){
 const[query,setQuery]=useState(''),[onlyOut,setOnlyOut]=useState(false),[draft,setDraft]=useState({name:'',allergens:[] as string[],meat:'',extra:true}),[adding,setAdding]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const visible=ingredients.filter(i=>(!onlyOut||!i.available)&&normalizeText(i.name).includes(normalizeText(query)));const out=ingredients.filter(i=>!i.available).length;
 const create=async()=>{setBusy(true);setError('');try{await api('admin/ingredients','POST',{...draft,name:draft.name.trim(),origin:'',available:true});toast.success(`${draft.name.trim()} ajouté`);setDraft({name:'',allergens:[],meat:'',extra:true});setAdding(false);await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <section className="panel ingredients-admin">
  <div className="menu-admin-head"><div><h2>Ingrédients</h2><p className="small muted">Les allergènes d’un ingrédient s’appliquent à toutes les pizzas qui le contiennent. Coupez « Disponible » en cas de rupture : les pizzas concernées restent commandables sans cet ingrédient, et il disparaît des suppléments.</p></div><Button onClick={()=>setAdding(!adding)}><Plus size={17}/> Nouvel ingrédient</Button></div>
  {adding&&<div className="ing-create"><div className="form-grid"><Field label="Nom" id="ing-new"><input id="ing-new" maxLength={40} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="Ex. Burrata"/></Field><Field label="Est-ce une viande ?" id="ing-new-meat"><select id="ing-new-meat" className="native-select" value={draft.meat} onChange={e=>setDraft({...draft,meat:e.target.value})}><option value="">Non</option>{meats.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></Field></div><p className="small"><b>Allergènes</b></p><AllergenToggles value={draft.allergens} onChange={v=>setDraft({...draft,allergens:v})}/><label className="checkbox-row"><Switch checked={draft.extra} onCheckedChange={v=>setDraft({...draft,extra:v})}/><span><b>Proposé en supplément</b></span></label><ErrorBox message={error}/><div className="inline-between"><Button tone="quiet" onClick={()=>setAdding(false)}>Annuler</Button><Button busy={busy} disabled={draft.name.trim().length<2} onClick={()=>void create()}>Ajouter l’ingrédient</Button></div></div>}
  <div className="admin-toolbar"><div className="category-tabs"><button className={`category-tab ${!onlyOut?'active-admin-filter':''}`} onClick={()=>setOnlyOut(false)}>Tous ({ingredients.length})</button><button className={`category-tab ${onlyOut?'active-admin-filter':''}`} onClick={()=>setOnlyOut(true)}>En rupture ({out})</button></div><div className="search-field"><Search size={17}/><input aria-label="Rechercher un ingrédient" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Chercher…"/>{query&&<button aria-label="Effacer la recherche" onClick={()=>setQuery('')}><X size={16}/></button>}</div></div>
  <div className="ing-admin-list">{visible.map(i=><IngredientRow key={i.id} ingredient={i} used={usage(products,i.id)} refresh={refresh}/>)}</div>
 </section>;
}
function IngredientRow({ingredient:i,used,refresh}:{ingredient:Ingredient;used:Product[];refresh:()=>Promise<void>}){
 const[open,setOpen]=useState(false),[name,setName]=useState(i.name),[list,setList]=useState(i.allergens),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const dirty=name.trim()!==i.name||list.join()!==i.allergens.join();
 const put=async(key:string,changes:Partial<Ingredient>,done:string)=>{setBusy(key);setError('');try{await api(`admin/ingredients/${i.id}`,'PUT',changes);toast.success(done);await refresh();if(key==='save')setOpen(false);}catch(e){setError((e as Error).message);}finally{setBusy('');}};
 const remove=async()=>{setBusy('delete');setError('');try{await api(`admin/ingredients/${i.id}`,'DELETE');toast.success(`${i.name} supprimé`);await refresh();}catch(e){setError((e as Error).message);setBusy('');}};
 return <article className={`ing-admin-row ${!i.available?'is-out':''}`}>
  <div className="ing-admin-main"><strong>{i.name}{i.meat&&<span className="badge"><Beef size={12}/> {meatLabel(i.meat)}</span>}{i.locked&&<span className="badge">Dans toutes les pizzas</span>}</strong><p className="small">{i.allergens.length?i.allergens.map(allergenLabel).join(', '):'Aucun allergène déclaré'}<span className="muted"> · {used.length?`${used.length} recette${used.length>1?'s':''}`:'aucune recette'}</span></p></div>
  <div className="ing-admin-actions">{!i.locked&&<label className="checkbox-row"><Switch checked={i.available} disabled={!!busy} onCheckedChange={v=>void put('available',{available:v},v?`${i.name} est de retour`:`${i.name} en rupture : retiré des pizzas et des suppléments`)}/>Disponible</label>}{!i.locked&&<label className="checkbox-row"><Switch checked={i.extra} disabled={!!busy} onCheckedChange={v=>void put('extra',{extra:v},v?`${i.name} proposé en supplément`:`${i.name} n’est plus proposé en supplément`)}/>Supplément</label>}<Button tone="outline" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'Fermer':'Modifier'}</Button></div>
  {open&&<div className="ing-admin-edit"><Field label="Nom" id={`ing-${i.id}`}><input id={`ing-${i.id}`} maxLength={40} value={name} onChange={e=>setName(e.target.value)}/></Field><p className="small"><b>Allergènes</b></p><AllergenToggles value={list} onChange={setList}/>{used.length>0&&<p className="small muted">Utilisé dans : {used.map(p=>p.name).join(', ')}.</p>}<ErrorBox message={error}/><div className="inline-between">{!i.locked?<Button tone="danger" busy={busy==='delete'} disabled={used.length>0} title={used.length?'Retirez-le d’abord des recettes':undefined} onClick={()=>void remove()}><Trash2 size={16}/> Supprimer</Button>:<span/>}<Button busy={busy==='save'} disabled={!dirty||name.trim().length<2} onClick={()=>void put('save',{name:name.trim(),allergens:list},`${name.trim()} enregistré`)}>Enregistrer</Button></div></div>}
  {!open&&error&&<ErrorBox message={error}/>}
 </article>;
}

const suggestions=['France','Union européenne','Hors Union européenne','Espagne','Allemagne','Pays-Bas','Belgique','Irlande','Pologne','Italie','Brésil'];
/** Origin of meats, required on the menu of restaurants (décret n° 2022-65): one line per meat ingredient. */
export function OriginsAdmin({ingredients,products,refresh}:Props){
 const initial=useMemo(()=>Object.fromEntries(ingredients.map(i=>[i.id,{meat:i.meat,origin:i.origin}])),[ingredients]);
 const[rows,setRows]=useState(initial),[extra,setExtra]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const dirty=ingredients.some(i=>rows[i.id]&&(rows[i.id].meat!==i.meat||rows[i.id].origin.trim()!==i.origin));
 // Fresh data from the server replaces the form only while nothing is being typed.
 useEffect(()=>{if(dirty)return;const t=window.setTimeout(()=>setRows(initial),0);return()=>window.clearTimeout(t);},[initial,dirty]);
 const meatRows=ingredients.filter(i=>i.meat||extra.includes(i.id)||rows[i.id]?.meat);const missing=meatRows.filter(i=>!(rows[i.id]?.origin||'').trim()).length;
 const set=(id:string,v:Partial<{meat:string;origin:string}>)=>setRows(r=>({...r,[id]:{...(r[id]||{meat:'',origin:''}),...v}}));
 const save=async()=>{setBusy(true);setError('');try{const changed=ingredients.filter(i=>rows[i.id]&&(rows[i.id].meat!==i.meat||rows[i.id].origin.trim()!==i.origin)).map(i=>({id:i.id,meat:rows[i.id].meat,origin:rows[i.id].origin.trim()}));await api('admin/origins','PUT',changed);toast.success('Origines des viandes enregistrées');setExtra([]);await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const preview=originsOf(meatRows.map(i=>({...i,meat:rows[i.id]?.meat||i.meat,origin:rows[i.id]?.origin||''})).filter(i=>i.meat));
 return <section className="panel origins-admin">
  <div className="menu-admin-head"><div><h2>Origine des viandes</h2><p className="small muted">En restauration, l’origine du bœuf, du porc, de la volaille et de l’agneau doit être indiquée aux clients, y compris à emporter (décret n° 2022-65). Écrivez le pays d’élevage et d’abattage, par exemple « France », ou « Union européenne » si vos fournisseurs varient. L’origine s’affiche sur la fiche de chaque pizza concernée et sur la page Allergènes.</p></div></div>
  {missing>0&&<div className="banner">{missing} viande{missing>1?'s':''} sans origine renseignée.</div>}
  <div className="origins-list">{meatRows.map(i=>{const r=rows[i.id]||{meat:'',origin:''};const used=usage(products,i.id);return <div className="origin-row" key={i.id}><div><strong>{i.name}</strong><p className="small muted">{used.length?`${used.length} pizza${used.length>1?'s':''} : ${used.slice(0,4).map(p=>p.name).join(', ')}${used.length>4?'…':''}`:'Pas encore dans une recette'}</p></div><Field label="Viande" id={`meat-${i.id}`}><select id={`meat-${i.id}`} className="native-select" value={r.meat} onChange={e=>set(i.id,{meat:e.target.value})}><option value="">Pas une viande</option>{meats.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></Field><Field label="Origine" id={`origin-${i.id}`}><input id={`origin-${i.id}`} list="origin-suggestions" maxLength={80} value={r.origin} onChange={e=>set(i.id,{origin:e.target.value})} placeholder="Ex. France"/></Field></div>;})}</div>
  <datalist id="origin-suggestions">{suggestions.map(s=><option key={s} value={s}/>)}</datalist>
  <div className="origin-add"><Field label="Une viande manque dans la liste ?" id="origin-more"><select id="origin-more" className="native-select" value="" onChange={e=>{if(e.target.value){setExtra(x=>[...x,e.target.value]);set(e.target.value,{meat:'boeuf'});}}}><option value="">Choisir un ingrédient…</option>{ingredients.filter(i=>!meatRows.includes(i)&&!i.locked).map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></Field></div>
  {preview.length>0&&<div className="origin-preview"><p className="small"><b>Ce que voient les clients</b></p><p className="small">{preview.join(' · ')}</p></div>}
  <ErrorBox message={error}/>
  <div className="settings-actions"><span>{dirty?'Modifications non enregistrées':'Origines à jour'}</span><Button busy={busy} disabled={!dirty} onClick={()=>void save()}><Save size={16}/> Enregistrer les origines</Button></div>
 </section>;
}
