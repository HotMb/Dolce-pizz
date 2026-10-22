'use client';
/* eslint-disable @next/next/no-img-element */
import {useCallback,useEffect,useRef,useState,type CSSProperties} from 'react';
import {ArrowDown,ArrowLeft,ArrowRight,ArrowUpRight} from 'lucide-react';
import {categories,money,shortName,taglines,type Product} from '@/lib/catalog';
import {isPizza} from '@/lib/pricing';
import {photoSrc,photoSrcSet,hasPhoto} from './pizza-photo';

// Home "pizza slider". Slices of the real photos sit on a wheel; the one at the top is the current pick.
// The wheel position is a continuous number animated by a small spring outside React (drag with inertia,
// arrows, keyboard, trackpad), so only the text re-renders when the current pizza changes.
const STEP=40,VISIBLE=2;
const wrap=(d:number,n:number)=>{const r=((d%n)+n)%n;return r>n/2?r-n:r;};
// Side slices are dimmed with opacity over the black stage rather than a CSS filter: opacity is handled by
// the graphics card, a filter repaints the photo on every frame (the cause of jerky spins on phones).
const slotStyle=(d:number)=>{const a=Math.abs(d),fade=Math.max(0,Math.min(1,VISIBLE+.75-a)),lift=Math.max(0,1-a),op=fade*(.42+.58*lift);return {transform:`rotate(${(d*STEP).toFixed(2)}deg)`,opacity:op.toFixed(3),visibility:op>0?'visible':'hidden',zIndex:String(10-Math.round(a)),lift:lift.toFixed(3)} as const;};
type Drag={x:number;y:number;pos:number;lastX:number;lastT:number;v:number;moved:boolean};

