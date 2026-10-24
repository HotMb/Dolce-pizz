'use client';

import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {AlertTriangle,ArrowLeft,CheckCircle2,Clock,MonitorSmartphone,RefreshCw,ShieldCheck,TriangleAlert} from 'lucide-react';
import {api,Button,ErrorBox} from '../../components';
import {useStaffAccess} from '../staff-access';
import '../staff.css';

type Scope={organizationId:string;organizationName:string;locationId:string;locationName:string;roles:string[]};
type Check={id:string;status:'ok'|'attention'|'blocked';details:Record<string,number|string|boolean>};
type Data={overall:'ok'|'attention'|'blocked';checkedAt:string;checks:Check[];locationId:string|null};
const labels:Record<string,string>={locations:'Établissements',location_configuration:'Configuration locale',devices:'Appareils',notifications:'SMS transactionnels',printing:'Impression',delivery_integrations:'Agrégateurs de livraison'};
const statusLabel:Record<string,string>={ok:'Opérationnel',attention:'À vérifier',blocked:'Bloquant'};
const value=(check:Check,key:string)=>check.details[key]??0;
const date=(value:string)=>new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'medium'}).format(new Date(value));

export function HealthClient(){
 const access=useStaffAccess();
 const owners=useMemo(()=>{const seen=new Set<string>();return (access.data?.scopes||[]).filter(scope=>scope.roles.includes('owner')).filter(scope=>{if(seen.has(scope.organizationId)){return false;}seen.add(scope.organizationId);return true;}) as Scope[];},[access.data?.scopes]);
 const [selected,setSelected]=useState(''),[location,setLocation]=useState('all'),[data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const org=owners.find(item=>item.organizationId===selected)?.organizationId||owners[0]?.organizationId||'';
 const locations=(access.data?.scopes||[]).filter(scope=>scope.organizationId===org&&scope.roles.includes('owner')) as Scope[];
 const load=()=>{if(!org)return;setLoading(true);setError('');const query=new URLSearchParams({organizationId:org});if(location!=='all')query.set('locationId',location);void api<Data>(`admin/health?${query}`,'GET').then(setData).catch(cause=>setError((cause as Error).message||'Impossible de charger la supervision.')).finally(()=>setLoading(false));};
 useEffect(()=>{if(org)load();},[org,location]);
 if(!access.data&&!access.loading)return <main className="page-shell staff-shell"><ErrorBox message={access.error||'Accès indisponible.'}/></main>;
 const overall=data?.overall||'attention';
 return <main className="page-shell staff-shell"><header className="staff-heading"><div><Link href="/equipe" className="staff-back"><ArrowLeft size={18}/> Espace équipe</Link><p className="staff-eyebrow"><MonitorSmartphone size={17}/> SUPERVISION</p><h1>Santé des établissements<span>.</span></h1><p>Vérifiez les appareils et les files techniques avant l’ouverture.</p></div><Button tone="outline" busy={loading} onClick={load}><RefreshCw size={17}/> Actualiser</Button></header>
  {owners.length>1&&<section className="panel"><label htmlFor="health-org"><b>Enseigne</b></label><select id="health-org" className="staff-select" value={org} onChange={event=>{setSelected(event.target.value);setLocation('all');}}>{owners.map(item=><option key={item.organizationId} value={item.organizationId}>{item.organizationName}</option>)}</select></section>}
  {owners.length>0&&<section className="panel"><label htmlFor="health-location"><b>Établissement</b></label><select id="health-location" className="staff-select" value={location} onChange={event=>setLocation(event.target.value)}><option value="all">Tous les établissements</option>{locations.map(item=><option key={item.locationId} value={item.locationId}>{item.locationName}</option>)}</select></section>}
  {error&&<ErrorBox message={error}/>}{!owners.length?<section className="panel staff-empty"><ShieldCheck size={36}/><h2>Aucune supervision disponible.</h2><p>Cette vue est réservée au propriétaire d’une enseigne.</p></section>:<><section className="stat-grid"><div className="stat"><p>État global</p><strong>{statusLabel[overall]}</strong></div><div className="stat"><p>Contrôles</p><strong>{data?.checks.length||0}</strong></div><div className="stat"><p>Dernière lecture</p><strong>{data?date(data.checkedAt):'—'}</strong></div></section><section className="panel report-table"><div className="staff-section-heading"><div><p className="staff-eyebrow"><Clock size={16}/> CONTRÔLES TECHNIQUES</p><h2>État de préparation</h2></div></div>{!data&&!loading?<p className="staff-list-empty">Aucun résultat de supervision.</p>:<table><thead><tr><th>Contrôle</th><th>État</th><th>Détails</th></tr></thead><tbody>{(data?.checks||[]).map(check=><tr key={check.id}><th scope="row">{check.status==='ok'?<CheckCircle2 size={15}/>:check.status==='blocked'?<TriangleAlert size={15}/>:<AlertTriangle size={15}/>} {labels[check.id]||check.id}</th><td>{statusLabel[check.status]}</td><td>{check.id==='devices'?`${value(check,'active')} actifs, ${value(check,'stale')} hors ligne, ${value(check,'expired')} jeton(s) expiré(s)`:check.id==='location_configuration'?`${value(check,'configured')} / ${value(check,'total')} configurés`:check.id==='locations'?`${value(check,'active')} / ${value(check,'total')} actifs`:`${value(check,'open')} ouverts, ${value(check,'errors')} erreurs`}</td></tr>)}</tbody></table>}</section><p className="staff-access-warning">Un appareil à vérifier n’est pas automatiquement révoqué. Contrôlez son alimentation et son réseau, puis utilisez le bouton Actualiser.</p></>}
 </main>;
}
