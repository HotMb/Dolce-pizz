'use client';
import {useEffect,useRef,useState} from 'react';
import {ChefHat,PackageCheck,Printer,Volume2,ArrowLeft} from 'lucide-react';
import {useResource,api,Button,ErrorBox,type Order} from '../components';
import {TicketLines,usePrintTicket,enableSound,chime,slotTime,orderNumber} from '../kitchen-ticket';
export function Kitchen(){
 const{data,error,loading,refresh}=useResource<{orders:Order[]}>('admin/kitchen',5000);const{print,area}=usePrintTicket();
 const[sound,setSound]=useState(false),[busy,setBusy]=useState(''),[actionError,setActionError]=useState('');const seen=useRef<Set<string>|null>(null);
 useEffect(()=>{if(!data)return;const ids=data.orders.filter(o=>o.status==='preparing').map(o=>o.id);if(seen.current&&ids.some(id=>!seen.current!.has(id)))chime();seen.current=new Set([...(seen.current||[]),...ids]);},[data]);
 const activate=()=>{enableSound();setSound(true);const lock=()=>{void navigator.wakeLock?.request('screen').catch(()=>{});};lock();document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')lock();});};
 const ready=async(o:Order)=>{setBusy(o.id);setActionError('');try{await api(`admin/orders/${o.id}`,'PATCH',{status:'ready',version:o.version,reason:''});await refresh();}catch(e){setActionError((e as Error).message);await refresh();}finally{setBusy('');}};
 if(loading)return <main id="contenu" className="kitchen-shell"><div className="loading-block">Connexion à la cuisine…</div></main>;
 if(error)return <main id="contenu" className="page-shell"><ErrorBox message={error} retry={refresh}/><a className="text-link" href="/admin">Ouvrir l’espace équipe</a></main>;
 const todo=data!.orders.filter(o=>o.status==='preparing'),done=data!.orders.filter(o=>o.status==='ready');
 return <main id="contenu" className="kitchen-shell"><div className="kitchen-header"><div><a href="/admin" className="breadcrumb"><ArrowLeft size={15}/> Le comptoir</a><h1>CUISINE<span className="red">.</span></h1><p>{todo.length?`${todo.length} ticket${todo.length>1?'s':''} à préparer`:'Aucun ticket en attente'} · mise à jour automatique</p></div>{!sound?<Button onClick={activate}><Volume2 size={18}/> Activer le son des tickets</Button>:<span className="status status-ready"><Volume2 size={14}/> Son activé</span>}</div><ErrorBox message={actionError}/>
 {!todo.length?<div className="panel empty"><ChefHat size={46}/><h3>Tout est prêt.</h3><p>Les nouveaux tickets envoyés depuis le comptoir s’afficheront ici.</p></div>:<div className="kitchen-grid">{todo.map(o=><article className="kitchen-card" key={o.id}><div className="inline-between"><span className="k-slot">{slotTime(o.slot)}</span><span className="k-number">{orderNumber(o)}</span></div><p className="k-name">{o.name}</p><TicketLines order={o}/>{o.note&&<p className="k-note">{o.note}</p>}<p className="k-sent">Envoyée à {slotTime(o.updated_at)}</p><div className="k-actions"><Button busy={busy===o.id} onClick={()=>void ready(o)}><PackageCheck size={20}/> Prête</Button><Button tone="quiet" aria-label={`Imprimer le ticket ${orderNumber(o)}`} onClick={()=>print(o)}><Printer size={18}/></Button></div></article>)}</div>}
 {!!done.length&&<section className="kitchen-done"><h2>Prêtes · en attente du client</h2><div>{done.map(o=><span className="status status-ready" key={o.id}>{slotTime(o.slot)} · {o.name} · {orderNumber(o)}</span>)}</div></section>}{area}</main>;
}