export function PizzaWheel({products,onChoose}:{products:Product[];onChoose:(p:Product)=>void}){
 const pizzas=products.filter(p=>isPizza(p)&&hasPhoto(p)),n=pizzas.length;
 const[current,setCurrent]=useState(0),[reach,setReach]=useState(VISIBLE+1);
 const chips=useRef<HTMLDivElement>(null),category=pizzas[current]?.category;
 // On phones the range buttons scroll sideways: keep the current range centred in view.
 useEffect(()=>{const c=chips.current,a=c?.querySelector<HTMLElement>('.active');if(!c||!a||c.scrollWidth<=c.clientWidth)return;c.scrollTo({left:a.offsetLeft-(c.clientWidth-a.offsetWidth)/2,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});},[category]);
 const slots=useRef<(HTMLDivElement|null)[]>([]);
 const m=useRef({pos:0,target:0,vel:0,raf:0,drag:null as Drag|null,dragged:false,wheelLock:0,wheelAcc:0});
 // Only values that changed are written: most slices sit hidden and untouched while the wheel turns.
 const written=useRef<string[]>([]);
 const layout=useCallback(()=>{const s=m.current;slots.current.forEach((el,i)=>{if(!el)return;const st=slotStyle(wrap(i-s.pos,n)),key=`${st.transform}|${st.opacity}|${st.lift}`;if(written.current[i]===key)return;written.current[i]=key;el.style.transform=st.transform;el.style.opacity=st.opacity;el.style.visibility=st.visibility;el.style.zIndex=st.zIndex;el.style.setProperty('--lift',st.lift);});},[n]);
 // One animation frame: spring toward the target (unless a finger holds the wheel), then place the slices.
 const frame=useRef<()=>void>(()=>{});
 useEffect(()=>{frame.current=()=>{
  const s=m.current;s.raf=0;
  // Firm, lightly damped spring: within 3 % of the target in 0.2 s, settled in 0.4 s.
  if(!s.drag){s.vel=(s.vel+(s.target-s.pos)*0.24)*0.58;s.pos+=s.vel;if(Math.abs(s.target-s.pos)<.001&&Math.abs(s.vel)<.001){s.pos=s.target;s.vel=0;}}
  layout();const idx=((Math.round(s.pos)%n)+n)%n;setCurrent(c=>c===idx?c:idx);
  if(s.drag||s.pos!==s.target)s.raf=requestAnimationFrame(()=>frame.current());
 };},[layout,n]);
 useEffect(()=>{const s=m.current;return()=>cancelAnimationFrame(s.raf);},[]);
 const kick=()=>{const s=m.current;setReach(VISIBLE+2);if(matchMedia('(prefers-reduced-motion: reduce)').matches&&!s.drag){s.pos=s.target;s.vel=0;}if(!s.raf)s.raf=requestAnimationFrame(()=>frame.current());};
 if(!n)return null;
 const pick=pizzas[current]||pizzas[0];
 const go=(delta:number)=>{const s=m.current;s.target=Math.round(s.target)+delta;kick();};
 const jump=(category:string)=>{const i=pizzas.findIndex(p=>p.category===category);if(i>=0)go(Math.round(wrap(i-m.current.target,n)));};
 const stepPx=()=>window.innerWidth<760?95:150;
 const choose=(i:number,p:Product)=>{const s=m.current;if(s.dragged)return;const d=Math.round(wrap(i-s.pos,n));if(d===0){if(p.available)onChoose(p);}else go(d);};
 const name=shortName(pick.name);
 return <section className="wheel-hero" aria-roledescription="carrousel" aria-label="Nos pizzas">
  <div className="wheel-ambient" aria-hidden="true"><img key={pick.id} src={photoSrc(pick,320)} alt="" loading="lazy" decoding="async"/></div>
  <div className="wheel-heading">
   <p className="hero-location">Dolce Pizz’ · Ronchin</p>
   <h1><span className="wheel-lead">J’ai envie d’une</span><span className="wheel-name" key={pick.id}><span className="sr-only">{name}</span>{[...name].map((ch,i)=><span key={i} aria-hidden="true" style={{'--i':i} as CSSProperties}>{ch===' '?' ':ch}</span>)}</span></h1>
   <div className="wheel-chips" ref={chips} role="group" aria-label="Aller à une gamme">{categories.filter(c=>pizzas.some(p=>p.category===c.id)).map(c=><button type="button" key={c.id} className={c.id===pick.category?'active':''} aria-pressed={c.id===pick.category} onClick={()=>jump(c.id)}>{c.name}</button>)}</div>
  </div>
  <div className="wheel-stage" tabIndex={0} aria-label="Parcourir les pizzas : flèches gauche et droite, ou faites glisser"
   onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();go(e.key==='ArrowLeft'?-1:1);}if(e.key==='Enter'&&e.target===e.currentTarget&&pick.available)onChoose(pick);}}
   onPointerDown={e=>{if(e.button!==0)return;const s=m.current;s.dragged=false;s.drag={x:e.clientX,y:e.clientY,pos:s.pos,lastX:e.clientX,lastT:e.timeStamp,v:0,moved:false};}}
   onPointerMove={e=>{const s=m.current,dr=s.drag;if(!dr)return;const dx=e.clientX-dr.x,dy=e.clientY-dr.y;
    if(!dr.moved){if(Math.abs(dx)<7)return;if(Math.abs(dy)>Math.abs(dx)){s.drag=null;return;}dr.moved=true;e.currentTarget.setPointerCapture(e.pointerId);}
    const per=stepPx(),dt=Math.max(8,e.timeStamp-dr.lastT);s.pos=dr.pos-dx/per;dr.v=.75*dr.v+.25*(-(e.clientX-dr.lastX)/per/dt);dr.lastX=e.clientX;dr.lastT=e.timeStamp;kick();}}
   onPointerUp={()=>{const s=m.current,dr=s.drag;s.drag=null;if(!dr?.moved)return;s.dragged=true;window.setTimeout(()=>{s.dragged=false;},0);s.target=Math.round(s.pos+Math.max(-4,Math.min(4,dr.v*240)));s.vel=0;kick();}}
   onPointerCancel={()=>{const s=m.current;if(!s.drag)return;s.drag=null;s.target=Math.round(s.pos);kick();}}
   onWheel={e=>{if(Math.abs(e.deltaX)<=Math.abs(e.deltaY))return;const s=m.current;s.wheelAcc+=e.deltaX;if(e.timeStamp<s.wheelLock||Math.abs(s.wheelAcc)<40)return;go(s.wheelAcc>0?1:-1);s.wheelAcc=0;s.wheelLock=e.timeStamp+320;}}>
   <div className="wheel" aria-hidden="true">
    {pizzas.map((p,i)=>{const d=wrap(i,n),st=slotStyle(d),near=Math.abs(wrap(i-current,n));return <div key={p.id} ref={el=>{slots.current[i]=el;}} className={`wheel-slot ${!p.available?'is-off':''}`} style={{transform:st.transform,opacity:st.opacity,visibility:st.visibility,zIndex:st.zIndex,'--lift':st.lift} as CSSProperties}>
     <button type="button" className="wheel-slice" tabIndex={-1} onClick={()=>choose(i,p)}><span className="pizza-slice">{/* Photos load only around the current pizza (sharp in the centre, lighter on the sides), not all at once. */}{near<=reach&&<img src={photoSrc(p,640)} srcSet={photoSrcSet(p)} sizes={near===0?'(max-width: 760px) 430px, 584px':'(max-width: 760px) 210px, 584px'} alt="" fetchPriority={near===0?'high':'auto'} decoding="async" draggable={false}/>}</span></button>
    </div>;})}
   </div>
   <div className="wheel-frame-layer" aria-hidden="true"><div className="wheel-box"><svg className="wheel-frame" viewBox="-130 -80 977 1170" preserveAspectRatio="none"><path d="M329.3 1006.3L-110.25 41.7A1130 1130 0 0 1 826.95 41.7L387.4 1006.3Q358.35 1070 329.3 1006.3Z"/></svg>{pick.offer&&<span className="wheel-offer" key={pick.id}>2e offerte</span>}{!pick.available&&<span className="wheel-off">Victime de son succès</span>}</div></div>
   <div className="wheel-caption" key={pick.id}><p>{pick.tagline||taglines[pick.id]||pick.description}</p></div>
   <button type="button" className="wheel-arrow wheel-prev" aria-label="Pizza précédente" onClick={()=>go(-1)}><ArrowLeft size={22}/></button>
   <button type="button" className="wheel-arrow wheel-next" aria-label="Pizza suivante" onClick={()=>go(1)}><ArrowRight size={22}/></button>
   <svg width="0" height="0" className="wheel-defs" aria-hidden="true"><clipPath id="wheel-slice-clip" clipPathUnits="objectBoundingBox"><path d="M.5 1L0 .0664A1.3952 1 0 0 1 1 .0664Z"/></clipPath></svg>
  </div>
  <div className="wheel-order">
   <p className="wheel-desc" key={pick.id}>{pick.description}</p>
   <div className="wheel-buy"><span className="wheel-price">{money(pick.price)}<small>Senior 31 cm{pick.xxl!==null&&` · XXL ${money(pick.xxl)}`}</small></span><button type="button" className="btn btn-primary btn-shine" disabled={!pick.available} onClick={()=>onChoose(pick)}>{pick.available?'Je la veux':'Indisponible'} <ArrowUpRight size={18}/></button></div>
  </div>
  <div className="hero-bottom"><span>À emporter · paiement sur place</span><a href="#carte">Toute la carte <ArrowDown size={14}/></a><span className="wheel-counter">{String(current+1).padStart(2,'0')} <span>/ {n}</span></span></div>
  <p className="sr-only" aria-live="polite" aria-atomic="true">{pick.name}, {money(pick.price)}. {pick.description}</p>
 </section>;
}
