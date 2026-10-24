'use client';
/* eslint-disable @next/next/no-img-element */
import {useEffect,useRef,useState} from 'react';
import {Plus,Pencil,Trash2,Camera,ImageOff,Search,X,RotateCcw,AlertTriangle,Flame,Megaphone} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogClose} from '@/components/ui/dialog';
import {Switch} from '@/components/ui/switch';
import {Checkbox} from '@/components/ui/checkbox';
import {toast} from 'sonner';
import {api,Button,ErrorBox,Field} from '../components';
import {PizzaPhoto,hasPhoto} from '../pizza-photo';
import {categories,money,type Product} from '@/lib/catalog';
import {allergens,allergenLabel,allergensOf,describe,meats,normalizeText,type Ingredient} from '@/lib/menu';
import {isPizza} from '@/lib/pricing';
import {loadImage,detect,render,exportPhoto,uploadPhoto,type Crop} from './photo-tools';

type Props={products:Product[];ingredients:Ingredient[];refresh:()=>Promise<void>;onAnnounce?: (id:string)=>void};
const euros=(c:number|null|undefined)=>c==null?'':String(c/100).replace('.',',');
const cents=(v:string)=>{const n=Math.round(Number(v.replace(/\s|€/g,'').replace(',','.'))*100);return Number.isFinite(n)&&n>0?n:NaN;};

