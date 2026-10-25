'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowLeft,ArrowUpRight,Check,CheckCircle2,LockKeyhole,MapPin,Minus,Plus,ReceiptText,ShoppingBasket,Trash2,UserRound,Utensils,PhoneCall} from 'lucide-react';
import {AlertDialog,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {Checkbox} from '@/components/ui/checkbox';
import {allergensOf,allergenLabel,type Ingredient} from '@/lib/menu';
import {categories,type Product,money} from '@/lib/catalog';
import {MAX_EXTRAS,priceCart,type CartLine,type Menu} from '@/lib/pricing';
import {api,Button,ErrorBox,Field} from '../../components';
import {loginPath} from '../../member-ui';
import {scopeQuery,useStaffAccess,type StaffScope} from '../staff-access';
import '../staff.css';
import './order-composer.css';

type Channel='counter'|'phone'|'pos';
type CustomerLookup={name:string;phone:string;orderCount:number;lastOrderAt:string|null};
type StaffCatalog={products:Product[];ingredients:Ingredient[];extraPrice:number};
type CatalogState={scopeKey:string;data:StaffCatalog|null;error:string};
type OrderReceipt={id:string;total:number;status:string;slot:string;locationId:string;channel:Channel};
type ServiceMode='pickup'|'dine_in';
type Attempt={key:string;payload:{key:string;organizationId:string;locationId:string;channel:Channel;serviceMode:ServiceMode;tableLabel:string;customerName:string;customerPhone:string;readySmsConfirmed:boolean;note:string;items:CartLine[]}};
type ProductDraft={product:Product;size:CartLine['size'];quantity:number;option:string;removed:string[];added:string[];freeId:string;freeOption:string};
const rolesFor:Record<Channel,string[]>={counter:['owner','manager','pos'],phone:['owner','manager','call_center'],pos:['owner','manager','pos']};
const roleCan=(scope:StaffScope,channel:Channel)=>scope.roles.some(role=>rolesFor[channel].includes(role));
const localPhoneValid=(value:string)=>/^(?:\+33|0033|0)[67](?:[ .-]?\d){8}$/.test(value.trim());
const initialDraft=(product:Product):ProductDraft=>({product,size:product.xxl===null?'unique':'senior',quantity:1,option:product.options?.[0]||'',removed:[],added:[],freeId:product.offer?product.id:'',freeOption:product.options?.[0]||''});
const lineFromDraft=(draft:ProductDraft):CartLine=>({id:draft.product.id,size:draft.size,quantity:draft.quantity,option:draft.option,...(draft.removed.length?{removed:draft.removed}:{}),...(draft.added.length?{added:draft.added}:{}),...(draft.freeId?{freeId:draft.freeId,freeOption:draft.freeOption}:{})});

function usePosDeviceAccess(enabled:boolean){
 const[data,setData]=useState<{scope:StaffScope;device:{label:string;role:string}}|null>(null),[error,setError]=useState(''),[checked,setChecked]=useState(!enabled),[refreshing,setRefreshing]=useState(false);
 const refresh=useCallback(async()=>{if(!enabled){setChecked(true);return;}setRefreshing(true);try{const token=window.localStorage.getItem('dolce-pos-token')||'';if(!/^[0-9a-f]{64}$/.test(token))throw new Error('Aucun POS mobile n’est configuré.');const response=await fetch('/api/device/bootstrap',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});const payload=await response.json().catch(()=>null) as {scope?:StaffScope;device?:{label:string;role:string};error?:string};if(!response.ok||!payload.scope||!payload.device||payload.device.role!=='pos')throw new Error(payload.error||'Le jeton n’est pas celui d’un POS mobile.');setData({scope:payload.scope,device:payload.device});setError('');}catch(cause){setData(null);setError((cause as Error).message||'Impossible de vérifier le POS mobile.');}finally{setChecked(true);setRefreshing(false);}},[enabled]);
 useEffect(()=>{if(enabled){const first=window.setTimeout(()=>void refresh(),0);return()=>window.clearTimeout(first);}setChecked(true);},[enabled,refresh]);
 return {data,error,checked,refreshing,refresh};
}

