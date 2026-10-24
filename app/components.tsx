'use client';
/* eslint-disable @next/next/no-html-link-for-pages */
import React,{createContext,useContext,useEffect,useRef,useState,useCallback} from 'react';
import {ShoppingBag,Plus,Minus,X,ArrowUpRight,Phone,Gift,Check,Loader2,ChevronDown} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogClose} from '@/components/ui/dialog';
import {Sheet,SheetContent,SheetTitle,SheetDescription,SheetClose} from '@/components/ui/sheet';
import {Toaster} from '@/components/ui/sonner';
import {toast} from 'sonner';
import {type Product,money,categories,sizeLabel,shortName} from '@/lib/catalog';
import {seedCatalog} from '@/lib/seed';
import {seedIngredients,allergensOf,allergenLabel,composition,originsOf,type Ingredient} from '@/lib/menu';
import {defaultSettings,parisParts,minutes,type Settings} from '@/lib/rules';
import {priceCart,isPizza,unitPrice,MAX_EXTRAS,type CartLine,type FreePizza,type Menu} from '@/lib/pricing';
import {PizzaPhoto} from './pizza-photo';
import {useIsMobile} from '@/hooks/use-mobile';
import type {PublicLocation} from '@/lib/server';
export type {CartLine};
/** A line as stored with the order: names rather than ids, so tickets stay readable if the menu changes. */
export type OrderItem={id:string;name:string;size:CartLine['size'];option:string;quantity:number;unitPrice:number;total?:number;free?:FreePizza;ticket?:boolean;without?:string[];extra?:string[];extrasPrice?:number};
export type Order={id:string;name:string;phone:string;email:string;items:OrderItem[];note:string;slot:string;subtotal:number;offer_discount?:number;discount:number;total:number;redeemed:number;earned:number;status:string;reason:string;created_at:string;updated_at:string;version:number};
const cartKey='dolce-cart';
const optionalText=(v:unknown)=>v===undefined||typeof v==='string';
const optionalIds=(v:unknown)=>v===undefined||Array.isArray(v)&&v.length<=20&&v.every(x=>typeof x==='string');
function validCart(value:unknown):CartLine[]{return Array.isArray(value)?value.filter((v:unknown):v is CartLine=>{if(!v||typeof v!=='object')return false;const line=v as Partial<CartLine>;return typeof line.id==='string'&&typeof line.size==='string'&&['senior','xxl','unique'].includes(line.size)&&typeof line.option==='string'&&optionalText(line.freeId)&&optionalText(line.freeOption)&&optionalIds(line.removed)&&optionalIds(line.added)&&optionalIds(line.freeRemoved)&&optionalIds(line.freeAdded)&&Number.isInteger(line.quantity)&&Number(line.quantity)>0&&Number(line.quantity)<=20;}):[];}
function readCart(key=cartKey){let raw='';try{raw=localStorage.getItem(key)||'';}catch{}if(!raw){const cookie=document.cookie.split('; ').find(v=>v.startsWith(`${key}=`));if(cookie)try{raw=decodeURIComponent(cookie.slice(key.length+1));}catch{return [];}}try{return validCart(JSON.parse(raw||'[]'));}catch{return [];}}
function writeCart(cart:CartLine[],key=cartKey){const raw=JSON.stringify(cart);try{localStorage.setItem(key,raw);}catch{}document.cookie=`${key}=${encodeURIComponent(raw)}; Path=/; Max-Age=604800; SameSite=Lax`;}
export async function api<T=unknown>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
 const timeout=AbortSignal.timeout(20000);
 let r:Response;
 const headers:Record<string,string>={};
 if(body!==undefined)headers['Content-Type']='application/json';
 // Device credentials are scoped to production endpoints and never sent to other APIs.
 if(typeof window!=='undefined'&&(/^(?:production)(?:\?|\/|$)/.test(path)||/^(?:staff\/(?:orders|catalog|routing|customers))(?:\?|\/|$)/.test(path))){try{const key=/^staff\//.test(path)?'dolce-pos-token':'dolce-production-device-token';const token=window.localStorage.getItem(key)||'';if(/^[0-9a-f]{64}$/.test(token))headers.Authorization=`Bearer ${token}`;}catch{}}
 try{r=await fetch(`/api/${path}`,{method,credentials:'same-origin',headers:Object.keys(headers).length?headers:undefined,body:body!==undefined?JSON.stringify(body):undefined,signal:signal?AbortSignal.any([signal,timeout]):timeout});}
 catch(e){if(signal?.aborted)throw e;throw new Error(timeout.aborted?'Le service met trop de temps à répondre. Réessayez : votre panier est conservé.':'Connexion interrompue. Vérifiez votre connexion puis réessayez.');}
 const data:unknown=await r.json().catch(()=>null);
 const details=data&&typeof data==='object'?data as {error?:string;fields?:unknown}:{};
 if(!r.ok||data===null)throw Object.assign(new Error(details.error||'Le service est momentanément indisponible. Réessayez.'),{status:r.status,fields:details.fields});return data as T;
}
export function useResource<T>(path:string,interval=0){
 const[data,setData]=useState<T|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const serial=useRef(0),controller=useRef<AbortController|null>(null);
 const refresh=useCallback(async()=>{const id=++serial.current;controller.current?.abort();const request=new AbortController();controller.current=request;
  try{const d=await api<T>(path,'GET',undefined,request.signal);if(id===serial.current&&!request.signal.aborted){setData(d);setError('');}}
  catch(e){if(!request.signal.aborted&&id===serial.current)setError((e as Error).message);}
  finally{if(id===serial.current){controller.current=null;if(!request.signal.aborted)setLoading(false);}}
 },[path]);
 useEffect(()=>{const first=window.setTimeout(()=>void refresh(),0);const timer=interval?window.setInterval(()=>{if(!document.hidden&&!controller.current)void refresh();},interval):null;
  const resume=()=>{if(!document.hidden)void refresh();};window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
  return()=>{controller.current?.abort();window.clearTimeout(first);if(timer)window.clearInterval(timer);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);};
 },[refresh,interval]);return{data,error,loading,refresh};
}

