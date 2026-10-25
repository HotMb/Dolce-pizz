'use client';
import {useEffect,useMemo,useState} from 'react';
import {CheckCircle2,LockKeyhole,Plus,RefreshCw,ShoppingBag} from 'lucide-react';
import {categories,money,type Product} from '@/lib/catalog';
import {Providers,ProductModal,useShop,CartRows,Button,ErrorBox,Field,Modal} from '../components';
import './kiosk.css';

type KioskOrder={id:string;total:number;status:string;slot:string;locationId:string;channel:string};
type DeviceScope={organizationId:string;organizationName:string;locationId:string;locationName:string};
const storageKey='dolce-kiosk-cart';

async function deviceFetch<T>(token:string,path:string,method='GET',body?:unknown):Promise<T>{
 const response=await fetch(`/api/${path}`,{method,headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
 const data=await response.json().catch(()=>null) as {error?:string};
 if(!response.ok)throw new Error(data?.error||'La borne ne peut pas joindre le service.');
 return data as T;
}

export function KioskPage(){return <Providers cartDrawer={false} storageKey={storageKey}><KioskScreen/></Providers>;}

function KioskScreen(){
 const {products,cart,setCart,priced,loaded,error,refresh}=useShop();
 const [token,setToken]=useState(''),[configured,setConfigured]=useState(false),[tokenDraft,setTokenDraft]=useState(''),[scope,setScope]=useState<DeviceScope|null>(null),[setupError,setSetupError]=useState('');
 const [category,setCategory]=useState('tomate'),[selected,setSelected]=useState<Product|null>(null),[checkout,setCheckout]=useState(false);
 const [name,setName]=useState('Client borne'),[phone,setPhone]=useState(''),[busy,setBusy]=useState(false),[checkoutError,setCheckoutError]=useState(''),[receipt,setReceipt]=useState<KioskOrder|null>(null);
 const bootstrap=async(clean:string)=>{setSetupError('');try{const result=await deviceFetch<{scope:DeviceScope;device:{role:string}}>(clean,'device/bootstrap');if(result.device.role!=='kiosk')throw new Error('Ce jeton n’est pas celui d’une borne client.');localStorage.setItem('dolce-kiosk-token',clean);setToken(clean);setScope(result.scope);setConfigured(true);setTokenDraft('');}catch(e){setSetupError((e as Error).message||'Jeton invalide.');setConfigured(false);}};
 useEffect(()=>{const saved=localStorage.getItem('dolce-kiosk-token')||'';if(/^[0-9a-f]{64}$/.test(saved))void bootstrap(saved);},[]);
 const saveToken=()=>{const clean=tokenDraft.trim();if(!/^[0-9a-f]{64}$/.test(clean))return;void bootstrap(clean);};
 const openCheckout=()=>{setCheckoutError('');setCheckout(true);};
 const submit=async()=>{if(!scope||!cart.length||name.trim().length<2)return;setBusy(true);setCheckoutError('');try{const result=await deviceFetch<{order:KioskOrder}>(token,'staff/orders','POST',{key:crypto.randomUUID(),organizationId:scope.organizationId,locationId:scope.locationId,channel:'kiosk',customerName:name.trim(),customerPhone:phone.trim(),readySmsConfirmed:false,note:'',items:cart});setCart([]);setCheckout(false);setReceipt(result.order);}catch(e){setCheckoutError((e as Error).message);}finally{setBusy(false);}};
 const visible=useMemo(()=>products.filter(p=>p.category===category&&p.available),[products,category]);
 if(!configured)return <main className="kiosk-page kiosk-setup"><section className="kiosk-setup-card"><LockKeyhole size={42}/><p className="eyebrow">DOLCE PIZZ’ · BORNE</p><h1>Configurer cette borne<span className="red">.</span></h1><p>Entrez le jeton remis lors de l’enrôlement de l’appareil. Le site de retrait est détecté automatiquement et le jeton reste dans ce navigateur.</p><Field label="Jeton borne" id="kiosk-token"><input id="kiosk-token" type="password" inputMode="text" autoComplete="off" value={tokenDraft} onChange={e=>setTokenDraft(e.target.value)} placeholder="64 caractères hexadécimaux"/></Field><ErrorBox message={setupError}/><Button onClick={saveToken} disabled={!/^[0-9a-f]{64}$/.test(tokenDraft.trim())}>Activer la borne</Button></section></main>;
 return <main className="kiosk-page"><header className="kiosk-header"><div><p className="eyebrow red">DOLCE PIZZ’ · BORNE CLIENT</p><h1>Choisissez votre repas<span className="red">.</span></h1><p>Commande à emporter · {scope?.locationName||'site configuré'} · paiement au retrait</p></div><div className="kiosk-header-actions"><Button tone="quiet" onClick={()=>{setConfigured(false);setScope(null);localStorage.removeItem('dolce-kiosk-token');}}><LockKeyhole size={17}/> Verrouiller</Button><Button tone="outline" onClick={()=>void refresh()}><RefreshCw size={17}/> Actualiser</Button></div></header>
  <ErrorBox message={error} retry={refresh}/><nav className="kiosk-categories" aria-label="Catégories">{categories.map(c=><button key={c.id} className={category===c.id?'active':''} onClick={()=>setCategory(c.id)}>{c.name}</button>)}</nav>
  {!loaded&&!products.length?<div className="kiosk-loading">Chargement de la carte…</div>:<section className="kiosk-products" aria-label="Articles">{visible.map(product=><article className="kiosk-product" key={product.id}><button className="kiosk-product-art" onClick={()=>setSelected(product)} aria-label={`Choisir ${product.name}`}><ShoppingBag size={30}/></button><div><h2>{product.name}</h2><p>{product.description}</p><strong>{money(product.price)}{product.xxl!==null&&<> · XXL {money(product.xxl)}</>}</strong></div><button className="kiosk-add" aria-label={`Ajouter ${product.name}`} onClick={()=>setSelected(product)}><Plus size={25}/></button></article>)}</section>}
  {priced.count>0&&<button className="kiosk-cart-bar" onClick={()=>void openCheckout()}><span><ShoppingBag size={23}/><b>{priced.count}</b></span><strong>Voir le panier</strong><b>{money(priced.subtotal)}</b></button>}
  <ProductModal product={selected} onClose={()=>setSelected(null)}/>
  <Modal open={checkout} onOpenChange={setCheckout} title="Votre commande" description="La préparation démarre dès validation. Une minuterie sera visible en cuisine."><CartRows/><div className="kiosk-checkout-fields"><Field label="Nom affiché sur le ticket" id="kiosk-name"><input id="kiosk-name" value={name} onChange={e=>setName(e.target.value)} maxLength={80}/></Field><Field label="Téléphone (facultatif, pour le SMS de retrait)" id="kiosk-phone"><input id="kiosk-phone" inputMode="tel" value={phone} onChange={e=>setPhone(e.target.value)} maxLength={30}/></Field></div><ErrorBox message={checkoutError}/><div className="inline-between"><span>Total à régler au retrait<br/><strong>{money(priced.subtotal)}</strong></span><Button busy={busy} disabled={!cart.length||name.trim().length<2} onClick={()=>void submit()}>Envoyer en cuisine</Button></div></Modal>
  <Modal open={!!receipt} onOpenChange={v=>{if(!v)setReceipt(null)}} title="Commande enregistrée" description="Présentez ce numéro au comptoir pour le paiement et le retrait."><div className="kiosk-receipt"><CheckCircle2 size={54}/><p className="eyebrow">NUMÉRO DE COMMANDE</p><strong>#{receipt?.id.slice(0,6).toUpperCase()}</strong><p>{receipt&&money(receipt.total)} · paiement au retrait</p><Button onClick={()=>setReceipt(null)}>Nouvelle commande</Button></div></Modal>
 </main>;
}