/** The whole menu for the team: add, edit, pause, remove. Quick switches save at once (a stock-out cannot wait). */
export function MenuAdmin({products,ingredients,refresh,onAnnounce}:Props){
 const[filter,setFilter]=useState('all'),[query,setQuery]=useState(''),[editing,setEditing]=useState<Product|'pizza'|'unique'|null>(null),[error,setError]=useState('');
 const live=products.filter(p=>p.status!=='archived'),drafts=products.filter(p=>p.status==='draft').length,archived=products.filter(p=>p.status==='archived').length;
 const noPhoto=live.filter(p=>isPizza(p)&&!hasPhoto(p)).length,unchecked=live.filter(p=>!p.allergensChecked&&((p.ingredients||[]).length||(p.allergens||[]).length)).length;
 const visible=products.filter(p=>(filter==='archived'?p.status==='archived':filter==='draft'?p.status==='draft':p.status!=='archived'&&(filter==='all'||p.category===filter))&&normalizeText(`${p.name} ${p.description}`).includes(normalizeText(query)));
 const filters:[string,string][]=[['all','Toute la carte'],...categories.map(c=>[c.id,c.name] as [string,string]),...(drafts?[['draft',`Brouillons (${drafts})`] as [string,string]]:[]),...(archived?[['archived',`Retirées (${archived})`] as [string,string]]:[])];
 return <section className="panel menu-admin">
  <div className="menu-admin-head"><div><h2>La carte</h2><p className="small muted">Ajoutez une pizza avec sa recette et sa photo : elle apparaît aussitôt sur le site, dans la roue et dans la liste des pizzas offertes. Les commandes déjà passées gardent leurs prix.</p></div><div className="ticket-actions"><Button onClick={()=>setEditing('pizza')}><Plus size={17}/> Nouvelle pizza</Button><Button tone="outline" onClick={()=>setEditing('unique')}><Plus size={17}/> Dessert, boisson…</Button></div></div>
  {(noPhoto>0||unchecked>0)&&<div className="banner admin-alerts">{noPhoto>0&&<span><ImageOff size={16}/> {noPhoto} pizza{noPhoto>1?'s':''} sans photo : absente{noPhoto>1?'s':''} de la roue d’accueil.</span>}{unchecked>0&&<span><AlertTriangle size={16}/> {unchecked} article{unchecked>1?'s':''} aux allergènes à vérifier puis à valider.</span>}</div>}
  <div className="admin-toolbar"><div className="category-tabs">{filters.map(([v,l])=><button className={`category-tab ${filter===v?'active-admin-filter':''}`} key={v} onClick={()=>setFilter(v)}>{l}</button>)}</div><div className="search-field"><Search size={17}/><input aria-label="Rechercher un article" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nom, ingrédient…"/>{query&&<button aria-label="Effacer la recherche" onClick={()=>setQuery('')}><X size={16}/></button>}</div></div>
  <ErrorBox message={error}/>
  {!visible.length?<div className="empty"><h3>Aucun article ici</h3></div>:<div className="menu-admin-list">{visible.map(p=><MenuItem key={p.id} product={p} onEdit={()=>setEditing(p)} refresh={refresh} onError={setError}/>)}</div>}
  {editing&&<ProductEditor key={typeof editing==='string'?editing:editing.id} initial={typeof editing==='string'?null:editing} pizza={typeof editing==='string'?editing==='pizza':isPizza(editing)} ingredients={ingredients} refresh={refresh} onClose={()=>setEditing(null)} onAnnounce={onAnnounce}/>}
 </section>;
}
function MenuItem({product:p,onEdit,refresh,onError}:{product:Product;onEdit:()=>void;refresh:()=>Promise<void>;onError:(e:string)=>void}){
 const[busy,setBusy]=useState('');
 const patch=async(key:string,changes:Partial<Product>,done:string)=>{setBusy(key);onError('');try{await api(`admin/products/${p.id}`,'PUT',{...changes,version:p.version});toast.success(done);await refresh();}catch(e){onError((e as Error).message);await refresh();}finally{setBusy('');}};
 return <article className={`menu-item ${p.status!=='published'?'is-muted':''}`}>
  <button type="button" className="menu-item-photo" onClick={onEdit} aria-label={`Modifier ${p.name}`}>{isPizza(p)?<PizzaPhoto product={p} decorative sizes="64px"/>:<span className="menu-item-icon">{p.name.slice(0,1)}</span>}</button>
  <div className="menu-item-main"><strong>{p.name}{p.spicy&&<Flame size={14} aria-label="Piquante"/>}</strong><p>{p.description}</p><div className="menu-badges">{p.status==='draft'&&<span className="badge">Brouillon</span>}{p.status==='archived'&&<span className="badge">Retirée de la carte</span>}{isPizza(p)&&!hasPhoto(p)&&<span className="badge warn">Sans photo</span>}{!p.allergensChecked&&((p.ingredients||[]).length>0||(p.allergens||[]).length>0)&&<span className="badge warn">Allergènes à vérifier</span>}{!p.available&&p.status!=='archived'&&<span className="badge warn">En rupture</span>}{p.offer&&<span className="offer-badge">2e offerte</span>}</div></div>
  <div className="menu-item-price">{money(p.price)}{p.xxl!==null&&<small>XXL {money(p.xxl)}</small>}</div>
  <div className="menu-item-actions">{p.status==='archived'?<Button tone="outline" busy={busy==='restore'} onClick={()=>patch('restore',{status:'published'},`${p.name} est de retour sur la carte`)}><RotateCcw size={16}/> Remettre sur la carte</Button>:<><label className="checkbox-row"><Switch checked={p.available} disabled={!!busy} onCheckedChange={v=>void patch('available',{available:v},v?`${p.name} est de nouveau disponible`:`${p.name} est en rupture pour le moment`)}/>Disponible</label>{isPizza(p)&&<label className="checkbox-row"><Switch checked={!!p.offer} disabled={!!busy} onCheckedChange={v=>void patch('offer',{offer:v},v?`2e pizza offerte activée sur ${p.name}`:`2e pizza offerte arrêtée sur ${p.name}`)}/>2e offerte</label>}<Button tone="outline" onClick={onEdit}><Pencil size={16}/> Modifier</Button></>}</div>
 </article>;
}

/** The 14 regulatory allergens as toggles. `locked`: already brought by the recipe's ingredients. */
export function AllergenToggles({value,onChange,locked=[],label='Allergènes'}:{value:string[];onChange:(v:string[])=>void;locked?:string[];label?:string}){
 return <div className="allergen-toggles" role="group" aria-label={label}>{allergens.map(a=>{const inherited=locked.includes(a.id),on=inherited||value.includes(a.id);return <button type="button" key={a.id} className={`allergen-toggle ${on?'on':''} ${inherited?'inherited':''}`} aria-pressed={on} disabled={inherited} title={inherited?'Apporté par un ingrédient de la recette':undefined} onClick={()=>onChange(value.includes(a.id)?value.filter(x=>x!==a.id):[...value,a.id])}>{a.label}</button>;})}</div>;
}