type Mods={removed:string[];added:string[]};type FreeChoice={id:string;option:string}&Mods;
type Shop={products:Product[];ingredients:Ingredient[];menu:Menu;settings:Settings;location:PublicLocation;loaded:boolean;cartReady:boolean;error:string;cart:CartLine[];setCart:React.Dispatch<React.SetStateAction<CartLine[]>>;add:(p:Product,size:CartLine['size'],option:string,qty:number,mods:Mods,free?:FreeChoice)=>void;cartOpen:boolean;setCartOpen:(v:boolean)=>void;priced:ReturnType<typeof priceCart>;subtotal:number;refresh:()=>void};
const Context=createContext<Shop>(null!);export const useShop=()=>useContext(Context);
const defaultLocation:PublicLocation={id:'ronchin',name:'Dolce Pizz’ Ronchin',addressLine1:'191 avenue Jean-Jaurès',postalCode:'59790',locality:'Ronchin',phone:'03 20 40 09 01',countryCode:'FR',timezone:'Europe/Paris'};
const sorted=(v?:string[])=>[...(v||[])].sort().join(',');
const sameLine=(a:CartLine,b:CartLine)=>a.id===b.id&&a.size===b.size&&a.option===b.option&&(a.freeId||'')===(b.freeId||'')&&(a.freeOption||'')===(b.freeOption||'')&&sorted(a.removed)===sorted(b.removed)&&sorted(a.added)===sorted(b.added)&&sorted(a.freeRemoved)===sorted(b.freeRemoved)&&sorted(a.freeAdded)===sorted(b.freeAdded);
// Only non-empty changes are stored, so a plain pizza keeps the same cart line as before customisation existed.
const withMods=(key:'removed'|'added'|'freeRemoved'|'freeAdded',ids:string[])=>ids.length?{[key]:ids}:{};
export function Providers({children,cartDrawer=true,storageKey=cartKey}:{children:React.ReactNode;cartDrawer?:boolean;storageKey?:string}){
 const source=useResource<{products:Product[];ingredients:Ingredient[];settings:Settings;location:PublicLocation|null}>('catalog',45000);const[cart,setCart]=useState<CartLine[]>([]);const[ready,setReady]=useState(false);const[cartOpen,setCartOpen]=useState(false);
 useEffect(()=>{const hydrate=window.setTimeout(()=>{setCart(readCart(storageKey));setReady(true);},0);return()=>window.clearTimeout(hydrate);},[storageKey]);
 useEffect(()=>{if(ready)writeCart(cart,storageKey);},[cart,ready,storageKey]);
 // Until the live menu arrives, the opening menu keeps the page complete (it is what the database starts with).
 const products=source.data?.products||seedCatalog,ingredients=source.data?.ingredients||seedIngredients,settings=source.data?.settings||defaultSettings,location=source.data?.location||defaultLocation;
 const menu:Menu={products,ingredients,extraPrice:settings.extraPrice};const priced=priceCart(cart,menu);
 // On phones, toasts sit at the top so they never cover the cart bar or the drawer's checkout button.
 const mobile=useIsMobile();
 const add=(p:Product,size:CartLine['size'],option:string,quantity:number,mods:Mods,free?:FreeChoice)=>{const line:CartLine={id:p.id,size,option,quantity,...withMods('removed',mods.removed),...withMods('added',mods.added),...(free?{freeId:free.id,freeOption:free.option,...withMods('freeRemoved',free.removed),...withMods('freeAdded',free.added)}:{})};setCart(rows=>{const at=rows.findIndex(l=>sameLine(l,line));return at<0?[...rows,line]:rows.map((l,i)=>i===at?{...l,quantity:Math.min(20,l.quantity+quantity)}:l);});toast.success(free?`${p.name} + pizza offerte ajoutées au panier`:`${p.name} ajoutée au panier`);};
 return <Context.Provider value={{products,ingredients,menu,settings,location,loaded:!!source.data,cartReady:ready,error:source.error,cart,setCart,add,cartOpen,setCartOpen,priced,subtotal:priced.subtotal,refresh:source.refresh}}>{children}{cartDrawer&&<CartDrawer/>}<Toaster position={mobile?'top-center':'bottom-center'} theme="dark" closeButton toastOptions={{className:'dolce-toast'}}/></Context.Provider>;
}
// Add-to-cart feedback: the pizza photo flies into the header cart, which then bounces.
export function bumpCart(){document.querySelectorAll('.cart-button, .cart-bar').forEach(el=>el.animate([{transform:'scale(1)'},{transform:'scale(1.22)'},{transform:'scale(.96)'},{transform:'scale(1)'}],{duration:520,easing:'cubic-bezier(.3,1.5,.5,1)'}));}
export function flyToCart(img:HTMLImageElement|null|undefined){
 const cart=[...document.querySelectorAll<HTMLElement>('.cart-bar, .cart-button')].find(el=>el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden');
 if(!img||!cart||matchMedia('(prefers-reduced-motion: reduce)').matches){bumpCart();return;}
 const a=img.getBoundingClientRect(),b=cart.getBoundingClientRect(),clone=img.cloneNode() as HTMLImageElement;
 Object.assign(clone.style,{position:'fixed',left:`${a.left}px`,top:`${a.top}px`,width:`${a.width}px`,height:`${a.height}px`,margin:'0',zIndex:'200',pointerEvents:'none',filter:'drop-shadow(0 18px 24px rgb(0 0 0 / .6))'});
 clone.removeAttribute('loading');document.body.appendChild(clone);
 const dx=b.left+b.width/2-(a.left+a.width/2),dy=b.top+b.height/2-(a.top+a.height/2),s=Math.max(.08,28/a.width);
 clone.animate([{transform:'translate(0,0) scale(1) rotate(0deg)'},{transform:`translate(${dx*.45}px,${dy*.45-90}px) scale(${Math.max(s,.5)}) rotate(160deg)`,offset:.55},{transform:`translate(${dx}px,${dy}px) scale(${s}) rotate(300deg)`,opacity:.6}],{duration:820,easing:'cubic-bezier(.55,0,.25,1)'}).finished.then(()=>{clone.remove();bumpCart();},()=>clone.remove());
}
export function Brand(){const{location}=useShop();return <a className="brand" href="/" aria-label="Dolce Pizz’, accueil"><span className="brand-script">Dolce Pizz<span className="brand-apostrophe">’</span></span><span className="brand-line">PIZZERIA ARTISANALE · {location.locality.toUpperCase()||'FRANCE'}</span></a>;}
// Live "open until" pill from the admin opening hours (Europe/Paris), refreshed every minute.
function useOpenStatus(s:Settings){const[now,setNow]=useState(0);useEffect(()=>{const tick=()=>setNow(Date.now());const first=window.setTimeout(tick,0),timer=window.setInterval(tick,60000);return()=>{window.clearTimeout(first);window.clearInterval(timer);};},[]);
 if(!now||!s.hoursConfirmed)return {open:false,label:'03 20 40 09 01',href:'tel:0320400901'};
 const p=parisParts(now),h=s.hours[p.day],start=minutes(h.open),end=minutes(h.close)||1440;
 if(!s.enabled)return {open:false,label:'Commande en ligne en pause',href:'/#infos'};
 if(h.closed||s.closures.includes(p.date))return {open:false,label:'Fermé aujourd’hui',href:'/#infos'};
 if(p.minute<start)return {open:false,label:`Ouvre à ${h.open}`,href:'/#infos'};
 if(p.minute<end)return {open:true,label:`Ouvert jusqu’à ${h.close==='00:00'?'minuit':h.close}`,href:'/#infos'};
 return {open:false,label:'Fermé pour ce soir',href:'/#infos'};}
export function Header(){const{priced,setCartOpen,settings}=useShop();const n=priced.count;const status=useOpenStatus(settings);return <><a className="skip" href="#contenu">Aller au contenu</a><header className="header"><div className="header-inner"><nav aria-label="Navigation principale"><a href="/#carte">La carte</a><a href="/compte">Le club</a><a href="/#infos">Infos</a></nav><Brand/><div className="header-actions"><a className="account-link" href="/compte">Mon compte</a><a className="mobile-menu-link" href="/#carte">La carte</a><button aria-label={`Ouvrir le panier, ${n} article${n>1?'s':''}`} className="cart-button" onClick={()=>setCartOpen(true)}><ShoppingBag size={17}/><span>Panier</span><b>{n}</b></button><a className={`open-pill ${status.open?'is-open':''}`} href={status.href}><span className="open-dot" aria-hidden="true"/>{status.label}</a></div></div></header></>;}
export function Footer(){const{location}=useShop();const phone=location.phone.replace(/[^\d+]/g,'');return <footer className="footer"><div className="footer-top"><Brand/><p>Plus qu’une pizza,<br/><em>une passion.</em></p><a href={`tel:${phone}`}><Phone size={18}/>{location.phone}</a></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Dolce Pizz’ · {location.locality||'France'}</span><div><a href="/allergenes">Allergènes</a><a href="/informations">Mentions légales & confidentialité</a><a href="/admin">Espace équipe</a></div></div></footer>;}
export function Button({children,busy=false,tone='primary',className='',...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{busy?:boolean;tone?:string}){return <button type="button" {...props} disabled={props.disabled||busy} aria-busy={busy||undefined} className={`btn btn-${tone} ${className}`}>{busy?<Loader2 size={18} className="spin"/>:null}{children}</button>;}
export function ErrorBox({message,retry}:{message:string;retry?:()=>void}){return message?<div className="error-box" role="alert"><span>{message}</span>{retry&&<button onClick={retry}>Réessayer</button>}</div>:null;}
export function Field({label,error,id,children,hint}:{label:string;error?:string;id:string;children:React.ReactNode;hint?:string}){return <div className="field"><label htmlFor={id}>{label}</label>{children}{hint&&<p className="field-hint" id={`${id}-hint`}>{hint}</p>}{error&&<p className="field-error" id={`${id}-error`}>{error}</p>}</div>;}
export function Modal({open,onOpenChange,title,description,children}:{open:boolean;onOpenChange:(v:boolean)=>void;title:string;description?:string;children:React.ReactNode}){return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="dolce-dialog" showCloseButton={false}><DialogClose className="icon-button modal-close" aria-label="Fermer"><X size={20}/></DialogClose><DialogTitle className="modal-title">{title}</DialogTitle><DialogDescription className={description?'muted':'sr-only'}>{description||title}</DialogDescription>{children}</DialogContent></Dialog>;}
// Native list: the phone's own picker, read correctly by screen readers, and no extra code to download.
export function Choice({id,value,onChange,options,label}:{id:string;value:string;onChange:(v:string)=>void;options:{value:string;label:string;group?:string}[];label:string}){const item=(o:{value:string;label:string})=><option key={o.value} value={o.value}>{o.label}</option>;return <select id={id} className="native-select dolce-select" aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{options.filter(o=>!o.group).map(item)}{[...new Set(options.map(o=>o.group).filter(Boolean))].map(g=><optgroup key={g} label={g}>{options.filter(o=>o.group===g).map(item)}</optgroup>)}</select>;}
export function Quantity({value,onChange,name='Quantité'}:{value:number;onChange:(n:number)=>void;name?:string}){return <div className="quantity"><button type="button" aria-label={`Diminuer ${name}`} onClick={()=>onChange(value-1)} disabled={value<=1}><Minus size={15}/></button><output aria-label={name}>{value}</output><button type="button" aria-label={`Augmenter ${name}`} onClick={()=>onChange(value+1)} disabled={value>=20}><Plus size={15}/></button></div>;}
/** "Sans oignons · + chorizo" under a cart, ticket or order line. */
export function Changes({without,extra,className='mods-line'}:{without?:string[];extra?:string[];className?:string}){const lower=(v:string[])=>v.map(n=>n.toLocaleLowerCase('fr')).join(', ');return without?.length||extra?.length?<span className={className}>{!!without?.length&&<span className="mods-without">Sans {lower(without)}</span>}{!!extra?.length&&<span className="mods-extra">+ {lower(extra)}</span>}</span>:null;}
export function CartRows(){const{priced,setCart,products}=useShop();return <div className="cart-rows">{priced.lines.map((l,i)=>{const p=products.find(x=>x.id===l.id);return <div className="cart-row" key={`${i}-${l.id}${l.size}${l.option}${l.freeId||''}`}>{p&&isPizza(p)?<PizzaPhoto product={p} className="cart-thumb" decorative sizes="72px"/>:<span className="cart-thumb cart-thumb-extra" aria-hidden="true"><ShoppingBag size={20}/></span>}<div className="cart-row-main"><strong>{l.name}</strong><p>{sizeLabel(l.size)}{l.option&&` · ${l.option}`}</p><Changes without={l.without} extra={l.extra}/>{l.free&&<p className="free-line">+ {l.free.name}{l.free.option&&` · ${l.free.option}`} offerte</p>}{l.free&&<Changes without={l.free.without} extra={l.free.extra}/>}{l.extras>0&&<small className="muted">Suppléments : {money(l.extras)} par {l.free?'duo':'pizza'}</small>}{l.problem&&<small className="field-error">{l.problem}</small>}{l.freeId&&l.problem.startsWith('L’offre')&&<button className="remove" onClick={()=>setCart(rows=>rows.map((r,j)=>j===i?{id:r.id,size:r.size,option:r.option,quantity:r.quantity,...(r.removed?{removed:r.removed}:{}),...(r.added?{added:r.added}:{})}:r))}>Retirer la pizza offerte</button>}<Quantity value={l.quantity} name={l.name} onChange={q=>setCart(rows=>rows.map((r,j)=>j===i?{...r,quantity:q}:r))}/></div><div className="cart-row-end"><strong>{money(l.total)}</strong><button className="remove" onClick={()=>setCart(rows=>rows.filter((_,j)=>j!==i))} aria-label={`Retirer ${l.name}`}>Retirer</button></div></div>;})}</div>;}
function CartDrawer(){const{cartOpen,setCartOpen,cart,priced}=useShop();return <Sheet open={cartOpen} onOpenChange={setCartOpen}><SheetContent className="dolce-sheet" showCloseButton={false}><SheetClose className="icon-button modal-close" aria-label="Fermer le panier"><X/></SheetClose><SheetTitle className="modal-title">Votre soirée pizza.</SheetTitle><SheetDescription>Retrait en pizzeria · paiement sur place</SheetDescription>{!cart.length?<div className="empty"><ShoppingBag size={46}/><h3>Une petite faim ?</h3><p>Votre panier attend sa première pizza.</p><a href="/#carte" className="btn btn-primary" onClick={()=>setCartOpen(false)}>Découvrir la carte</a></div>:<><CartRows/><div className="cart-summary"><div><span>Sous-total</span><strong>{money(priced.subtotal)}</strong></div>{priced.offer>0&&<p className="free-line">Dont {money(priced.offer)} économisés avec la 2e pizza offerte.</p>}<p>Vos tickets pizza offerte s’utilisent à l’étape suivante.</p><a href="/commander" className="btn btn-primary" onClick={()=>setCartOpen(false)}>Choisir mon créneau <ArrowUpRight size={18}/></a><small>Votre commande sera confirmée par la pizzeria.</small></div></>}</SheetContent></Sheet>;}
export function ProductModal({product:selection,onClose}:{product:Product|null;onClose:()=>void}){const{products}=useShop();const product=selection?products.find(p=>p.id===selection.id)||selection:null;return <Modal open={!!product} onOpenChange={v=>{if(!v)onClose();}} title={product?.name||'Choisir une pizza'} description={product?.description}>{product&&<ProductModalBody key={product.id} product={product} onClose={onClose}/>}</Modal>;}
const outOfStock=(p:Product,list:Ingredient[])=>(p.ingredients||[]).filter(id=>list.some(i=>i.id===id&&!i.available&&!i.locked));
/** The customer's changes to one pizza: tap an ingredient to remove it, open the supplements to add some. Allergens follow live. */
function Composition({product,option,removed,setRemoved,added,setAdded,label}:{product:Product;option:string;removed:string[];setRemoved:(v:string[])=>void;added:string[];setAdded:(v:string[])=>void;label:string}){
 const{ingredients,settings}=useShop();const[open,setOpen]=useState(added.length>0);
 const base=(product.ingredients||[]).map(id=>ingredients.find(i=>i.id===id)).filter((i):i is Ingredient=>!!i&&!i.locked);
 const extras=ingredients.filter(i=>i.extra&&!i.locked&&i.available&&!removed.includes(i.id));
 const list=allergensOf(product,ingredients,removed,added,option),origins=originsOf(composition(product,ingredients,removed,added,option));
 const toggle=(id:string)=>setRemoved(removed.includes(id)?removed.filter(x=>x!==id):[...removed,id]);
 const toggleExtra=(id:string)=>setAdded(added.includes(id)?added.filter(x=>x!==id):added.length>=MAX_EXTRAS?added:[...added,id]);
 if(!base.length&&!product.allergens?.length&&!product.allergensChecked)return null;
 return <div className="compose">
  {base.length>0&&<fieldset className="compose-block"><legend>{label} <small>Touchez un ingrédient pour le retirer</small></legend><div className="ing-chips">{base.map(i=>{const off=removed.includes(i.id);return <button type="button" key={i.id} className={`ing-chip ${off?'is-removed':''}`} aria-pressed={!off} aria-label={off?`${i.name} retiré. Remettre`:`Retirer ${i.name}`} disabled={!i.available} onClick={()=>toggle(i.id)}>{off?<X size={13}/>:<Check size={13}/>}{i.name}{!i.available&&<small>en rupture</small>}</button>;})}</div></fieldset>}
  {base.length>0&&extras.length>0&&<div className="compose-block"><button type="button" className="extras-toggle" aria-expanded={open} onClick={()=>setOpen(!open)}><span>Ajouter des suppléments <b>+ {money(settings.extraPrice)} l’unité</b></span>{added.length>0&&<span className="extras-count">{added.length}</span>}<ChevronDown size={17}/></button>{open&&<><div className="ing-chips">{extras.map(i=>{const on=added.includes(i.id);return <button type="button" key={i.id} className={`ing-chip is-extra ${on?'is-added':''}`} aria-pressed={on} disabled={!on&&added.length>=MAX_EXTRAS} onClick={()=>toggleExtra(i.id)}>{on?<Check size={13}/>:<Plus size={13}/>}{i.name}{product.ingredients?.includes(i.id)&&<small>en plus</small>}</button>;})}</div><p className="small muted">{MAX_EXTRAS} suppléments maximum par pizza.</p></>}</div>}
  <div className="allergen-box"><p><b>Allergènes</b>{list.length?<span className="allergen-tags">{list.map(a=><span key={a}>{allergenLabel(a)}</span>)}</span>:<span>{product.allergensChecked?' Aucun des 14 allergènes réglementaires.':' Liste en cours de validation.'}</span>}</p>{origins.length>0&&<p><b>Origine des viandes</b> {origins.join(' · ')}</p>}{list.length>0&&!product.allergensChecked&&<p className="small muted">Liste en cours de validation par la pizzeria.</p>}</div>
 </div>;
}
function ProductModalBody({product,onClose}:{product:Product;onClose:()=>void}){
 const{add,products,ingredients,settings}=useShop();const offer=!!product.offer&&isPizza(product);const pizzas=products.filter(p=>isPizza(p)&&p.available);
 const[size,setSize]=useState<CartLine['size']>(product.xxl===null?'unique':'senior'),[quantity,setQuantity]=useState(1),[option,setOption]=useState(product.options?.[0]||'');
 // An ingredient out of stock today starts removed, so the pizza stays orderable without it.
 const[removed,setRemoved]=useState(()=>outOfStock(product,ingredients)),[added,setAdded]=useState<string[]>([]);
 const[freeId,setFreeId]=useState(offer?product.id:'none'),[freeOption,setFreeOption]=useState(product.options?.[0]||''),[freeRemoved,setFreeRemoved]=useState(()=>offer?outOfStock(product,ingredients):[]),[freeAdded,setFreeAdded]=useState<string[]>([]),[customFree,setCustomFree]=useState(false);
 const free=offer?pizzas.find(p=>p.id===freeId):undefined;
 const unit=unitPrice(product,size),freeUnit=free?unitPrice(free,size):0,extras=(added.length+(free?freeAdded.length:0))*settings.extraPrice;
 const price=(Math.max(unit,freeUnit)+extras)*quantity;const hero=useRef<HTMLDivElement>(null);
 const pickFree=(p?:Product)=>{setFreeId(p?.id||'none');setFreeOption(p?.options?.[0]||'');setFreeRemoved(p?outOfStock(p,ingredients):[]);setFreeAdded([]);setCustomFree(false);};
 const paid=free&&freeUnit>unit?free:product,gift=free&&freeUnit>unit?product:free;
 // The 28-pizza grid of the offer renders just after the sheet opens, so the sheet itself appears at once on phones.
 const[gridReady,setGridReady]=useState(false);useEffect(()=>{if(!offer)return;const t=window.setTimeout(()=>setGridReady(true),80);return()=>window.clearTimeout(t);},[offer]);
 return <>{isPizza(product)&&<div ref={hero} className={`modal-hero size-${size}`}><PizzaPhoto product={product} className="modal-photo" priority sizes="(max-width: 760px) 200px, 236px"/><span className="modal-size-tag" key={size}>{size==='xxl'?'Ø 40 cm':'Ø 31 cm'}</span></div>}<div className="product-modal-kicker">{categories.find(c=>c.id===product.category)?.name}</div>
 {product.xxl!==null&&<fieldset><legend>Quelle taille vous fait envie ?</legend><div className="size-choices">{(['senior','xxl'] as const).map(v=><button key={v} className={size===v?'selected':''} aria-pressed={size===v} onClick={()=>setSize(v)}><span>{v==='senior'?'Senior':'XXL'}<small>{v==='senior'?'31 cm':'40 cm'}</small></span><b>{money(v==='senior'?product.price:product.xxl!)}</b>{size===v&&<Check size={16}/>}</button>)}</div></fieldset>}
 {!!product.options?.length&&<Field label="Votre garniture" id="garniture"><Choice id="garniture" label="Garniture" value={option} onChange={setOption} options={product.options.map(v=>({value:v,label:v}))}/></Field>}
 <Composition product={product} option={option} removed={removed} setRemoved={setRemoved} added={added} setAdded={setAdded} label="Composition"/>
 {offer&&<div className="offer-box"><div className="inline-between"><span className="offer-badge"><Gift size={13}/>2e pizza offerte</span><small className="muted">{size==='xxl'?'2e pizza en XXL · 40 cm':'2e pizza en Senior · 31 cm'}</small></div>
  <p className="offer-lead">Choisissez votre 2e pizza {size==='xxl'?'XXL':'Senior'} :</p>
  {!gridReady?<div className="free-grid" aria-busy="true"/>:<div className="free-grid" role="group" aria-label={`Pizza offerte, taille ${size==='xxl'?'XXL':'Senior'}`}><button type="button" className={`free-card free-none ${!free?'selected':''}`} aria-pressed={!free} onClick={()=>pickFree()}><X size={18}/><span>Sans 2e pizza</span></button>{pizzas.map(p=><button type="button" key={p.id} className={`free-card ${free?.id===p.id?'selected':''}`} aria-pressed={free?.id===p.id} onClick={()=>pickFree(p)}><PizzaPhoto product={p} decorative sizes="52px"/><span>{p.name}</span><b>{money(unitPrice(p,size))}</b></button>)}</div>}
  {free&&<>{!!free.options?.length&&<Field label={`Garniture de la ${free.name} offerte`} id="garniture-offerte"><Choice id="garniture-offerte" label="Garniture offerte" value={freeOption} onChange={setFreeOption} options={free.options.map(v=>({value:v,label:v}))}/></Field>}
   <div className="offer-pair" key={free.id}><PizzaPhoto product={paid!} decorative sizes="80px"/><b>+</b><PizzaPhoto product={gift!} decorative sizes="80px"/><span>{unit===freeUnit?<>Même prix&nbsp;:<br/>vous payez {money(unit)}</>:<>Vous payez la plus chère<br/>({money(Math.max(unit,freeUnit))}), la {shortName(gift!.name)} est offerte</>}</span></div>
   {(free.ingredients||[]).length>0&&<button type="button" className="extras-toggle" aria-expanded={customFree} onClick={()=>setCustomFree(!customFree)}><span>Personnaliser la {shortName(free.name)} offerte</span>{freeRemoved.length+freeAdded.length>0&&<span className="extras-count">{freeRemoved.length+freeAdded.length}</span>}<ChevronDown size={17}/></button>}
   {customFree&&<Composition key={free.id} product={free} option={freeOption} removed={freeRemoved} setRemoved={setFreeRemoved} added={freeAdded} setAdded={setFreeAdded} label={`Composition de la ${shortName(free.name)}`}/>}</>}
  <p>Pour chaque {shortName(product.name)} achetée, une 2e pizza de même taille est offerte : la moins chère des deux. Les suppléments restent payants.</p></div>}
 <div className="inline-between"><span>Quantité</span><Quantity value={quantity} onChange={setQuantity}/></div>{extras>0&&<p className="small muted">Dont {money(extras)} de suppléments par {free?'duo':'pizza'}.</p>}<p className="allergy-note">Allergie sévère ? Appelez-nous au 03 20 40 09 01 avant de commander : nos pizzas sont préparées dans une cuisine où circulent tous les allergènes.</p>
 <Button className="btn-shine" disabled={!product.available} onClick={()=>{flyToCart(hero.current?.querySelector('img'));add(product,size,option,quantity,{removed,added},free?{id:free.id,option:free.options?.length?freeOption:'',removed:freeRemoved,added:freeAdded}:undefined);onClose();}}>{product.available?(free?`Ajouter + ${quantity} offerte${quantity>1?'s':''}`:'Ajouter au panier'):'Indisponible'} <span className="button-price">{money(price)}</span></Button></>;
}
const frenchDate=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
export function FrenchDate({iso}:{iso:string}){return <>{frenchDate.format(new Date(iso))}</>;}
