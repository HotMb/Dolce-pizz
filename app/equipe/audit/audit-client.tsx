'use client';
import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {ArrowLeft,Clock,RefreshCw,ShieldCheck,UserRound} from 'lucide-react';
import {api,Button,ErrorBox} from '../../components';
import {useStaffAccess} from '../staff-access';
import '../staff.css';
type Scope={organizationId:string;organizationName:string;roles:string[]};
type Entry={id:string;location_id:string;membership_id:string;actor_principal_id:string;target_principal_id:string;role:string;action:string;created_at:string};
type Data={entries:Entry[]};
const labels:Record<string,string>={grant:'Accès attribué',revoke:'Accès retiré',revoke_sessions:'Sessions révoquées'};
const date=(value:string)=>new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
export function AuditClient(){
 const access=useStaffAccess();const owners=useMemo(()=>{const seen=new Set<string>();return (access.data?.scopes||[]).filter(scope=>scope.roles.includes('owner')).filter(scope=>{if(seen.has(scope.organizationId))return false;seen.add(scope.organizationId);return true;}) as Scope[];},[access.data]);
 const [selected,setSelected]=useState(''),[data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');const scope=owners.find(item=>item.organizationId===selected)||owners[0];
 const load=()=>{if(!scope)return;setLoading(true);setError('');void api<Data>(`admin/audit?organizationId=${encodeURIComponent(scope.organizationId)}`,'GET').then(setData).catch(cause=>setError((cause as Error).message||'Impossible de charger l’audit.')).finally(()=>setLoading(false));};
 useEffect(()=>{if(scope)load();},[scope?.organizationId]);
 if(!access.data&&!access.loading)return <main className="page-shell staff-shell"><ErrorBox message={access.error||'Accès indisponible.'}/></main>;
 return <main className="page-shell staff-shell"><header className="staff-heading"><div><Link href="/equipe" className="staff-back"><ArrowLeft size={18}/> Espace équipe</Link><p className="staff-eyebrow"><ShieldCheck size={17}/> GOUVERNANCE</p><h1>Audit des accès<span>.</span></h1><p>Historique des attributions, révocations et sessions invalidées. Aucun client ni contenu de commande n’est affiché.</p></div><Button tone="outline" busy={loading} onClick={load}><RefreshCw size={17}/> Actualiser</Button></header>
 {owners.length>1&&<section className="panel"><label htmlFor="audit-org"><b>Enseigne</b></label><select id="audit-org" className="staff-select" value={scope?.organizationId||''} onChange={event=>setSelected(event.target.value)}>{owners.map(item=><option key={item.organizationId} value={item.organizationId}>{item.organizationName}</option>)}</select></section>}
 {error&&<ErrorBox message={error}/>} {!scope?<section className="panel staff-empty"><ShieldCheck size={36}/><h2>Aucun audit disponible.</h2><p>Cette vue est réservée au propriétaire de l’enseigne.</p></section>:<section className="panel report-table"><div className="staff-section-heading"><div><p className="staff-eyebrow"><Clock size={16}/> JOURNAL IMMUTABLE</p><h2>Dernières actions</h2></div></div>{!data?.entries.length?<p className="staff-list-empty">Aucune action enregistrée.</p>:<table><thead><tr><th>Action</th><th>Établissement</th><th>Acteur</th><th>Cible</th><th>Rôle</th><th>Date</th></tr></thead><tbody>{data.entries.map(entry=><tr key={entry.id}><th scope="row"><UserRound size={15}/> {labels[entry.action]||entry.action}</th><td>{entry.location_id}</td><td><code>{entry.actor_principal_id}</code></td><td><code>{entry.target_principal_id}</code></td><td>{entry.role}</td><td>{date(entry.created_at)}</td></tr>)}</tbody></table>}</section>}
 </main>;
}
