'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowLeft,Banknote,CheckCircle2,Clock,CreditCard,LoaderCircle,MapPin,RefreshCw,ReceiptText} from 'lucide-react';
import {api,Button,ErrorBox} from '../../components';
import {loginPath} from '../../member-ui';
import {scopeQuery,useStaffAccess} from '../staff-access';
import {AlertDialog,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';
import '../staff.css';
import './cashier.css';

type ReadyOrder={id:string;label:string;name:string;total:number;slot:string;channel:string;serviceMode?:string;tableLabel?:string;readyAt:string;createdAt:string};
type Payment={id:string;orderId:string;amount:number;method:'cash'|'card';status:string};
type Shift={id:string;businessDate:string;status:string;openingFloat:number;openedAt:string;cashSales:number;cardSales:number;paymentCount:number;expectedCash:number;version:number};
type CashierData={orders:ReadyOrder[];shift:Shift|null;scope:{organizationId:string;locationId:string}};
const money=(cents:number)=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(cents/100);
const channelLabel:Record<string,string>={web:'En ligne',phone:'Téléphone',counter:'Comptoir',pos:'Caisse',kiosk:'Borne'};
const timeLabel=(iso:string)=>{const date=new Date(iso);return Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(date);};

export function Cashier(){
 const access=useStaffAccess();
 const[scopeId,setScopeId]=useState(''),[orders,setOrders]=useState<ReadyOrder[]>([]),[shift,setShift]=useState<Shift|null>(null),[openingFloat,setOpeningFloat]=useState('0'),[countedCash,setCountedCash]=useState(''),[closeNote,setCloseNote]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[cardConfirmation,setCardConfirmation]=useState<ReadyOrder|null>(null);
 const request=useRef<AbortController|null>(null);
 const scopes=access.data?.scopes;
 const cashierScopes=useMemo(()=> (scopes||[]).filter(item=>item.roles.some(role=>['owner','manager','pos'].includes(role))),[scopes]);
 const scope=cashierScopes.find(item=>scopeQuery(item)===scopeId)||cashierScopes[0];
 useEffect(()=>{const timer=window.setTimeout(()=>{const requested=new URLSearchParams(window.location.search);const value=scopeQuery({organizationId:requested.get('organizationId')||'',locationId:requested.get('locationId')||''});if(cashierScopes.some(item=>scopeQuery(item)===value))setScopeId(value);},0);return()=>window.clearTimeout(timer);},[cashierScopes]);
 const load=useCallback(async()=>{
  if(!scope){setOrders([]);setLoading(false);return;}
  request.current?.abort();const controller=new AbortController();request.current=controller;setLoading(true);setError('');
  try{const result=await api<CashierData>(`staff/payments?${scopeQuery(scope)}`,'GET',undefined,controller.signal);setOrders(Array.isArray(result.orders)?result.orders:[]);setShift(result.shift||null);setNotice('');}
  catch(cause){if(!controller.signal.aborted)setError((cause as Error).message||'La caisse est indisponible.');}
  finally{if(!controller.signal.aborted)setLoading(false);}
 },[scope]);
 useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);const poll=window.setInterval(()=>{if(!document.hidden&&!busy)void load();},5000);return()=>{window.clearTimeout(timer);window.clearInterval(poll);request.current?.abort();};},[load,busy]);
 const pay=async(order:ReadyOrder,method:'cash'|'card')=>{
  if(!scope||busy)return;setBusy(`${order.id}:${method}`);setError('');setNotice('');
  try{const result=await api<{payment:Payment;order:{status:string;paymentStatus:string}}>('staff/payments','POST',{organizationId:scope.organizationId,locationId:scope.locationId,orderId:order.id,idempotencyKey:crypto.randomUUID(),amount:order.total,method});setOrders(rows=>rows.filter(row=>row.id!==order.id));setNotice(`Commande ${order.label} encaissée en ${method==='cash'?'espèces':'carte'} · ${money(result.payment.amount)}.`);}
  catch(cause){setError((cause as Error).message||'L’encaissement n’a pas été confirmé.');}
  finally{setBusy('');}
 };
 const manageShift=async(action:'open'|'close')=>{
  if(!scope||busy)return;setBusy(`shift:${action}`);setError('');setNotice('');
  try{const payload=action==='open'?{organizationId:scope.organizationId,locationId:scope.locationId,action,openingFloat:Math.round(Number(openingFloat.replace(',','.'))*100)}:{organizationId:scope.organizationId,locationId:scope.locationId,action,countedCash:Math.round(Number(countedCash.replace(',','.'))*100),closeNote,version:shift?.version};await api('staff/shifts','POST',payload);setNotice(action==='open'?'Shift ouvert.':'Shift clôturé.');setCountedCash('');await load();}
  catch(cause){setError((cause as Error).message||'Le shift n’a pas pu être enregistré.');} finally{setBusy('');}
 };
 if(access.loading&&!access.data)return <main className="page-shell staff-shell"><div className="staff-loading" role="status"><LoaderCircle size={24} className="spin"/>Vérification des accès…</div></main>;
 if(access.status===401)return <main className="page-shell staff-shell"><section className="panel staff-empty"><h1>Reconnectez-vous.</h1><Link className="btn btn-primary" href={loginPath('/equipe/caisse')}>Se connecter</Link></section></main>;
 if(access.error&&!access.data)return <main className="page-shell staff-shell"><ErrorBox message={access.error} retry={()=>void access.refresh()}/></main>;
 if(!cashierScopes.length)return <main className="page-shell staff-shell"><section className="panel staff-empty"><Banknote size={38}/><h1>Aucun accès caisse.</h1><p>Le propriétaire doit attribuer le rôle Comptoir, Responsable ou Propriétaire pour encaisser un retrait.</p><Link className="btn btn-outline" href="/equipe">Retour à l’espace équipe</Link></section></main>;
 return <main id="contenu" className="page-shell staff-shell cashier-shell">
  <header className="staff-heading"><div><Link href={`/equipe?${scope?scopeQuery(scope):''}`} className="staff-back"><ArrowLeft size={18}/> Espace équipe</Link><p className="staff-eyebrow"><Banknote size={17}/> CAISSE · RETRAIT</p><h1>Encaisser les commandes<span>.</span></h1><p>Confirmez le paiement seulement lorsque le client récupère sa commande.</p></div><Button tone="outline" busy={loading} onClick={()=>void load()}><RefreshCw size={18}/> Actualiser</Button></header>
  <section className="cashier-context panel"><div><p className="staff-eyebrow"><MapPin size={16}/> ÉTABLISSEMENT</p><strong>{scope?.locationName}</strong></div><select className="native-select" aria-label="Établissement de caisse" value={scope?scopeQuery(scope):''} onChange={event=>setScopeId(event.target.value)}>{cashierScopes.map(item=><option key={scopeQuery(item)} value={scopeQuery(item)}>{item.organizationName} · {item.locationName}</option>)}</select></section>
  <section className="panel cashier-shift"><div><p className="staff-eyebrow"><Banknote size={16}/> SHIFT DE CAISSE</p><h2>{shift?'Shift ouvert':'Aucun shift ouvert'}</h2>{shift?<p className="cashier-meta">Fond {money(shift.openingFloat)} · espèces {money(shift.cashSales)} · carte {money(shift.cardSales)} · attendu espèces {money(shift.expectedCash)}</p>:<p className="cashier-meta">Ouvrez la caisse avant le premier encaissement.</p>}</div>{scope?.roles.some(role=>role==='owner'||role==='manager')&&(shift?<div className="cashier-shift-actions"><label>Espèces comptées<input className="native-input" inputMode="decimal" value={countedCash} onChange={event=>setCountedCash(event.target.value)} placeholder={money(shift.expectedCash)}/></label><label>Note (si écart)<input className="native-input" value={closeNote} onChange={event=>setCloseNote(event.target.value)} placeholder="Optionnel"/></label><Button tone="outline" busy={busy==='shift:close'} disabled={!!busy||!countedCash} onClick={()=>void manageShift('close')}>Clôturer</Button></div>:<div className="cashier-shift-actions"><label>Fond initial<input className="native-input" inputMode="decimal" value={openingFloat} onChange={event=>setOpeningFloat(event.target.value)} /></label><Button busy={busy==='shift:open'} disabled={!!busy} onClick={()=>void manageShift('open')}>Ouvrir le shift</Button></div>)}</section>
  {notice&&<p className="cashier-notice" role="status"><CheckCircle2 size={18}/>{notice}</p>}{error&&<ErrorBox message={error} retry={()=>void load()}/>}<div className="cashier-heading"><div><p className="staff-eyebrow">À REMETTRE</p><h2>{orders.length} commande{orders.length===1?'':'s'} prête{orders.length===1?'':'s'}</h2></div><span className="cashier-live"><span/>Actualisation automatique</span></div>
  {loading&&!orders.length?<div className="panel staff-loading" role="status"><LoaderCircle size={22} className="spin"/>Chargement des commandes prêtes…</div>:!orders.length?<section className="panel cashier-empty"><CheckCircle2 size={42}/><h2>Aucune commande à encaisser.</h2><p>Les commandes apparaîtront ici après validation par l’Expeditor.</p></section>:<section className="cashier-grid" aria-label="Commandes prêtes à encaisser">{orders.map(order=><article className="panel cashier-card" key={order.id}><div className="cashier-card-head"><span className="cashier-ticket"><ReceiptText size={18}/>#{order.label}</span><span className="cashier-ready"><Clock size={15}/> prête à {timeLabel(order.readyAt)}</span></div><h3>{order.name||'Client comptoir'}</h3><p className="cashier-meta">{channelLabel[order.channel]||order.channel} · {order.serviceMode==='dine_in'?`sur place · table ${order.tableLabel||'à confirmer'}`:`retrait prévu ${timeLabel(order.slot)}`}</p><div className="cashier-total"><span>Total à encaisser</span><strong>{money(order.total)}</strong></div><div className="cashier-actions"><Button busy={busy===`${order.id}:cash`} disabled={!!busy} onClick={()=>void pay(order,'cash')}><Banknote size={18}/> Espèces</Button><Button tone="outline" busy={busy===`${order.id}:card`} disabled={!!busy} onClick={()=>setCardConfirmation(order)}><CreditCard size={18}/> Carte · TPE</Button></div></article>)}</section>}
  <AlertDialog open={!!cardConfirmation} onOpenChange={open=>{if(!open&&!busy)setCardConfirmation(null);}}><AlertDialogContent className="dolce-dialog staff-confirm"><AlertDialogHeader><AlertDialogTitle>Confirmer le paiement carte ?</AlertDialogTitle><AlertDialogDescription>Vérifiez que le terminal a accepté <strong>{cardConfirmation?money(cardConfirmation.total):''}</strong> avant de confirmer. Le raccordement automatique du TPE n’est pas encore installé.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="btn btn-outline" disabled={!!busy}>Retour</AlertDialogCancel><Button busy={!!busy} disabled={!cardConfirmation} onClick={()=>{const order=cardConfirmation;if(order){setCardConfirmation(null);void pay(order,'card');}}}>TPE validé, encaisser</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </main>;
}