type Pending={img:HTMLImageElement;base:Crop;warnings:string[];z:number;dx:number;dy:number};
const cropOf=(p:Pending):Crop=>({cx:p.base.cx+p.dx*p.base.r,cy:p.base.cy+p.dy*p.base.r,r:p.base.r/p.z});
function ProductEditor({initial,pizza,ingredients,refresh,onClose,onAnnounce}:{initial:Product|null;pizza:boolean;ingredients:Ingredient[];refresh:()=>Promise<void>;onClose:()=>void;onAnnounce?: (id:string)=>void}){
 const isNew=!initial;
 const[f,setF]=useState(()=>({name:initial?.name||'',category:initial?.category||(pizza?'tomate':'desserts'),price:euros(initial?initial.price:pizza?1700:null),xxl:euros(initial?initial.xxl:pizza?2200:null),ingredients:initial?.ingredients||(pizza?['pate']:[]),description:initial?.description||'',tagline:initial?.tagline||'',options:(initial?.options||[]).join(', '),allergens:initial?.allergens||[],allergensChecked:!!initial?.allergensChecked,spicy:!!initial?.spicy,offer:!!initial?.offer,available:initial?.available??true,publish:initial?.status!=='draft'}));
 // The menu text follows the recipe until the team writes its own.
 const[autoText,setAutoText]=useState(()=>isNew||!initial?.description||initial.description===describe(initial.ingredients||[],ingredients));
 const[photo,setPhoto]=useState<Pending|null>(null),[removePhoto,setRemovePhoto]=useState(false);
 const[busy,setBusy]=useState(''),[error,setError]=useState(''),[fields,setFields]=useState<Record<string,string>>({}),[confirmDelete,setConfirmDelete]=useState(false);
 const patch=(v:Partial<typeof f>)=>setF(x=>{const next={...x,...v};if(v.ingredients&&autoText)next.description=describe(next.ingredients,ingredients);return next;});
 const inherited=allergensOf({ingredients:f.ingredients,allergens:[]},ingredients);
 const validate=()=>{const e:Record<string,string>={};const price=cents(f.price),xxl=cents(f.xxl);
  if(f.name.trim().length<2)e.name='Indiquez le nom.';
  if(!(price>0&&price<=10000))e.price='Indiquez un prix entre 0,01 € et 100 €.';
  if(pizza&&!(xxl>price&&xxl<=10000))e.xxl='Le prix XXL doit être supérieur au prix Senior.';
  if(pizza&&f.publish&&f.ingredients.filter(id=>!ingredients.find(i=>i.id===id)?.locked).length<1)e.ingredients='Ajoutez les ingrédients de la pizza avant de la publier.';
  setFields(e);return Object.keys(e).length?null:{price,xxl:pizza?xxl:null};};
 const save=async()=>{const ok=validate();if(!ok){setError('Vérifiez les champs signalés.');return;}setBusy('save');setError('');
  const body={name:f.name.trim(),category:f.category,description:f.description.trim(),tagline:f.tagline.trim(),price:ok.price,xxl:ok.xxl,ingredients:f.ingredients,allergens:f.allergens.filter(a=>!inherited.includes(a)),allergensChecked:f.allergensChecked,options:f.options.split(',').map(o=>o.trim()).filter(Boolean),spicy:f.spicy,offer:pizza&&f.offer,available:f.available,status:f.publish?'published':'draft'};
  let product:Product;
  try{product=(isNew?await api<{product:Product}>('admin/products','POST',body):await api<{product:Product}>(`admin/products/${initial!.id}`,'PUT',{...body,version:initial!.version})).product;}
  catch(e){setError((e as Error).message);setBusy('');return;}
  try{if(photo){setBusy('photo');product=await uploadPhoto(product.id,await exportPhoto(photo.img,cropOf(photo))) as Product;}else if(removePhoto&&initial&&hasPhoto(initial))await api(`admin/products/${initial.id}/photo`,'DELETE');}
  catch(e){toast.error(`${body.name} est enregistrée, mais la photo n’a pas été envoyée : ${(e as Error).message}`);}
 const announce=isNew&&f.publish&&pizza&&!!onAnnounce;
  toast.success(isNew?(f.publish?`${body.name} est en ligne sur la carte`:`${body.name} est enregistrée en brouillon`):`${body.name} est enregistrée`,announce?{action:{label:'Annoncer par SMS',onClick:()=>onAnnounce(product.id)},duration:9000}:undefined);
  await refresh();setBusy('');onClose();};
 const remove=async()=>{setBusy('delete');setError('');try{const r=await api<{archived:boolean}>(`admin/products/${initial!.id}`,'DELETE');toast.success(r.archived?`${initial!.name} est retirée de la carte. Elle reste dans l’historique des commandes.`:`${initial!.name} est supprimée.`);await refresh();onClose();}catch(e){setError((e as Error).message);setBusy('');setConfirmDelete(false);}};
 const title=isNew?(pizza?'Nouvelle pizza':'Nouvel article'):`Modifier ${initial!.name}`;
 return <Dialog open onOpenChange={v=>{if(!v&&!busy)onClose();}}><DialogContent className="dolce-dialog editor-dialog" showCloseButton={false}><DialogClose className="icon-button modal-close" aria-label="Fermer"><X size={20}/></DialogClose><DialogTitle className="modal-title">{title}</DialogTitle><DialogDescription className="muted">{pizza?'Recette, prix, allergènes et photo : tout ce qui apparaît sur le site et sur le ticket cuisine.':'Dessert, boisson ou menu à prix unique.'}</DialogDescription>
  <div className="editor-body">
   <section className="editor-section"><h3>L’essentiel</h3><div className="form-grid"><Field label="Nom" id="p-name" error={fields.name}><input id="p-name" maxLength={60} value={f.name} onChange={e=>patch({name:e.target.value})} placeholder={pizza?'Ex. Chorizo Miel':'Ex. Panna cotta'} aria-invalid={!!fields.name}/></Field><Field label="Catégorie" id="p-cat"><select id="p-cat" className="native-select" value={f.category} onChange={e=>patch({category:e.target.value})}>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field></div>
    <div className="form-grid"><Field label={pizza?'Prix Senior · 31 cm':'Prix'} id="p-price" error={fields.price}><input id="p-price" inputMode="decimal" value={f.price} onChange={e=>patch({price:e.target.value})} aria-invalid={!!fields.price}/></Field>{pizza&&<Field label="Prix XXL · 40 cm" id="p-xxl" error={fields.xxl}><input id="p-xxl" inputMode="decimal" value={f.xxl} onChange={e=>patch({xxl:e.target.value})} aria-invalid={!!fields.xxl}/></Field>}</div></section>
   <section className="editor-section"><h3>Recette</h3><p className="small muted">Les clients pourront retirer chacun de ces ingrédients (sauf la pâte), et ajouter des suppléments.</p><IngredientPicker value={f.ingredients} onChange={v=>patch({ingredients:v})} ingredients={ingredients} refresh={refresh}/>{fields.ingredients&&<p className="field-error">{fields.ingredients}</p>}</section>
   <section className="editor-section"><h3>Texte sur la carte</h3><Field label="Description" id="p-desc" hint={autoText?'Écrite automatiquement à partir de la recette. Modifiez-la si vous le souhaitez.':undefined}><textarea id="p-desc" className="resize-none" maxLength={300} value={f.description} onChange={e=>{setAutoText(false);patch({description:e.target.value});}}/></Field>{!autoText&&f.ingredients.length>0&&<button type="button" className="link-button" onClick={()=>{setAutoText(true);patch({description:describe(f.ingredients,ingredients)});}}>Réécrire depuis la recette</button>}
    {pizza&&<Field label="Phrase d’accroche (sous la pizza, dans la roue)" id="p-tag" hint="60 caractères conseillés."><input id="p-tag" maxLength={80} value={f.tagline} onChange={e=>patch({tagline:e.target.value})} placeholder="Ex. Le piquant du chorizo, la douceur du miel."/></Field>}
    <Field label="Garniture au choix (facultatif)" id="p-opt" hint="Séparées par des virgules. Ex. Poulet, Bœuf haché, Jambon de dinde"><input id="p-opt" value={f.options} onChange={e=>patch({options:e.target.value})}/></Field></section>
   <section className="editor-section"><h3>Allergènes</h3><p className="small muted">Ceux des ingrédients sont cochés automatiquement. Cochez en plus ceux d’une sauce ou d’une préparation qui n’est pas listée.</p><AllergenToggles value={f.allergens} locked={inherited} onChange={v=>patch({allergens:v})}/><label className="checkbox-row allergen-check"><Checkbox checked={f.allergensChecked} onCheckedChange={v=>patch({allergensChecked:v===true})}/><span><b>J’ai vérifié les allergènes de cette recette</b><br/><small className="muted">Avec les fiches de vos fournisseurs. Tant que ce n’est pas coché, le site indique « liste en cours de validation ».</small></span></label></section>
   {pizza&&<section className="editor-section"><h3>Photo</h3><PhotoEditor product={initial} pending={photo} setPending={setPhoto} remove={removePhoto} setRemove={setRemovePhoto}/></section>}
   <section className="editor-section"><h3>Sur le site</h3><div className="editor-switches"><label className="checkbox-row"><Switch checked={f.publish} onCheckedChange={v=>patch({publish:v})}/><span><b>Publiée</b><br/><small className="muted">Sinon, brouillon invisible des clients.</small></span></label><label className="checkbox-row"><Switch checked={f.available} onCheckedChange={v=>patch({available:v})}/><span><b>Disponible</b><br/><small className="muted">Coupez en cas de rupture.</small></span></label>{pizza&&<label className="checkbox-row"><Switch checked={f.offer} onCheckedChange={v=>patch({offer:v})}/><span><b>2e pizza offerte</b><br/><small className="muted">2e pizza de même taille, la moins chère offerte.</small></span></label>}<label className="checkbox-row"><Switch checked={f.spicy} onCheckedChange={v=>patch({spicy:v})}/><span><b>Piquante</b><br/><small className="muted">Pastille flamme sur la carte.</small></span></label></div></section>
  </div>
  <ErrorBox message={error}/>
  <div className="editor-actions">{!isNew&&<Button tone="danger" disabled={!!busy} onClick={()=>setConfirmDelete(true)}><Trash2 size={16}/> Supprimer</Button>}<span/><Button tone="quiet" disabled={!!busy} onClick={onClose}>Annuler</Button><Button busy={busy==='save'||busy==='photo'} onClick={()=>void save()}>{busy==='photo'?'Envoi de la photo…':isNew?(f.publish?'Publier':'Enregistrer le brouillon'):'Enregistrer'}</Button></div>
  {confirmDelete&&<div className="banner confirm-delete" role="alertdialog" aria-label="Confirmer la suppression"><p><b>Supprimer {initial!.name} ?</b> Elle disparaît du site, de la roue et des paniers. Si elle a déjà été commandée, elle reste dans l’historique des commandes, et vous pourrez la remettre sur la carte.</p><div className="inline-between"><Button tone="quiet" onClick={()=>setConfirmDelete(false)}>Garder</Button><Button tone="danger" busy={busy==='delete'} onClick={()=>void remove()}>Supprimer</Button></div></div>}
 </DialogContent></Dialog>;
}

