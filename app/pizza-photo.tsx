/* eslint-disable @next/next/no-img-element */
import {shortName,type Product} from '@/lib/catalog';

// One cut-out photo per recipe, in 3 widths. 'static': exported by `npm run photos` into public/assets/pizzas;
// '<version>:<widths>': uploaded from the admin and served by the API (the version changes with each new photo).
type Photo={src:(width:number)=>string;widths:number[]};
function photoOf(p:Pick<Product,'id'|'photo'>):Photo|null{
 if(!p.photo)return null;
 if(p.photo==='static')return {widths:[320,640,1024],src:w=>`/assets/pizzas/${p.id}-${w}.webp`};
 const[version,list]=p.photo.split(':');const widths=(list||'').split(',').map(Number).filter(w=>w>0);
 return widths.length?{widths,src:w=>`/api/photos/${p.id}/${version}/${w}`}:null;
}
export const hasPhoto=(p:Pick<Product,'id'|'photo'>)=>!!photoOf(p);
/** The smallest available width covering `width`, or the largest one. */
export function photoSrc(p:Pick<Product,'id'|'photo'>,width:number){const ph=photoOf(p);if(!ph)return '';return ph.src(ph.widths.find(w=>w>=width)||ph.widths[ph.widths.length-1]);}
export function photoSrcSet(p:Pick<Product,'id'|'photo'>){const ph=photoOf(p);return ph?ph.widths.map(w=>`${ph.src(w)} ${w}w`).join(', '):'';}

/** One recipe, one photograph, reused across discovery and ordering. Recipes still waiting for their shoot get a named placeholder. */
export function PizzaPhoto({product,className='',priority=false,decorative=false,sizes='(max-width: 760px) 70vw, 360px'}:{
 product:Product;className?:string;priority?:boolean;decorative?:boolean;sizes?:string;
}){
 if(!hasPhoto(product))return <span className={`pizza-photo is-missing ${className}`} role={decorative?undefined:'img'} aria-hidden={decorative||undefined} aria-label={decorative?undefined:`${product.name}, photo bientôt disponible`}>
  <span className="pizza-missing"><b>{shortName(product.name)}</b><small>Photo bientôt</small></span>
 </span>;
 return <span className={`pizza-photo ${className}`}>
  <img src={photoSrc(product,640)} srcSet={photoSrcSet(product)} sizes={sizes} width={1024} height={1024}
   alt={decorative?'':`${product.name} : ${product.description} Visuel illustratif.`}
   loading={priority?'eager':'lazy'} fetchPriority={priority?'high':'auto'} decoding="async" draggable={false}/>
 </span>;
}
