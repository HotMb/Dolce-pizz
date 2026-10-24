'use client';
import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {AlertTriangle,ArrowLeft,CheckCircle2,Clock,Printer,RefreshCw,ShieldCheck} from 'lucide-react';
import {api,Button,ErrorBox} from '../../components';
import {useStaffAccess} from '../staff-access';
import '../staff.css';
type Scope={organizationId:string;organizationName:string;roles:string[]};
type Count={status:string;count:number};
type Row={id:string;location_id:string;order_id:string;job_type:string;status:string;attempts:number;last_error:string|null;created_at:string;updated_at:string;printed_at:string|null};
type Data={counts:Count[];recent:Row[]};
const labels:Record<string,string>={pending:'En attente',printing:'Impression en cours',unknown:'Résultat inconnu',failed:'Échec'};
const date=(value:string)=>new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value));
export function PrintingMonitor(){
 const access=useStaffAccess();const owners=useMemo(()=>{const seen=new Set<string>();return (access.data?.scopes||[]).filter(scope=>scope.roles.includes('owner')).filter(scope=>{if(seen.has(scope.organizationId))return false;seen.add(scope.organizationId);return true;}) as Scope[];},[access.data]);
 const [selected,setSelected]=useState(''),[data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState('');const scope=owners.find(item=>item.organizationId===selected)||owners[0];
 const load=()=>{if(!scope)return;setLoading(true);setError('');void api<Data>(`admin/printing?organizationId=${encodeURIComponent(scope.organizationId)}`,'GET').then(setData).catch(cause=>setError((cause as Error).message||'Impossible de charger la file d’impression.')).finally(()=>setLoading(false));};
 useEffect(()=>{if(scope)load();},[scope?.organizationId]);
 const retry=async(row:Row)=>{if(busy)return;setBusy(row.id);setError('');try{await api('admin/printing','POST',{organizationId:scope!.organizationId,jobId:row.id});await load();}catch(cause){setError((cause as Error).message||'La relance a échoué.');}finally{setBusy('');}};
 const counts=Object.fromEntries((data?.counts||[]).map(item=>[item.status,item.count]));
 if(!access.data&&!access.loading)return <main className="page-shell staff-shell"><ErrorBox message={access.error||'Accès indisponible.'}/></main>;
 return <main className="page-shell staff-shell"><header className="staff-heading"><div><Link href="/equipe" className="staff-back"><ArrowLeft size={18}/> Espace équipe</Link><p className="staff-eyebrow"><Printer size={17}/> SUPERVISION IMPRESSION</p><h1>Tickets cuisine<span>.</span></h1><p>Relancez uniquement les échecs confirmés. Un résultat inconnu doit être rapproché avant toute nouvelle impression.</p></div><Button tone="outline" busy={loading} onClick={load}><RefreshCw size={17}/> Actualiser</Button></header>
 {owners.length>1&&<section className="panel"><label htmlFor="printing-org"><b>Enseigne</b></label><select id="printing-org" className="staff-select" value={scope?.organizationId||''} onChange={event=>setSelected(event.target.value)}>{owners.map(item=><option key={item.organizationId} value={item.organizationId}>{item.organizationName}</option>)}</select></section>}
 {error&&<ErrorBox message={error}/>}{!scope?<section className="panel staff-empty"><ShieldCheck size={36}/><h2>Aucune supervision disponible.</h2><p>Cette vue est réservée au propriétaire de l’enseigne.</p></section>:<><section className="stat-grid"><div className="stat"><p>En attente</p><strong>{counts.pending||0}</strong></div><div className="stat"><p>En cours</p><strong>{counts.printing||0}</strong></div><div className="stat"><p>Résultat inconnu</p><strong>{counts.unknown||0}</strong></div><div className="stat"><p>Échecs</p><strong>{counts.failed||0}</strong></div></section><section className="panel report-table"><div className="staff-section-heading"><div><p className="staff-eyebrow"><Clock size={16}/> FILE LOCALE</p><h2>Jobs à surveiller</h2></div></div>{!data?.recent.length?<p className="staff-list-empty"><CheckCircle2 size={22}/> Aucun job ouvert.</p>:<table><thead><tr><th>État</th><th>Établissement</th><th>Commande</th><th>Tentatives</th><th>Dernière erreur</th><th>Action</th></tr></thead><tbody>{data.recent.map(row=><tr key={row.id}><th scope="row">{row.status==='unknown'||row.status==='failed'?<AlertTriangle size={15}/>:null} {labels[row.status]||row.status}</th><td>{row.location_id}</td><td><code>{row.order_id.slice(0,12)}</code></td><td>{row.attempts}</td><td>{row.last_error||'—'}</td><td>{row.status==='failed'?<Button tone="outline" busy={busy===row.id} disabled={!!busy} onClick={()=>void retry(row)}>Relancer</Button>:<span className="muted">Rapprochement requis</span>}</td></tr>)}</tbody></table>}</section></>}
 </main>;
}