function IngredientPicker({value,onChange,ingredients,refresh}:{value:string[];onChange:(v:string[])=>void;ingredients:Ingredient[];refresh:()=>Promise<void>}){
 const[q,setQ]=useState(''),[creating,setCreating]=useState<{name:string;allergens:string[];meat:string;extra:boolean}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const byId=(id:string)=>ingredients.find(i=>i.id===id);const term=normalizeText(q);
 const matches=term?ingredients.filter(i=>!value.includes(i.id)&&normalizeText(i.name).includes(term)).slice(0,8):[];
 const exact=ingredients.some(i=>normalizeText(i.name)===term);const canCreate=q.trim().length>=2&&!exact;
 const addIds=(ids:string[])=>{onChange([...value,...ids.filter(id=>!value.includes(id)&&byId(id))]);setQ('');};
 // A base (sauce + mozzarella) goes right after the dough, so the generated menu text reads in the usual order.
 const addBase=(ids:string[])=>{const fresh=ids.filter(id=>!value.includes(id)&&byId(id)),at=value.indexOf('pate')+1;onChange([...value.slice(0,at),...fresh,...value.slice(at)]);};
 const create=async()=>{if(!creating)return;setBusy(true);setError('');try{const r=await api<{ingredient:Ingredient}>('admin/ingredients','POST',{name:creating.name.trim(),allergens:creating.allergens,meat:creating.meat,origin:'',extra:creating.extra,available:true});await refresh();onChange([...value,r.ingredient.id]);setCreating(null);setQ('');toast.success(`${r.ingredient.name} ajouté aux ingrédients`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <div className="ing-picker">
  {value.length>0&&<ol className="ing-chips recipe-chips">{value.map(id=>{const i=byId(id);return <li className={`ing-chip is-static ${i?.locked?'is-locked':''}`} key={id}><span>{i?.name||id}{!!i?.allergens.length&&<small>{i.allergens.map(allergenLabel).join(', ')}</small>}</span><button type="button" aria-label={`Retirer ${i?.name||id} de la recette`} onClick={()=>onChange(value.filter(x=>x!==id))}><X size={13}/></button></li>;})}</ol>}
  <div className="quick-bases">{!value.includes('pate')&&byId('pate')&&<button type="button" className="chip-button" onClick={()=>addIds(['pate'])}>+ Pâte à pizza</button>}<button type="button" className="chip-button" onClick={()=>addBase(['sauce-tomate','mozzarella'])}>+ Base tomate</button><button type="button" className="chip-button" onClick={()=>addBase(['creme-fraiche','mozzarella'])}>+ Base crème</button></div>
  <div className="search-field"><Search size={17}/><input aria-label="Ajouter un ingrédient" value={q} onChange={e=>setQ(e.target.value)} placeholder="Ajouter un ingrédient : chorizo, miel…" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(matches[0])addIds([matches[0].id]);else if(canCreate)setCreating({name:q.trim(),allergens:[],meat:'',extra:true});}}}/>{q&&<button aria-label="Effacer" onClick={()=>setQ('')}><X size={16}/></button>}</div>
  {(matches.length>0||canCreate)&&!creating&&<div className="ing-suggestions">{matches.map(i=><button type="button" key={i.id} onClick={()=>addIds([i.id])}><Plus size={14}/>{i.name}{!!i.allergens.length&&<small>{i.allergens.map(allergenLabel).join(', ')}</small>}</button>)}{canCreate&&<button type="button" className="create" onClick={()=>setCreating({name:q.trim(),allergens:[],meat:'',extra:true})}><Plus size={14}/>Créer l’ingrédient « {q.trim()} »</button>}</div>}
  {creating&&<div className="ing-create"><Field label="Nouvel ingrédient" id="new-ing"><input id="new-ing" maxLength={40} value={creating.name} onChange={e=>setCreating({...creating,name:e.target.value})}/></Field><p className="small"><b>Ses allergènes</b></p><AllergenToggles value={creating.allergens} onChange={v=>setCreating({...creating,allergens:v})}/><div className="form-grid"><Field label="Est-ce une viande ?" id="new-meat" hint="Son origine se renseigne dans l’onglet Origines."><select id="new-meat" className="native-select" value={creating.meat} onChange={e=>setCreating({...creating,meat:e.target.value})}><option value="">Non</option>{meats.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></Field><label className="checkbox-row"><Switch checked={creating.extra} onCheckedChange={v=>setCreating({...creating,extra:v})}/><span><b>Proposé en supplément</b></span></label></div><ErrorBox message={error}/><div className="inline-between"><Button tone="quiet" onClick={()=>setCreating(null)}>Annuler</Button><Button busy={busy} disabled={creating.name.trim().length<2} onClick={()=>void create()}>Créer et ajouter à la recette</Button></div></div>}
 </div>;
}

function PhotoEditor({product,pending,setPending,remove,setRemove}:{product:Product|null;pending:Pending|null;setPending:(p:Pending|null)=>void;remove:boolean;setRemove:(v:boolean)=>void}){
 const input=useRef<HTMLInputElement>(null);const[error,setError]=useState(''),[preview,setPreview]=useState(''),[loading,setLoading]=useState(false);
 // Re-render the cut-out shortly after the sliders stop, not on every pixel of movement.
 useEffect(()=>{if(!pending)return;const t=window.setTimeout(()=>setPreview(render(pending.img,cropOf(pending),360).toDataURL('image/png')),40);return()=>window.clearTimeout(t);},[pending]);
 const choose=async(file?:File)=>{if(!file)return;setError('');setLoading(true);try{const img=await loadImage(file);const d=detect(img);setPending({img,base:d.crop,warnings:d.warnings,z:1,dx:0,dy:0});setRemove(false);}catch(e){setError((e as Error).message);}finally{setLoading(false);}};
 const current=product&&hasPhoto(product)&&!remove;const shown=pending?preview:'';
 const slider=(key:'z'|'dx'|'dy',label:string,min:number,max:number)=>pending&&<label className="photo-slider"><span>{label}</span><input type="range" min={min} max={max} step={.005} value={pending[key]} onChange={e=>setPending({...pending,[key]:Number(e.target.value)})}/></label>;
 return <div className="photo-editor">
  <div className="photo-stage">{pending?(shown?<><img className="photo-preview" src={shown} alt="Aperçu du détourage"/><span className="slice-preview" aria-hidden="true"><span className="pizza-slice"><img src={shown} alt=""/></span></span></>:<div className="photo-empty">Préparation…</div>):current?<PizzaPhoto product={product} className="photo-current" decorative sizes="240px"/>:<div className="photo-empty"><Camera size={30}/><p>Aucune photo</p></div>}
   <svg width="0" height="0" aria-hidden="true" className="wheel-defs"><clipPath id="admin-slice-clip" clipPathUnits="objectBoundingBox"><path d="M.5 1L0 .0664A1.3952 1 0 0 1 1 .0664Z"/></clipPath></svg></div>
  <div className="photo-side">
   <p className="small muted">Vue de dessus, pizza entière, sur fond noir mat. Le détourage et les trois tailles sont préparés ici, automatiquement. À droite : la part telle qu’elle apparaîtra dans la roue.</p>
   <input ref={input} type="file" accept="image/*" hidden onChange={e=>{void choose(e.target.files?.[0]);e.target.value='';}}/>
   <Button tone="outline" busy={loading} onClick={()=>input.current?.click()}><Camera size={16}/> {pending||current?'Changer la photo':'Ajouter une photo'}</Button>
   <ErrorBox message={error}/>
   {pending&&<>{pending.warnings.map(w=><p className="field-error" key={w}>{w}</p>)}{slider('z','Zoom',.8,1.25)}{slider('dx','Gauche / droite',-.25,.25)}{slider('dy','Haut / bas',-.25,.25)}<div className="inline-between"><button type="button" className="link-button" onClick={()=>setPending({...pending,z:1,dx:0,dy:0})}>Recentrer automatiquement</button><button type="button" className="link-button" onClick={()=>setPending(null)}>Annuler cette photo</button></div></>}
   {!pending&&current&&<button type="button" className="link-button" onClick={()=>setRemove(true)}>Retirer la photo</button>}
   {remove&&!pending&&<p className="small">La photo sera retirée à l’enregistrement. <button type="button" className="link-button" onClick={()=>setRemove(false)}>Annuler</button></p>}
   {!pending&&<p className="small muted"><Megaphone size={13}/> Astuce : même lumière et même hauteur pour toutes les photos, la carte reste homogène.</p>}
  </div>
 </div>;
}
