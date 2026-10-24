'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {AlertTriangle,ArrowLeft,Check,CheckCircle2,ChefHat,Clock3,Coffee,Flame,LoaderCircle,PackageCheck,RefreshCw,Utensils,Wifi,WifiOff} from 'lucide-react';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {api} from '../components';
import {loginPath} from '../member-ui';
import {productionHref,scopeQuery,useStaffAccess,type StaffScope} from '../equipe/staff-access';

export type Station='make_line'|'oven'|'expeditor';
type StepStatus='pending'|'in_progress'|'completed';
type OrderStatus='in_progress'|'ready'|'cancelled'|'completed';
type StationStep={station:Station;status:StepStatus;startedAt:string|null;completedAt:string|null};
type ProductionUnit={id:string;lineId:string;name:string;kind:string;size?:string;option?:string;without?:string[];extra?:string[];allergens?:string[];allergensKnown:boolean;routeKnown:boolean;steps:StationStep[]};
type ProductionTicket={id:string;ticketNumber:string;slot:string;createdAt:string;channel:string;fulfillment:string;note:string|null;status:OrderStatus;revision:number;items:ProductionUnit[]};
type ProductionResponse={orders:ProductionTicket[]};
type Command={orderId:string;action:'start'|'complete'|'ready';itemId?:string;station?:Station;expectedRevision:number};
type StationInfo={name:string;shortName:string;description:string;icon:typeof ChefHat;actionPending:string;actionActive:string;doneLabel:string};
const stationInfo:Record<Station,StationInfo>={
 make_line:{name:'Montage',shortName:'Make Line',description:'Préparez chaque article selon sa composition et ses modifications.',icon:ChefHat,actionPending:'Commencer le montage',actionActive:'Préparée · envoyer au four',doneLabel:'Montage confirmé'},
 oven:{name:'Four',shortName:'Cuisson',description:'Enfournez les pizzas puis confirmez manuellement leur sortie.',icon:Flame,actionPending:'Enfourner',actionActive:'Confirmer la sortie du four',doneLabel:'Cuisson confirmée'},
 expeditor:{name:'Expédition',shortName:'Expeditor',description:'Rassemblez les articles et vérifiez chaque ticket avant de le déclarer prêt.',icon:PackageCheck,actionPending:'Commencer le contrôle',actionActive:'Confirmer l’article',doneLabel:'Article vérifié'},
};
const stationOrder:Station[]=['make_line','oven','expeditor'];
const stationNames:Record<Station,string>={make_line:'Montage',oven:'Four',expeditor:'Expédition'};
const timeFormat=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'});
const dateTimeFormat=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const displayValue=(value:string)=>value.replaceAll('_',' ').replace(/^./,letter=>letter.toLocaleUpperCase('fr'));
function labelForChannel(value:string){const labels:Record<string,string>={web:'En ligne',phone:'Téléphone',call_center:'Centre d’appels',counter:'Comptoir',in_store:'Comptoir',kiosk:'Borne',uber_eats:'Uber Eats',delivery:'Livraison maison'};return labels[value]||displayValue(value);}
function labelForFulfillment(value:string){const labels:Record<string,string>={pickup:'À emporter',delivery:'Livraison · non activée au pilote',dine_in:'Sur place'};return labels[value]||displayValue(value);}
function validResponse(value:unknown):ProductionResponse{
 if(!value||typeof value!=='object'||!Array.isArray((value as {orders?:unknown}).orders))throw new Error('Le poste a reçu un format de ticket inattendu. Actualisez l’écran ou contactez le support.');
 const orders=(value as {orders:unknown[]}).orders;
 for(const candidate of orders){
  if(!candidate||typeof candidate!=='object')throw new Error('Un ticket reçu est incomplet. Actualisez l’écran.');
  const order=candidate as Partial<ProductionTicket>;
  if(typeof order.id!=='string'||typeof order.ticketNumber!=='string'||typeof order.slot!=='string'||typeof order.status!=='string'||!Number.isInteger(order.revision)||!Array.isArray(order.items))throw new Error('Un ticket reçu est incomplet. Actualisez l’écran.');
  for(const item of order.items){if(!item||typeof item.id!=='string'||typeof item.name!=='string'||!Array.isArray(item.steps))throw new Error('Un article de ticket est incomplet. Actualisez l’écran.');}
 }
 return value as ProductionResponse;
}
function currentStep(item:ProductionUnit){return item.steps.find(step=>step.status!=='completed');}
function stationStep(item:ProductionUnit,station:Station){return item.steps.find(step=>step.station===station);}
function allStepsComplete(order:ProductionTicket){return order.items.length>0&&order.items.every(item=>item.steps.length>0&&item.steps.every(step=>step.status==='completed'));}
function hasConfirmedProductionData(order:ProductionTicket){return order.items.length>0&&order.items.every(item=>item.allergensKnown===true&&item.routeKnown===true);}
function readableTime(value:string){const date=new Date(value);return Number.isFinite(date.getTime())?dateTimeFormat.format(date):'Horaire non disponible';}
function elapsedSince(value:string|null,now:number){if(!value)return null;const ms=now-Date.parse(value);if(!Number.isFinite(ms)||ms<0)return '00:00';const seconds=Math.floor(ms/1000),minutes=Math.floor(seconds/60),hours=Math.floor(minutes/60);return hours?`${hours} h ${String(minutes%60).padStart(2,'0')} min`:`${String(minutes).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
function commandError(error:unknown){const value=error as {message?:string;status?:number};return {message:value?.message||'L’action n’a pas été confirmée. Actualisez le ticket avant de réessayer.',conflict:value?.status===409};}

function useProductionData(station:Station,scope:StaffScope,onAuthorizationFailure:()=>Promise<void>){
 const query=scopeQuery(scope),cacheKey=`dolce-production:${query}:${station}`;
 const cached=useMemo<ProductionResponse|null>(()=>{if(typeof window==='undefined')return null;try{const raw=sessionStorage.getItem(cacheKey);if(!raw)return null;return validResponse(JSON.parse(raw));}catch{return null;}},[cacheKey]);
 const[data,setData]=useState<ProductionResponse|null>(cached),[error,setError]=useState(''),[loading,setLoading]=useState(!cached),[fetching,setFetching]=useState(false),[lastSync,setLastSync]=useState<number|null>(null),[online,setOnline]=useState(()=>typeof navigator==='undefined'?true:navigator.onLine);
 const serial=useRef(0),controller=useRef<AbortController|null>(null),busy=useRef(false),hasData=useRef(!!cached),forbidden=useRef(false);
 const refresh=useCallback(async()=>{
  if(busy.current||controller.current||forbidden.current)return;
  const request=new AbortController(),id=++serial.current;controller.current=request;
  if(!hasData.current)setLoading(true);else setFetching(true);
  try{const result=await api<unknown>(`production?${query}&station=${station}`,'GET',undefined,request.signal);const parsed=validResponse(result);if(id===serial.current&&!request.signal.aborted){hasData.current=true;setData(parsed);setError('');setLastSync(Date.now());try{sessionStorage.setItem(cacheKey,JSON.stringify(parsed));}catch{}}}
  catch(cause){if(id===serial.current&&!request.signal.aborted){setError((cause as Error).message||'Impossible de charger les tickets.');const status=(cause as {status?:number}).status;if(status===401||status===403){forbidden.current=true;hasData.current=false;setData(null);void onAuthorizationFailure();}}}
  finally{if(id===serial.current&&!request.signal.aborted){setLoading(false);setFetching(false);controller.current=null;}}
 },[station,query,cacheKey,onAuthorizationFailure]);
 useEffect(()=>{const tick=window.setTimeout(()=>{setOnline(navigator.onLine);void refresh();},0);const poll=window.setInterval(()=>{if(!document.hidden&&navigator.onLine)void refresh();},4000);const onOnline=()=>{setOnline(true);void refresh();};const onOffline=()=>setOnline(false);const onVisibility=()=>{if(!document.hidden&&navigator.onLine)void refresh();};window.addEventListener('online',onOnline);window.addEventListener('offline',onOffline);document.addEventListener('visibilitychange',onVisibility);return()=>{window.clearTimeout(tick);window.clearInterval(poll);controller.current?.abort();window.removeEventListener('online',onOnline);window.removeEventListener('offline',onOffline);document.removeEventListener('visibilitychange',onVisibility);};},[refresh]);
 const pauseForCommand=()=>{busy.current=true;serial.current++;controller.current?.abort();controller.current=null;setFetching(false);};
 const resumeAfterCommand=()=>{busy.current=false;};
 const retry=()=>{forbidden.current=false;return refresh();};
 const removeUnauthorized=()=>{forbidden.current=true;hasData.current=false;setData(null);setError('Vos droits ont changé. Retrouvez vos postes autorisés dans l’espace équipe.');void onAuthorizationFailure();};
 return {data,error,loading,fetching,lastSync,online,refresh,retry,pauseForCommand,resumeAfterCommand,removeUnauthorized};
}

export function ProductionKds({station:requestedStation,organizationId,locationId}:{station?:Station;organizationId?:string;locationId?:string}){
 const access=useStaffAccess(),router=useRouter();
 if(access.loading&&!access.data)return <main id="contenu" className="production-shell"><div className="production-loading" role="status"><LoaderCircle size={26} className="production-spin"/>Vérification de vos postes…</div></main>;
 const scopes=(access.data?.scopes||[]).filter(scope=>scope.stations.length>0);
 const explicit=!!organizationId||!!locationId;
 const scope=explicit?scopes.find(item=>item.organizationId===organizationId&&item.locationId===locationId):scopes[0];
 const station=requestedStation||scope?.stations[0];
 if(!scope||!station||!scope.stations.includes(station))return <main id="contenu" className="production-shell"><div className="production-first-error"><AlertTriangle size={32}/><h1>{access.error?'Vos accès ne sont pas disponibles.':'Ce poste ne vous est pas attribué.'}</h1><p>{access.error||'Choisissez un poste autorisé depuis l’espace équipe ou demandez au responsable de vérifier vos droits.'}</p><Link href={access.status===401?loginPath('/production'):'/equipe'} className="production-button production-button-primary">{access.status===401?'Se reconnecter':'Retrouver mes postes'}</Link><button type="button" className="production-button production-button-secondary" disabled={access.refreshing} onClick={()=>void access.refresh()}><RefreshCw size={18}/> Vérifier mes accès</button></div></main>;
 return <ProductionBoard key={`${scopeQuery(scope)}:${station}`} station={station} scope={scope} scopes={scopes} accessError={access.error} onAuthorizationFailure={access.refresh} onSelectScope={next=>{const nextStation=next.stations.includes(station)?station:next.stations[0];router.push(productionHref(next,nextStation));}}/>;
}

function ProductionBoard({station,scope,scopes,accessError,onAuthorizationFailure,onSelectScope}:{station:Station;scope:StaffScope;scopes:StaffScope[];accessError:string;onAuthorizationFailure:()=>Promise<void>;onSelectScope:(scope:StaffScope)=>void}){
 const info=stationInfo[station],Icon=info.icon;
 const resource=useProductionData(station,scope,onAuthorizationFailure);
 const[busyKey,setBusyKey]=useState(''),[actionError,setActionError]=useState(''),[conflict,setConflict]=useState(false),[feedback,setFeedback]=useState(''),[now,setNow]=useState(0);
 const busyRef=useRef(false);
 useEffect(()=>{const tick=()=>setNow(Date.now());const first=window.setTimeout(tick,0);const timer=window.setInterval(tick,1000);return()=>{window.clearTimeout(first);window.clearInterval(timer);};},[]);
 const tickets=useMemo(()=>resource.data?.orders.filter(order=>order.status==='in_progress'||order.status==='ready')||[],[resource.data]);
 const actionableCount=tickets.reduce((count,order)=>count+order.items.filter(item=>currentStep(item)?.station===station).length,0);
 const runCommand=async(command:Command,key:string)=>{
  if(busyRef.current||accessError||!resource.online||resource.error||!scope.writeStations.includes(station)||(command.action==='ready'&&!scope.canMarkReady))return;busyRef.current=true;setBusyKey(key);setActionError('');setConflict(false);setFeedback('');resource.pauseForCommand();
  try{await api(`production?${scopeQuery(scope)}`,'POST',command);setFeedback('Action enregistrée par le serveur.');}
  catch(error){const result=commandError(error);setActionError(result.message);setConflict(result.conflict);const status=(error as {status?:number}).status;if(status===401||status===403)resource.removeUnauthorized();}
  finally{busyRef.current=false;resource.resumeAfterCommand();setBusyKey('');await resource.refresh();}
 };
 const retry=()=>{setActionError('');setConflict(false);void resource.retry();};

 if(resource.loading&&!resource.data)return <main id="contenu" className="production-shell"><div className="production-loading" role="status"><LoaderCircle size={26} className="production-spin"/>Connexion aux postes…</div></main>;
 if(resource.error&&!resource.data)return <main id="contenu" className="production-shell"><div className="production-first-error"><div className="production-alert-icon"><WifiOff/></div><h1>Les tickets ne sont pas disponibles.</h1><p>{resource.error}</p><button type="button" className="production-button production-button-primary" onClick={retry}><RefreshCw size={20}/> Réessayer</button><Link className="production-back" href="/equipe">Retrouver mes postes</Link></div></main>;

 return <main id="contenu" className={`production-shell station-${station}`}>
  <header className="production-topbar">
   <div className="production-brand-block"><Link href="/equipe" className="production-back"><ArrowLeft size={18}/> Espace équipe</Link><div className="production-brand-line"><span className="production-brand-dot" aria-hidden="true"/><span>PRODUCTION</span><span className="production-separator">/</span><span>{info.name.toLocaleUpperCase('fr')}</span></div></div>
   <div className="production-sync" aria-live="polite">{resource.online?<Wifi size={17}/>:<WifiOff size={17}/>}<span>{resource.online?resource.error?'Connexion à rétablir':resource.fetching?'Actualisation…':`Synchronisé à ${resource.lastSync?timeFormat.format(resource.lastSync):'—'}`:'Hors connexion · affichage en lecture seule'}</span><button type="button" className="production-refresh" onClick={retry} disabled={resource.fetching||busyKey!==''} aria-label="Actualiser les tickets"><RefreshCw size={19}/></button></div>
  </header>
  <div className="production-scope"><div><label htmlFor="production-location">Établissement actif</label><Select value={scopeQuery(scope)} onValueChange={value=>{const next=scopes.find(item=>scopeQuery(item)===value);if(next)onSelectScope(next);}} disabled={busyKey!==''||!!accessError}><SelectTrigger id="production-location" className="staff-select"><SelectValue/></SelectTrigger><SelectContent className="staff-select-popup" position="popper">{scopes.map(item=><SelectItem key={scopeQuery(item)} value={scopeQuery(item)}>{item.organizationName} · {item.locationName}</SelectItem>)}</SelectContent></Select></div><p>{scope.writeStations.includes(station)?'Validation autorisée sur ce poste.':'Lecture seule · vous pouvez consulter les tickets sans valider les étapes.'}</p></div>
  <section className="production-heading">
   <div className="production-heading-copy"><p className="production-eyebrow"><Icon size={17}/>{info.shortName} · POSTE DE TRAVAIL</p><h1>{info.name}<span>.</span></h1><p>{info.description}</p></div>
   <div className="production-count" aria-label={`${actionableCount} article${actionableCount===1?'':'s'} à traiter`}><strong>{actionableCount}</strong><span>article{actionableCount===1?'':'s'} à traiter</span></div>
  </section>
  <nav className="production-stations" aria-label="Choisir un poste de production">{stationOrder.filter(key=>scope.stations.includes(key)).map(key=>{const tab=stationInfo[key],TabIcon=tab.icon;return <Link key={key} href={productionHref(scope,key)} className={`production-station-tab ${station===key?'is-current':''}`} aria-current={station===key?'page':undefined}><TabIcon size={21}/><span>{tab.name}</span><span className="production-station-step">{stationOrder.indexOf(key)+1}/3</span></Link>;})}</nav>
  {accessError&&<div className="production-banner is-warning" role="alert"><AlertTriangle size={21}/><div><strong>Les droits doivent être vérifiés.</strong><p>{accessError} Les validations sont bloquées jusqu’à la vérification.</p></div><button type="button" onClick={()=>void onAuthorizationFailure()}>Vérifier les accès</button></div>}
  {resource.error&&resource.data&&<div className="production-banner is-warning" role="alert"><WifiOff size={21}/><div><strong>Affichage des dernières données reçues.</strong><p>La connexion n’a pas permis de récupérer les changements récents. Les validations en attente ne sont pas enregistrées.</p></div><button type="button" onClick={retry} disabled={resource.fetching}>Actualiser</button></div>}
  {actionError&&<div className={`production-banner ${conflict?'is-conflict':'is-error'}`} role="alert"><AlertTriangle size={22}/><div><strong>{conflict?'Ticket modifié sur un autre poste.':'Action non confirmée.'}</strong><p>{actionError}{conflict?' Vérifiez son nouvel état avant de poursuivre.':''}</p></div><button type="button" onClick={retry} disabled={resource.fetching}><RefreshCw size={17}/> Actualiser</button></div>}
  {feedback&&<p className="production-feedback" role="status"><CheckCircle2 size={18}/>{feedback}</p>}
  {!tickets.length?<section className="production-empty" aria-live="polite"><div className="production-empty-mark"><Icon size={34}/></div><h2>Aucun ticket en attente au poste {info.name.toLocaleLowerCase('fr')}.</h2><p>Les nouveaux articles s’afficheront ici dès leur transmission à la production.</p><button type="button" className="production-button production-button-secondary" onClick={retry} disabled={resource.fetching}><RefreshCw size={19}/> Actualiser les tickets</button></section>:<section className="production-ticket-grid" aria-label={`Tickets du poste ${info.name}`}>
   {tickets.map(order=><ProductionTicketCard key={order.id} order={order} station={station} now={now} busyKey={busyKey} online={resource.online&&!resource.error&&!accessError} canWrite={scope.writeStations.includes(station)} canMarkReady={scope.canMarkReady} onCommand={runCommand}/>)
   }</section>}
  <footer className="production-footer"><span><span className="production-live-dot"/>Actualisation automatique toutes les 4 secondes</span><span>Horaires affichés · Europe/Paris</span></footer>
 </main>;
}

function ProductionTicketCard({order,station,now,busyKey,online,canWrite,canMarkReady,onCommand}:{order:ProductionTicket;station:Station;now:number;busyKey:string;online:boolean;canWrite:boolean;canMarkReady:boolean;onCommand:(command:Command,key:string)=>Promise<void>}){
 const visibleItems=station==='expeditor'?order.items:order.items.filter(item=>currentStep(item)?.station===station);
 const finished=allStepsComplete(order),ready=order.status==='ready',known=hasConfirmedProductionData(order);
 return <article className={`production-ticket ${ready?'is-ready':''}`} aria-labelledby={`ticket-${order.id}`}>
  <header className="production-ticket-head"><div><span className="production-ticket-number">TICKET</span><h2 id={`ticket-${order.id}`}>{order.ticketNumber}</h2></div><div className="production-ticket-times"><span><Clock3 size={16}/><time dateTime={order.slot}>{readableTime(order.slot)}</time></span><small>Reçu à {readableTime(order.createdAt)}</small></div></header>
  <div className="production-ticket-tags"><span className="production-tag tag-channel">{labelForChannel(order.channel)}</span><span className="production-tag tag-fulfillment"><Utensils size={15}/>{labelForFulfillment(order.fulfillment)}</span>{ready&&<span className="production-tag tag-ready"><CheckCircle2 size={15}/>Commande prête</span>}</div>
  {order.note&&<p className="production-order-note"><AlertTriangle size={16}/><span>Note du ticket : <strong>{order.note}</strong></span></p>}
  <div className="production-items">{visibleItems.map(item=><ProductionItemRow key={item.id} item={item} station={station} now={now} busy={busyKey===`${order.id}:${item.id}`} disabled={!canWrite||!online||busyKey!==''||item.allergensKnown!==true||item.routeKnown!==true} onAction={action=>void onCommand({orderId:order.id,action,itemId:item.id,station,expectedRevision:order.revision},`${order.id}:${item.id}`)}/>)}</div>
  {station==='expeditor'&&<div className="production-order-final">
   <div className={`production-completeness ${finished&&known?'is-complete':'is-incomplete'}`}>{finished&&known?<CheckCircle2 size={21}/>:<Clock3 size={21}/>}<span>{!known?'Vérifiez les avertissements allergènes et routage avant de finaliser.':finished?'Tous les articles ont terminé leur parcours.':`${order.items.filter(item=>{const step=currentStep(item);return !!step&&step.station!=='expeditor';}).length} article(s) attendent encore un autre poste.`}</span></div>
   <button type="button" className="production-button production-button-ready" disabled={!canWrite||!canMarkReady||!finished||!known||ready||!online||busyKey!==''} aria-describedby={!canMarkReady?`production-ready-permission-${order.id}`:undefined} onClick={()=>void onCommand({orderId:order.id,action:'ready',station:'expeditor',expectedRevision:order.revision},`${order.id}:ready`)}>{busyKey===`${order.id}:ready`?<LoaderCircle className="production-spin" size={22}/>:<PackageCheck size={22}/>} {ready?'Commande déjà prête':'Marquer la commande prête'}</button>
   {!canMarkReady&&<p className="production-ready-help" id={`production-ready-permission-${order.id}`}>Votre rôle permet de consulter ce ticket. La validation finale nécessite un rôle autorisé.</p>}
   {(!finished||!known)&&!ready&&<p className="production-ready-help">Le parcours complet de chaque article, les allergènes et le routage doivent être confirmés avant de déclarer la commande prête.</p>}
  </div>}
 </article>;
}

function ProductionItemRow({item,station,now,busy,disabled,onAction}:{item:ProductionUnit;station:Station;now:number;busy:boolean;disabled:boolean;onAction:(action:'start'|'complete')=>void}){
 const active=currentStep(item),step=stationStep(item,station),isCurrent=active?.station===station,confirmed=item.allergensKnown===true&&item.routeKnown===true,canAct=isCurrent&&step?.status!=='completed'&&confirmed;
 const pendingAction=station==='oven'?'Enfourner':stationInfo[station].actionPending;
 const activeAction=stationInfo[station].actionActive;
 const actionLabel=step?.status==='in_progress'?activeAction:pendingAction;
 const ovenElapsed=station==='oven'&&step?.status==='in_progress'?elapsedSince(step.startedAt,now):null;
 const waitingFor=active&&active.station!==station?stationNames[active.station]:null;
 return <div className={`production-item ${canAct?'is-actionable':''}`}>
  <div className="production-item-main"><div className="production-item-title"><span className="production-item-type" aria-hidden="true">{item.kind==='drink'?<Coffee size={19}/>:item.kind==='dessert'?<PackageCheck size={19}/>:<Utensils size={19}/>}</span><div><h3>{item.name}</h3><p>{item.size&&<span>{displayValue(item.size)}</span>}{item.size&&item.option&&<span className="production-item-divider">·</span>}{item.option&&<span>{item.option}</span>}</p></div></div>
   {!!item.without?.length&&<p className="production-modification is-without"><AlertTriangle size={17}/><strong>SANS : {item.without.join(', ').toLocaleUpperCase('fr')}</strong></p>}
   {!!item.extra?.length&&<p className="production-modification is-extra"><Check size={17}/><strong>AJOUTER : {item.extra.join(', ').toLocaleUpperCase('fr')}</strong></p>}
   {item.allergensKnown!==true?<><p className="production-allergen is-unknown"><AlertTriangle size={18}/><strong>ALLERGÈNES NON CONFIRMÉS · NE PAS PRÉPARER</strong></p>{!!item.allergens?.length&&<p className="production-allergen"><AlertTriangle size={17}/><strong>Déclarations présentes mais non confirmées : {item.allergens.join(', ').toLocaleUpperCase('fr')}</strong></p>}</>:item.allergens?.length?<p className="production-allergen"><AlertTriangle size={18}/><strong>ALLERGÈNES : {item.allergens.join(', ').toLocaleUpperCase('fr')}</strong></p>:<p className="production-allergen is-clear"><CheckCircle2 size={17}/><span>Aucun allergène déclaré par la fiche confirmée</span></p>}
   {item.routeKnown!==true&&<p className="production-route-unknown"><AlertTriangle size={18}/><strong>ROUTAGE NON CONFIRMÉ · NE PAS PRÉPARER</strong></p>}
  </div>
  <div className="production-item-action">{canAct?<><button type="button" className="production-button production-button-item" disabled={disabled||busy} onClick={()=>onAction(step?.status==='in_progress'?'complete':'start')} aria-label={`${actionLabel} : ${item.name}`} aria-busy={busy}>{busy?<LoaderCircle className="production-spin" size={21}/>:step?.status==='in_progress'?<CheckCircle2 size={21}/>:station==='oven'?<Flame size={21}/>:<Check size={21}/>}<span>{busy?'Enregistrement…':actionLabel}</span></button>{ovenElapsed&&<span className="production-oven-clock"><Clock3 size={16}/><span>Depuis enfournement</span><time>{ovenElapsed}</time></span>}</>:<span className={`production-item-state ${step?.status==='completed'?'is-complete':''}`}>{!confirmed?<><AlertTriangle size={17}/>Données non confirmées</>:step?.status==='completed'?<><CheckCircle2 size={17}/>{stationInfo[station].doneLabel}</>:waitingFor?<><Clock3 size={17}/>En attente · {waitingFor}</>:<><Clock3 size={17}/>Étape non requise ici</>}</span>}</div>
 </div>;
}
