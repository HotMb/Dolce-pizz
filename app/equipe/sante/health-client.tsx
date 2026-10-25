'use client';

import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {AlertTriangle,ArrowLeft,CheckCircle2,Clock,MonitorSmartphone,RefreshCw,ShieldCheck,TriangleAlert} from 'lucide-react';
import {api,Button,ErrorBox} from '../../components';
import {useStaffAccess} from '../staff-access';
import '../staff.css';

type Scope={organizationId:string;organizationName:string;locationId:string;locationName:string;roles:string[]};
type Check={id:string;status:'ok'|'attention'|'blocked';details:Record<string,number|string|boolean>};
type Data={overall:'ok'|'attention'|'blocked';decision:'go'|'go_limited'|'no_go';decisionReasons:string[];checkedAt:string;checks:Check[];locationId:string|null};
const labels:Record<string,string>={locations:'Établissements',location_configuration:'Configuration locale',devices:'Appareils',notifications:'File SMS',sms_provider:'Fournisseur SMS',printing:'Impression',delivery_integrations:'Agrégateurs de livraison',payment_reconciliation:'Rapprochement TPE',payment_terminal:'Terminal de paiement'};
const statusLabel:Record<string,string>={ok:'Opérationnel',attention:'À vérifier',blocked:'Bloquant'};
const decisionLabel:Record<string,string>={go:'GO',go_limited:'GO LIMITÉ',no_go:'NO-GO'};
const value=(check:Check,key:string)=>check.details[key]??0;
const date=(value:string)=>new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'medium'}).format(new Date(value));

export function HealthClient(){
 const access=useStaffAccess();
 const owner=useMemo(()=>((access.data?.scopes||[]).find(scope=>scope.organizationId==='dolce-pizza'&&scope.locationId==='ronchin'&&scope.roles.includes('owner'))||(access.data?.scopes||[]).find(scope=>scope.roles.includes('owner'))) as Scope|undefined,[access.data?.scopes]);
 const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const load=()=>{if(!owner)return;setLoading(true);setError('');const query=new URLSearchParams({organizationId:owner.organizationId,locationId:'ronchin'});void api<Data>(`admin/health?${query}`,'GET').then(setData).catch(cause=>setError((cause as Error).message||'Impossible de charger la supervision.')).finally(()=>setLoading(false));};
 useEffect(()=>{if(owner)load();},[owner?.organizationId]);
 if(!access.data&&!access.loading)return <main className="page-shell staff-shell"><ErrorBox message={access.error||'Accès indisponible.'}/></main>;
 const overall=data?.overall||'attention';
 return <main className="page-shell staff-shell"><header className="staff-heading"><div><Link href="/equipe" className="staff-back"><ArrowLeft size={18}/> Espace équipe</Link><p className="staff-eyebrow"><MonitorSmartphone size={17}/> SUPERVISION · RONCHIN</p><h1>État du service<span>.</span></h1><p>Vérifiez les appareils et les files techniques avant l’ouverture.</p></div><Button tone="outline" busy={loading} onClick={load}><RefreshCw size={17}/> Actualiser</Button></header>
  {error&&<ErrorBox message={error}/>}{!owner?<section className="panel staff-empty"><ShieldCheck size={36}/><h2>Aucune supervision disponible.</h2><p>Cette vue est réservée au propriétaire de Dolce Pizz’ à Ronchin.</p></section>:<><section className="panel health-site-banner"><strong>Dolce Pizz’ · Ronchin</strong><span>Site actif unique</span></section><section className="stat-grid"><div className="stat"><p>Décision d’ouverture</p><strong>{data?decisionLabel[data.decision]:'—'}</strong></div><div className="stat"><p>État global</p><strong>{statusLabel[overall]}</strong></div><div className="stat"><p>Contrôles</p><strong>{data?.checks.length||0}</strong></div><div className="stat"><p>Dernière lecture</p><strong>{data?date(data.checkedAt):'—'}</strong></div></section><section className="panel report-table"><div className="staff-section-heading"><div><p className="staff-eyebrow"><Clock size={16}/> CONTRÔLES TECHNIQUES</p><h2>État de préparation</h2></div></div>{data?.decisionReasons.length?<p className="staff-access-warning">La décision est limitée par : {data.decisionReasons.map(reason=>labels[reason]||reason).join(' · ')}.</p>:null}{!data&&!loading?<p className="staff-list-empty">Aucun résultat de supervision.</p>:<table><thead><tr><th>Contrôle</th><th>État</th><th>Détails</th></tr></thead><tbody>{(data?.checks||[]).map(check=><tr key={check.id}><th scope="row">{check.status==='ok'?<CheckCircle2 size={15}/>:check.status==='blocked'?<TriangleAlert size={15}/>:<AlertTriangle size={15}/>} {labels[check.id]||check.id}</th><td>{statusLabel[check.status]}</td><td>{check.id==='devices'?`${value(check,'active')} actifs · KDS ${value(check,'kds')} · POS ${value(check,'pos')} · bornes ${value(check,'kiosks')} · relais ${value(check,'printerGateways')} · ${value(check,'stale')} hors ligne · ${value(check,'expired')} expiré(s) · ${value(check,'expiringSoon')} bientôt expiré(s)`:check.id==='location_configuration'?`${value(check,'configured')} / ${value(check,'total')} configurés`:check.id==='locations'?`${value(check,'active')} / ${value(check,'total')} actifs`:check.id==='payment_reconciliation'?`${value(check,'open')} rapprochement(s) à traiter`:check.id==='payment_terminal'?`${value(check,'configured')?'Configuré':'Non configuré'} · fournisseur ${value(check,'provider')||'aucun'}`:check.id==='sms_provider'?`${value(check,'providerConfigured')?'Fournisseur configuré':'Fournisseur absent'} · ${value(check,'schedulerConfigured')?'ordonnanceur configuré':'ordonnanceur absent'} · ${value(check,'senderConfigured')?'expéditeur valide':'expéditeur invalide'}`:`${value(check,'open')} ouverts, ${value(check,'errors')} erreurs`}</td></tr>)}</tbody></table>}</section><p className="staff-access-warning">Un appareil à vérifier n’est pas automatiquement révoqué. Contrôlez son alimentation et son réseau, puis utilisez le bouton Actualiser.</p></>}
 </main>;
}
