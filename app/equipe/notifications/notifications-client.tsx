'use client';
import {useEffect,useState} from 'react';
import {AlertTriangle,ArrowLeft,CheckCircle2,Clock,RefreshCw,Send,ShieldCheck} from 'lucide-react';
import Link from 'next/link';
import {api,Button,ErrorBox} from '../../components';
import {useStaffAccess} from '../staff-access';
import '../staff.css';

type Scope={organizationId:string;organizationName:string;roles:string[]};
type Count={status:string;count:number;oldest:string|null};
type Row={id:string;status:string;attempts:number;last_error_code:string|null;created_at:string;updated_at:string;sent_at:string|null};
type Data={counts:Count[];recent:Row[]};
const labels:Record<string,string>={pending:'En attente',sending:'En cours',sent:'Accepté fournisseur',unknown:'À rapprocher',failed:'Échec',skipped:'Écarté'};
const date=(value:string|null)=>value?new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'—';

export function NotificationMonitor(){
 const access=useStaffAccess();const owners=(access.data?.scopes||[]).filter(scope=>scope.roles.includes('owner'));const [selected,setSelected]=useState('');const scope=owners.find(item=>item.organizationId===selected)||owners[0];const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!scope)return;setLoading(true);setError('');void api<Data>(`admin/notifications?organizationId=${encodeURIComponent(scope.organizationId)}`,'GET').then(value=>setData(value)).catch(cause=>setError((cause as Error).message||'Impossible de charger la supervision.')).finally(()=>setLoading(false));},[scope?.organizationId]);
 const counts=Object.fromEntries((data?.counts||[]).map(item=>[item.status,item.count]));
 if(!access.data&&!access.loading)return <main className="page-shell staff-shell"><ErrorBox message={access.error||'Accès indisponible.'}/></main>;
 return <main className="page-shell staff-shell"><header className="staff-heading"><div><Link href="/equipe" className="staff-back"><ArrowLeft size={18}/> Espace équipe</Link><p className="staff-eyebrow"><Send size={17}/> SUPERVISION SMS</p><h1>Notifications prêtes<span>.</span></h1><p>État de la file transactionnelle, sans numéro de client ni contenu de commande.</p></div><Button tone="outline" busy={loading} onClick={()=>{if(!scope)return;setLoading(true);void api<Data>(`admin/notifications?organizationId=${encodeURIComponent(scope.organizationId)}`,'GET').then(setData).catch(cause=>setError((cause as Error).message||'Impossible de charger la supervision.')).finally(()=>setLoading(false));}}><RefreshCw size={17}/> Actualiser</Button></header>
  {owners.length>1&&<section className="panel"><label htmlFor="notification-org"><b>Enseigne</b></label><select id="notification-org" className="staff-select" value={scope?.organizationId||''} onChange={event=>setSelected(event.target.value)}>{owners.map(item=><option key={item.organizationId} value={item.organizationId}>{item.organizationName}</option>)}</select></section>}
  {error&&<ErrorBox message={error}/>}{!scope?<section className="panel staff-empty"><ShieldCheck size={36}/><h2>Aucune supervision disponible.</h2><p>Cette vue est réservée au propriétaire d’une enseigne.</p></section>:<><section className="stat-grid"><div className="stat"><p>En attente</p><strong>{counts.pending||0}</strong></div><div className="stat"><p>En cours</p><strong>{counts.sending||0}</strong></div><div className="stat"><p>À rapprocher</p><strong>{counts.unknown||0}</strong></div><div className="stat"><p>Échecs</p><strong>{counts.failed||0}</strong></div></section><section className="panel report-table"><div className="staff-section-heading"><div><p className="staff-eyebrow"><Clock size={16}/> ÉVÉNEMENTS À SURVEILLER</p><h2>File transactionnelle</h2></div></div>{!data?.recent.length?<p className="staff-list-empty"><CheckCircle2 size={22}/> Aucun événement ouvert.</p>:<table><thead><tr><th>État</th><th>Tentatives</th><th>Code</th><th>Créé</th><th>Mis à jour</th></tr></thead><tbody>{data.recent.map(row=><tr key={row.id}><th scope="row">{row.status==='unknown'||row.status==='failed'?<AlertTriangle size={15}/>:null} {labels[row.status]||row.status}</th><td>{row.attempts}</td><td>{row.last_error_code||'—'}</td><td>{date(row.created_at)}</td><td>{date(row.updated_at)}</td></tr>)}</tbody></table>}</section><p className="staff-access-warning">« Accepté fournisseur » confirme uniquement l’acceptation par le prestataire SMS. Un événement « À rapprocher » ne doit pas être renvoyé automatiquement.</p></>}
 </main>;
}