export function StaffOrderComposer({deviceMode=false,fixedChannel}:{deviceMode?:boolean;fixedChannel?:Channel}){
 const staff=useStaffAccess(!deviceMode),device=usePosDeviceAccess(deviceMode);
 const access=device.data?{data:{account:{id:`device:${device.data.device.label}`,name:device.data.device.label},scopes:[device.data.scope],roles:[{id:'pos',label:'POS mobile'}]},loading:!device.checked,error:device.error,status:device.checked&&!device.data?401:null,refreshing:device.refreshing,refresh:device.refresh}:{data:staff.data,loading:staff.loading,error:staff.error,status:staff.status,refreshing:staff.refreshing,refresh:staff.refresh};
 const [requestedChannel,setRequestedChannel]=useState<Channel>(fixedChannel||'counter');
 const [selected,setSelected]=useState('');
 const [category,setCategory]=useState('tomate');
 const [draft,setDraft]=useState<ProductDraft|null>(null);
 const [cart,setCart]=useState<CartLine[]>([]);
 const [customerName,setCustomerName]=useState('');
 const [customerPhone,setCustomerPhone]=useState('');
 const [serviceMode,setServiceMode]=useState<ServiceMode>('pickup');
 const [tableLabel,setTableLabel]=useState('');
 const [readySmsConfirmed,setReadySmsConfirmed]=useState(false);
 const [customerLookup,setCustomerLookup]=useState<CustomerLookup|null>(null);
 const [customerLookupLoading,setCustomerLookupLoading]=useState(false);
 const [customerLookupMessage,setCustomerLookupMessage]=useState('');
 const [note,setNote]=useState('');
 const [fieldErrors,setFieldErrors]=useState<Record<string,string>>({});
 const [pageError,setPageError]=useState('');
 const [deviceTokenDraft,setDeviceTokenDraft]=useState('');
 const [attempt,setAttempt]=useState<Attempt|null>(null);
 const [attemptError,setAttemptError]=useState('');
 const [attemptUncertain,setAttemptUncertain]=useState(false);
 const [confirmOpen,setConfirmOpen]=useState(false);
 const [busy,setBusy]=useState(false);
 const [receipt,setReceipt]=useState<OrderReceipt|null>(null);
 const [catalogState,setCatalogState]=useState<CatalogState>({scopeKey:'',data:null,error:''});
 const [catalogRefresh,setCatalogRefresh]=useState(0);
 const [previousScope,setPreviousScope]=useState('');
 const busyRef=useRef(false);

 const scopes=access.data?.scopes||[];
 const showCallCenter=scopes.some(item=>roleCan(item,'phone'));
 const showPos=scopes.some(item=>roleCan(item,'pos'));
 const showCounter=scopes.some(item=>roleCan(item,'counter'));
 const channel:Channel=fixedChannel|| (requestedChannel==='counter'?(showCounter?'counter':showCallCenter?'phone':showPos?'pos':'counter'):requestedChannel==='phone'?(showCallCenter?'phone':showCounter?'counter':showPos?'pos':'phone'):(showPos?'pos':showCounter?'counter':showCallCenter?'phone':'pos'));
 const selectable=scopes.filter(scope=>roleCan(scope,channel));
 const scope=selectable.find(item=>scopeQuery(item)===selected)||selectable[0];
 const catalogKey=scope?scopeQuery(scope):'';
 if(previousScope!==catalogKey){setPreviousScope(catalogKey);setCart([]);setDraft(null);setCustomerName('');setCustomerPhone('');setServiceMode('pickup');setTableLabel('');setReadySmsConfirmed(false);setNote('');setFieldErrors({});}
 const catalog=catalogState.scopeKey===catalogKey?catalogState.data:null;
 const catalogLoading=!!scope&&(!catalog&&!catalogState.error||catalogState.scopeKey!==catalogKey);
 const catalogError=catalogState.scopeKey===catalogKey?catalogState.error:'';
 const menu=useMemo<Menu>(()=>({products:catalog?.products||[],ingredients:catalog?.ingredients||[],extraPrice:catalog?.extraPrice||0}),[catalog]);
 const products=menu.products;
 const ingredients=menu.ingredients;
 const availableProducts=products.filter(product=>product.available&&product.status!=='archived'&&product.status!=='draft');
 const menuCategories=categories.filter(item=>availableProducts.some(product=>product.category===item.id));
 const activeCategory=menuCategories.some(item=>item.id===category)?category:menuCategories[0]?.id||'';
 const shownProducts=availableProducts.filter(product=>product.category===activeCategory);
 const priced=useMemo(()=>priceCart(cart,menu),[cart,menu]);
 const canEdit=!attempt&&!busy;
 useEffect(()=>{
  const timer=window.setTimeout(()=>{
   const params=new URLSearchParams(window.location.search);
   const organizationId=params.get('organizationId'),locationId=params.get('locationId');
   if(organizationId&&locationId)setSelected(new URLSearchParams({organizationId,locationId}).toString());
    const requested=params.get('channel');
    if(!fixedChannel&&(requested==='counter'||requested==='phone'||requested==='pos'))setRequestedChannel(requested);
  },0);
  return()=>window.clearTimeout(timer);
 },[fixedChannel]);

 useEffect(()=>{
  if(!catalogKey)return;
  const controller=new AbortController();
  let active=true;
  void api<StaffCatalog>(`staff/catalog?${catalogKey}`,'GET',undefined,controller.signal)
   .then(value=>{
    if(!Array.isArray(value?.products)||!Array.isArray(value?.ingredients)||!Number.isInteger(value?.extraPrice)||value.extraPrice<0)throw new Error('La carte reçue est incomplète. Actualisez la page.');
    if(active&&!controller.signal.aborted)setCatalogState({scopeKey:catalogKey,data:value,error:''});
   })
   .catch(error=>{if(active&&!controller.signal.aborted)setCatalogState({scopeKey:catalogKey,data:null,error:(error as Error).message||'Impossible de charger la carte.'});});
  return()=>{active=false;controller.abort();};
 },[catalogKey,catalogRefresh]);

 const changeChannel=(next:Channel)=>{
  if(!canEdit)return;
  setRequestedChannel(next);setSelected('');setCart([]);setDraft(null);setPageError('');setFieldErrors({});
 };
 const lookupCustomer=async()=>{
  setCustomerLookup(null);setCustomerLookupMessage('');
  if(!scope||!localPhoneValid(customerPhone)){setCustomerLookupMessage('Saisissez d’abord un mobile français valide.');return;}
  setCustomerLookupLoading(true);
  try{const result=await api<{customer:CustomerLookup|null}>(`staff/customers?organizationId=${encodeURIComponent(scope.organizationId)}&locationId=${encodeURIComponent(scope.locationId)}&phone=${encodeURIComponent(customerPhone)}`,'GET');if(result.customer){setCustomerLookup(result.customer);if(!customerName.trim()&&result.customer.name)setCustomerName(result.customer.name);setCustomerLookupMessage('Client retrouvé dans cette enseigne. Vérifiez le nom avec l’appelant.');}else setCustomerLookupMessage('Aucun profil client trouvé dans cet établissement.');}
  catch(error){setCustomerLookupMessage((error as Error).message||'Recherche impossible.');}
  finally{setCustomerLookupLoading(false);}
 };

 const validate=()=>{
  const errors:Record<string,string>={};
  const fallbackPhoneName=channel==='phone'&&localPhoneValid(customerPhone)?`Client ${customerPhone.replace(/\D/g,'').slice(-4)}`:'';
  if((customerName.trim()||fallbackPhoneName).length<2)errors.customerName='Saisissez un numéro de téléphone valide.';
  if(customerPhone.trim()&&!localPhoneValid(customerPhone))errors.customerPhone='Saisissez un mobile français valide ou effacez ce numéro.';
  if(readySmsConfirmed&&!customerPhone.trim())errors.customerPhone='Ajoutez le mobile que le client a confirmé pour recevoir le SMS de retrait.';
  if(channel==='pos'&&serviceMode==='dine_in'&&!/^[A-Za-zÀ-ÖØ-öø-ÿ0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9 .#-]{0,29}$/.test(tableLabel.trim()))errors.tableLabel='Indiquez une table (ex. T4).';
  if(!cart.length)errors.cart='Ajoutez au moins un article à la commande.';
  if(priced.problem)errors.cart=priced.problem;
  if(priced.count>30)errors.cart='Pour plus de 30 articles, appelez la pizzeria.';
  if(!scope)errors.scope='Choisissez un établissement attribué à ce compte.';
  setFieldErrors(errors);
  const key=Object.keys(errors)[0];
  if(key)window.setTimeout(()=>document.getElementById(`pos-${key}`)?.focus(),0);
  return Object.keys(errors).length===0;
 };

 const openConfirmation=(event:React.FormEvent)=>{
  event.preventDefault();if(!canEdit||!validate())return;
  if(!scope)return;
  const key=crypto.randomUUID();
  const customerNameForOrder=customerName.trim()||`Client ${customerPhone.replace(/\D/g,'').slice(-4)}`;
  const payload:Attempt['payload']={key,organizationId:scope.organizationId,locationId:scope.locationId,channel,serviceMode:channel==='pos'?serviceMode:'pickup',tableLabel:channel==='pos'&&serviceMode==='dine_in'?tableLabel.trim():'',customerName:customerNameForOrder,customerPhone:customerPhone.trim(),readySmsConfirmed,note:note.trim(),items:cart};
  setAttempt({key,payload});
  setAttemptError('');setAttemptUncertain(false);setConfirmOpen(true);
 };

 const sendAttempt=async()=>{
  if(!attempt||busyRef.current)return;
  busyRef.current=true;setBusy(true);setAttemptError('');
  try{
   const result=await api<{order:OrderReceipt}>('staff/orders','POST',attempt.payload);
   if(!result?.order||typeof result.order.id!=='string')throw new Error('La réponse du serveur ne confirme pas la commande. Réessayez avec la même tentative.');
   const created=result.order;
   setReceipt(created);setConfirmOpen(false);setAttempt(null);setAttemptUncertain(false);setCart([]);setCustomerName('');setCustomerPhone('');setServiceMode('pickup');setTableLabel('');setReadySmsConfirmed(false);setCustomerLookup(null);setCustomerLookupMessage('');setNote('');setFieldErrors({});
  }catch(cause){
   const error=cause as Error&{status?:number};setAttemptError(error.message||'La commande n’a pas pu être confirmée.');
   const status=error.status||0;setAttemptUncertain(status===0||status>=500);
   if(status===401||status===403)void access.refresh();
  }finally{busyRef.current=false;setBusy(false);}
 };

 const addDraft=()=>{
  if(!draft)return;
  const line=lineFromDraft(draft),single=priceCart([line],menu);
  if(single.problem){setPageError(single.problem);return;}
  setCart(rows=>[...rows,line]);setDraft(null);setPageError('');setFieldErrors(errors=>({...errors,cart:''}));
 };
 const updateQuantity=(index:number,next:number)=>setCart(rows=>rows.map((line,i)=>i===index?{...line,quantity:next}:line));

 useEffect(()=>{
  if(!attemptUncertain)return;
  const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
  window.addEventListener('beforeunload',warn);
  return()=>window.removeEventListener('beforeunload',warn);
 },[attemptUncertain]);

 if(access.loading&&!access.data)return <main id="contenu" className="page-shell staff-shell"><div className="staff-loading" role="status">Vérification de vos accès…</div></main>;
 if(deviceMode&&access.status===401&&!access.data)return <main id="contenu" className="page-shell staff-shell"><section className="panel pos-gate"><form onSubmit={event=>{event.preventDefault();const token=deviceTokenDraft.trim();if(!/^[0-9a-f]{64}$/.test(token))return;localStorage.setItem('dolce-pos-token',token);setDeviceTokenDraft('');void access.refresh();}}><h1>Configurer le POS mobile.</h1><p>Collez le jeton remis lors de l’enrôlement. Il reste dans ce navigateur et sera limité à son établissement.</p><Field label="Jeton POS" id="pos-device-token"><input id="pos-device-token" type="password" inputMode="text" autoComplete="off" value={deviceTokenDraft} onChange={event=>setDeviceTokenDraft(event.target.value)} placeholder="64 caractères hexadécimaux"/></Field><Button type="submit" disabled={!/^[0-9a-f]{64}$/.test(deviceTokenDraft.trim())}>Activer le POS</Button><ErrorBox message={access.error}/></form></section></main>;
 if(access.status===401)return <main id="contenu" className="page-shell staff-shell"><section className="panel pos-gate"><h1>Reconnectez-vous.</h1><p>Votre session d’équipe a expiré. La saisie en cours n’est pas envoyée.</p><a className="btn btn-primary" href={loginPath('/equipe/commande')}>Se connecter par SMS</a></section></main>;
 if(access.error&&!access.data)return <main id="contenu" className="page-shell staff-shell"><ErrorBox message={access.error} retry={()=>void access.refresh()}/></main>;
 if(!scope)return <main id="contenu" className="page-shell staff-shell"><header className="staff-heading"><div><Link href="/equipe" className="staff-back"><ArrowLeft size={18}/> Espace équipe</Link><p className="staff-eyebrow"><ShoppingBasket size={17}/> PRISE DE COMMANDE</p><h1>Accès caisse<span>.</span></h1></div></header><section className="panel staff-empty"><UserRound size={34}/><h2>Aucun accès de prise de commande.</h2><p>Le propriétaire doit attribuer le rôle Comptoir ou Centre d’appels pour un établissement actif.</p><Link href="/equipe" className="btn btn-outline">Voir mon espace équipe</Link></section></main>;

 return <main id="contenu" className="page-shell staff-shell pos-shell">
  <header className="staff-heading pos-heading"><div><Link href={deviceMode?'/equipe/commande?device=1':`/equipe?${scopeQuery(scope)}`} className="staff-back"><ArrowLeft size={18}/> {deviceMode?'Configuration POS':'Espace équipe'}</Link><p className="staff-eyebrow"><ReceiptText size={17}/> DOLCE PIZZ’ · CAISSE</p><h1>Nouvelle commande<span>.</span></h1><p>Saisissez la commande, vérifiez le retrait et envoyez-la en cuisine. Le paiement reste dû au comptoir.</p></div><div className="pos-heading-site"><MapPin size={19}/><span>{scope.locationName}</span>{deviceMode&&<Button tone="quiet" onClick={()=>{localStorage.removeItem('dolce-pos-token');window.location.reload();}}><LockKeyhole size={16}/> Verrouiller</Button>}</div></header>
  {access.error&&<ErrorBox message={`${access.error} Les commandes restent bloquées tant que les accès ne sont pas vérifiés.`} retry={()=>void access.refresh()}/>}
  {receipt&&<section className="panel pos-receipt-success" role="status"><CheckCircle2 size={26}/><div><h2>Commande envoyée en cuisine.</h2><p>{receipt.channel==='phone'?'Commande prise par téléphone':'Commande du comptoir'} · {scope.locationName} · {money(receipt.total)} à régler au retrait.</p></div><Button tone="outline" onClick={()=>setReceipt(null)}>Prendre une autre commande</Button></section>}
   <div className="pos-context panel">
    {!fixedChannel&&<div className="pos-channel"><p className="staff-eyebrow">CANAL DE COMMANDE</p><div role="group" aria-label="Canal de prise de commande">{showCounter&&<button type="button" aria-pressed={channel==='counter'} disabled={!canEdit} onClick={()=>changeChannel('counter')}><Utensils size={18}/> Comptoir</button>}{showPos&&<button type="button" aria-pressed={channel==='pos'} disabled={!canEdit} onClick={()=>changeChannel('pos')}><ShoppingBasket size={18}/> POS mobile</button>}{showCallCenter&&<button type="button" aria-pressed={channel==='phone'} disabled={!canEdit} onClick={()=>changeChannel('phone')}><PhoneCall size={18}/> Centre d’appels</button>}</div></div>}
    <div className="pos-fixed-channel"><p className="staff-eyebrow">{channel==='phone'?'CENTRE D’APPELS':'POS EMPLOYÉ'}</p><strong>{channel==='phone'?'Commande téléphonique · Ronchin':'Commande comptoir · Ronchin'}</strong><span>Un seul établissement actif</span></div>
   </div>
  <form className="pos-layout" noValidate onSubmit={openConfirmation}>
   <div className="pos-main-column">
     <section className="panel pos-customer"><div className="pos-section-title"><UserRound size={20}/><div><h2>{channel==='phone'?'Client appelé':'Qui vient retirer ?'}</h2><p>Le paiement se fait sur place à la récupération.</p></div></div><div className="pos-customer-fields">{channel!=='phone'&&<Field label="Nom à annoncer au retrait" id="pos-customerName" error={fieldErrors.customerName}><input id="pos-customerName" maxLength={80} autoComplete="off" value={customerName} onChange={event=>setCustomerName(event.target.value)} disabled={!canEdit} aria-invalid={!!fieldErrors.customerName} aria-describedby={fieldErrors.customerName?'pos-customerName-error':undefined}/></Field>}<div className="pos-phone-lookup"><Field label="Numéro de téléphone" id="pos-customerPhone" hint={channel==='phone'?'Utilisé pour retrouver le client et confirmer le retrait.':'Facultatif · uniquement avec l’accord du client.'} error={fieldErrors.customerPhone}><input id="pos-customerPhone" type="tel" inputMode="tel" autoComplete="off" maxLength={30} value={customerPhone} onChange={event=>{setCustomerPhone(event.target.value);setCustomerLookup(null);setCustomerLookupMessage('');if(!event.target.value)setReadySmsConfirmed(false);}} disabled={!canEdit} aria-invalid={!!fieldErrors.customerPhone} aria-describedby={`${fieldErrors.customerPhone?'pos-customerPhone-error ':''}pos-customerPhone-hint`}/></Field>{channel==='phone'&&<Button type="button" tone="outline" busy={customerLookupLoading} disabled={!canEdit||!customerPhone.trim()} onClick={()=>void lookupCustomer()}>Rechercher le client</Button>}</div></div>
    {channel==='phone'&&customerLookupMessage&&<p className="pos-lookup-message" role="status">{customerLookupMessage}{customerLookup?.orderCount?` ${customerLookup.orderCount} commande${customerLookup.orderCount>1?'s':''} connue${customerLookup.orderCount>1?'s':''}.`:''}</p>}
    {channel==='pos'&&<div className="pos-service-fields"><Field label="Type de service" id="pos-service-mode"><Select value={serviceMode} onValueChange={value=>{setServiceMode(value as ServiceMode);if(value==='pickup')setTableLabel('');}} disabled={!canEdit}><SelectTrigger id="pos-service-mode" className="staff-select"><SelectValue/></SelectTrigger><SelectContent className="staff-select-popup" position="popper"><SelectItem value="pickup">À emporter</SelectItem><SelectItem value="dine_in">Sur place</SelectItem></SelectContent></Select></Field>{serviceMode==='dine_in'&&<Field label="Table" id="pos-tableLabel" hint="Ex. T4 ou terrasse 2" error={fieldErrors.tableLabel}><input id="pos-tableLabel" maxLength={30} value={tableLabel} onChange={event=>setTableLabel(event.target.value)} disabled={!canEdit} aria-invalid={!!fieldErrors.tableLabel}/></Field>}</div>}
     {channel==='phone'&&<p className="pos-single-site-note">Ronchin est le seul établissement actif. Aucun code postal n’est demandé.</p>}
    <label className={`pos-sms-choice ${!customerPhone.trim()?'is-disabled':''}`}><Checkbox checked={readySmsConfirmed} disabled={!canEdit||!customerPhone.trim()} onCheckedChange={value=>setReadySmsConfirmed(value===true)}/><span><b>Envoyer un SMS quand la commande sera prête</b><small>À cocher uniquement avec l’accord du client. Cette préférence ne l’inscrit pas aux promotions.</small></span></label>
    </section>
    <section className="panel pos-products" aria-labelledby="pos-products-title"><div className="pos-section-title"><ShoppingBasket size={21}/><div><h2 id="pos-products-title">Ajouter au ticket</h2><p>Les prix et les disponibilités seront revérifiés par le serveur.</p></div></div>
     {catalogLoading&&<p className="pos-loading" role="status">Chargement de la carte de cet établissement…</p>}
     {catalogError&&<ErrorBox message={`La carte n’a pas pu être actualisée. ${catalogError}`} retry={()=>setCatalogRefresh(value=>value+1)}/>}
     {catalog&&!menuCategories.length&&<p className="pos-empty">Aucun article n’est disponible dans la carte.</p>}
     {menuCategories.length>0&&<div className="pos-category-list" role="group" aria-label="Catégories de la carte">{menuCategories.map(item=><button key={item.id} type="button" className={activeCategory===item.id?'is-active':''} aria-pressed={activeCategory===item.id} onClick={()=>setCategory(item.id)} disabled={!canEdit}>{item.name}</button>)}</div>}
     <div className="pos-product-grid">{shownProducts.map(product=><article className="pos-product" key={product.id}><div><p className="pos-product-category">{categories.find(item=>item.id===product.category)?.name}</p><h3>{product.name}</h3><p>{product.description}</p>{product.allergensChecked?<small>Allergènes vérifiés</small>:<small className="pos-warning">Allergènes à vérifier avant préparation</small>}</div><div className="pos-product-footer"><span>{product.xxl===null?money(product.price):`${money(product.price)} · ${money(product.xxl)} XXL`}</span><Button type="button" tone="outline" disabled={!canEdit||!product.available} onClick={()=>setDraft(initialDraft(product))}>Personnaliser</Button></div></article>)}</div>
    </section>
     {channel==='phone'&&<section className="panel pos-pickup"><div className="pos-section-title"><div><h2>Préparation immédiate</h2><p>La commande est mise en file dès validation. Une minuterie démarre automatiquement et les écrans priorisent les tickets les plus anciens.</p></div></div></section>}
    <section className="panel pos-note"><Field label="Précision pour la cuisine" id="pos-note" hint="500 caractères maximum. Évitez les données sensibles."><textarea className="resize-none" id="pos-note" maxLength={500} rows={3} value={note} onChange={event=>setNote(event.target.value)} disabled={!canEdit} placeholder="Ex. : client appellera à son arrivée"/></Field></section>
   </div>
   <aside className="panel pos-ticket" aria-labelledby="pos-ticket-title"><div className="pos-ticket-head"><p className="staff-eyebrow"><ReceiptText size={16}/> TICKET</p><h2 id="pos-ticket-title">Récapitulatif</h2><p>{scope.locationName}</p></div>
    {!cart.length?<div className="pos-ticket-empty"><ShoppingBasket size={30}/><p>Le ticket apparaîtra ici au fur et à mesure.</p></div>:<ul className="pos-cart-lines">{priced.lines.map((line,index)=><li key={`${line.id}-${index}`}><div className="pos-line-main"><strong>{line.name}</strong><span>{line.size==='senior'?'Senior · 31 cm':line.size==='xxl'?'XXL · 40 cm':'À l’unité'}{line.option?` · ${line.option}`:''}</span>{line.without?.length>0&&<small>Sans {line.without.join(', ')}</small>}{line.extra?.length>0&&<small>+ {line.extra.join(', ')}</small>}{line.free&&<small>+ {line.free.name} offerte</small>}{line.problem&&<small className="field-error">{line.problem}</small>}</div><div className="pos-line-controls"><strong>{money(line.total)}</strong><div><Button type="button" tone="outline" disabled={!canEdit||line.quantity<=1} aria-label={`Diminuer ${line.name}`} onClick={()=>updateQuantity(index,line.quantity-1)}><Minus size={15}/></Button><span aria-label={`Quantité : ${line.quantity}`}>{line.quantity}</span><Button type="button" tone="outline" disabled={!canEdit||line.quantity>=20} aria-label={`Augmenter ${line.name}`} onClick={()=>updateQuantity(index,line.quantity+1)}><Plus size={15}/></Button><Button type="button" tone="outline" disabled={!canEdit} aria-label={`Retirer ${line.name}`} onClick={()=>setCart(rows=>rows.filter((_,i)=>i!==index))}><Trash2 size={16}/></Button></div></div></li>)}</ul>}
    {fieldErrors.cart&&<p id="pos-cart-error" className="field-error" role="alert">{fieldErrors.cart}</p>}
    <div className="pos-ticket-total"><div><span>Articles</span><strong>{priced.count}</strong></div>{priced.extras>0&&<div><span>Suppléments</span><strong>{money(priced.extras)}</strong></div>}{priced.offer>0&&<div><span>Offre 2e pizza</span><strong>− {money(priced.offer)}</strong></div>}<div className="pos-total-due"><span>À régler au retrait</span><strong>{money(priced.total)}</strong></div><p>Pas d’encaissement dans cet écran.</p></div>
    {pageError&&<ErrorBox message={pageError}/>}
    {access.error&&<ErrorBox message="Confirmez à nouveau les accès avant d’envoyer la commande." retry={()=>void access.refresh()}/>}
     <Button type="submit" busy={busy} disabled={!canEdit||!cart.length||!!priced.problem||!catalog||!!catalogError||!!access.error} className="pos-submit">Vérifier et envoyer la commande <ArrowUpRight size={18}/></Button>
   </aside>
  </form>

  <ProductDialog draft={draft} menu={menu} products={availableProducts} ingredients={ingredients} disabled={!canEdit||!catalog} onChange={setDraft} onClose={()=>setDraft(null)} onAdd={addDraft}/>
  <AlertDialog open={confirmOpen} onOpenChange={open=>{if(!open&&!busy&&!attemptUncertain){setConfirmOpen(false);setAttempt(null);}}}><AlertDialogContent className="dolce-dialog pos-confirm" onEscapeKeyDown={event=>{if(busy||attemptUncertain)event.preventDefault();}}><AlertDialogHeader><AlertDialogTitle>{attemptUncertain?'Confirmer le résultat de la tentative':'Envoyer cette commande en cuisine ?'}</AlertDialogTitle><AlertDialogDescription>La commande sera envoyée à <strong>{scope.locationName}</strong> et préparée dès validation. Une minuterie démarrera sur les écrans de production. Le client réglera <strong>{money(priced.total)}</strong> au comptoir en venant la chercher.{readySmsConfirmed?' Un SMS de retrait sera envoyé quand l’expédition la marquera prête.':''}</AlertDialogDescription></AlertDialogHeader>{attemptError&&<div className="pos-confirm-error"><ErrorBox message={attemptError}/>{attemptUncertain?<p>Le résultat peut être incertain. Réessayez avec le même identifiant de tentative; ne modifiez pas la commande entre-temps.</p>:null}</div>}<AlertDialogFooter><AlertDialogCancel className="btn btn-outline" disabled={busy||attemptUncertain} onClick={()=>{setAttempt(null);setAttemptError('');}}>Modifier la commande</AlertDialogCancel><Button busy={busy} disabled={!attempt} onClick={()=>void sendAttempt()}>{attemptError?'Réessayer la même commande':'Confirmer et envoyer'}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </main>;
}

function ProductDialog({draft,menu,products,ingredients,disabled,onChange,onClose,onAdd}:{draft:ProductDraft|null;menu:Menu;products:Product[];ingredients:Ingredient[];disabled:boolean;onChange:(draft:ProductDraft|null)=>void;onClose:()=>void;onAdd:()=>void}){
 if(!draft)return <Dialog open={false} onOpenChange={open=>{if(!open)onClose();}}><DialogContent><DialogTitle>Personnaliser l’article</DialogTitle></DialogContent></Dialog>;
 const product=draft.product;
 const pizza=product.xxl!==null;
 const recipe=(product.ingredients||[]).map(id=>ingredients.find(item=>item.id===id)).filter((item):item is Ingredient=>!!item&&!item.locked);
 const extras=ingredients.filter(item=>item.extra&&!item.locked&&item.available&&!draft.removed.includes(item.id));
 const allergenIdsForLine=allergensOf(product,ingredients,draft.removed,draft.added,draft.option);
 const currentLine=lineFromDraft(draft),preview=priceCart([currentLine],menu);
 const patch=(value:Partial<ProductDraft>)=>onChange({...draft,...value});
 const toggle=(id:string,source:'removed'|'added')=>{const current=draft[source],next=current.includes(id)?current.filter(value=>value!==id):[...current,id];patch({[source]:next} as Partial<ProductDraft>);};
 const chooseSize=(size:CartLine['size'])=>patch({size,freeOption:draft.freeId?products.find(item=>item.id===draft.freeId)?.options?.[0]||'':''});
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="dolce-dialog pos-product-dialog"><DialogTitle className="pos-dialog-title">{product.name}</DialogTitle><DialogDescription>{product.description}</DialogDescription>
  {pizza&&<fieldset className="pos-size-choice"><legend>Taille</legend><div>{(['senior','xxl'] as const).map(size=><button type="button" key={size} aria-pressed={draft.size===size} className={draft.size===size?'is-selected':''} onClick={()=>chooseSize(size)} disabled={disabled}><span>{size==='senior'?'Senior · 31 cm':'XXL · 40 cm'}</span><strong>{money(size==='senior'?product.price:product.xxl||0)}</strong></button>)}</div></fieldset>}
  {!!product.options?.length&&<Field label="Garniture" id="pos-option"><Select value={draft.option} onValueChange={value=>patch({option:value})} disabled={disabled}><SelectTrigger id="pos-option" className="staff-select"><SelectValue placeholder="Choisir une garniture"/></SelectTrigger><SelectContent className="staff-select-popup" position="popper">{product.options.map(option=><SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></Field>}
  {recipe.length>0&&<fieldset className="pos-ingredients"><legend>Composition <span>Touchez un ingrédient pour le retirer</span></legend><div>{recipe.map(item=>{const removed=draft.removed.includes(item.id);return <button type="button" key={item.id} className={removed?'is-removed':''} aria-pressed={!removed} disabled={disabled||!item.available} onClick={()=>toggle(item.id,'removed')}>{removed?<Plus size={15}/>:<Check size={15}/>}<span>{item.name}</span>{!item.available&&<small>en rupture</small>}</button>;})}</div></fieldset>}
  {recipe.length>0&&extras.length>0&&<fieldset className="pos-ingredients pos-extras"><legend>Ajouter un supplément <span>{money(menu.extraPrice)} par ajout · {MAX_EXTRAS} maximum</span></legend><div>{extras.map(item=>{const added=draft.added.includes(item.id);return <button type="button" key={item.id} className={added?'is-added':''} aria-pressed={added} disabled={disabled||!added&&draft.added.length>=MAX_EXTRAS} onClick={()=>toggle(item.id,'added')}>{added?<Check size={15}/>:<Plus size={15}/>}<span>{item.name}</span></button>;})}</div></fieldset>}
  {product.offer&&pizza&&<Field label="2e pizza offerte (facultatif)" id="pos-free-pizza"><Select value={draft.freeId||'none'} onValueChange={value=>patch({freeId:value==='none'?'':value,freeOption:value==='none'?'':products.find(item=>item.id===value)?.options?.[0]||''})} disabled={disabled}><SelectTrigger id="pos-free-pizza" className="staff-select"><SelectValue/></SelectTrigger><SelectContent className="staff-select-popup" position="popper"><SelectItem value="none">Sans 2e pizza offerte</SelectItem>{products.filter(item=>item.xxl!==null&&item.available).map(item=><SelectItem key={item.id} value={item.id}>{item.name} · {draft.size==='xxl'?'XXL':'Senior'}</SelectItem>)}</SelectContent></Select></Field>}
  {draft.freeId&&products.find(item=>item.id===draft.freeId)?.options?.length?<Field label="Garniture de la 2e pizza" id="pos-free-option"><Select value={draft.freeOption} onValueChange={value=>patch({freeOption:value})} disabled={disabled}><SelectTrigger id="pos-free-option" className="staff-select"><SelectValue/></SelectTrigger><SelectContent className="staff-select-popup" position="popper">{products.find(item=>item.id===draft.freeId)?.options?.map(option=><SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></Field>:null}
  <div className={`pos-allergen-summary ${product.allergensChecked?'':'is-unverified'}`}><strong>Allergènes</strong><p>{product.allergensChecked?(allergenIdsForLine.length?allergenIdsForLine.map(allergenLabel).join(' · '):'Aucun des allergènes déclarés dans la recette.'):'Recette à vérifier avant de promettre une absence d’allergène.'}</p></div>
  {preview.problem&&<p className="field-error" role="alert">{preview.problem}</p>}
  <div className="pos-dialog-actions"><div><span>Prix pour {draft.quantity}</span><strong>{money(preview.total)}</strong></div><div className="pos-quantity"><Button type="button" tone="outline" disabled={disabled||draft.quantity<=1} aria-label="Diminuer la quantité" onClick={()=>patch({quantity:draft.quantity-1})}><Minus size={16}/></Button><span>{draft.quantity}</span><Button type="button" tone="outline" disabled={disabled||draft.quantity>=20} aria-label="Augmenter la quantité" onClick={()=>patch({quantity:draft.quantity+1})}><Plus size={16}/></Button></div><Button type="button" disabled={disabled||!!preview.problem} onClick={onAdd}>Ajouter au ticket</Button></div>
 </DialogContent></Dialog>;
}
