'use client';
import {useEffect,useRef,useState} from 'react';
import {Send,Users,MessageSquare,Sparkles,Gift,RotateCcw} from 'lucide-react';
import {toast} from 'sonner';
import {api,useResource,Button,ErrorBox,Field,Modal} from '../components';
import {money,shortName,type Product} from '@/lib/catalog';
import {isPizza} from '@/lib/pricing';

type Campaign={id:string;message:string;status:string;total:number;sent:number;failed:number;simulated:number;created_at:string;finished_at:string};
type Props={audience:{customers:number;subscribers:number};sms:string;products:Product[];preset:string;clearPreset:()=>void};
// GSM 03.38: 160 characters per SMS (153 when split); any other character switches to Unicode, 70 (67).
const GSM="@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",GSM_EXT='^{}\\[~]|€';
export function smsSize(text:string){const gsm=[...text].every(c=>GSM.includes(c)||GSM_EXT.includes(c));const length=gsm?[...text].reduce((n,c)=>n+(GSM_EXT.includes(c)?2:1),0):[...text].length;const parts=gsm?(length<=160?1:Math.ceil(length/153)):(length<=70?1:Math.ceil(length/67));return {gsm,length,parts};}
// Characters outside the SMS alphabet (typographic quotes, î, ê, ç, œ…) switch to Unicode and halve the length:
// they are simplified as the owner types, as SMS senders usually do.
const translit:Record<string,string>={'â':'a','ê':'e','î':'i','ô':'o','û':'u','ë':'e','ï':'i','ç':'c','œ':'oe','Œ':'OE','À':'A','Â':'A','È':'E','Ê':'E','Î':'I','Ô':'O','Ù':'U','Û':'U'};
const plain=(s:string)=>s.replace(/[’‘]/g,"'").replace(/[“”«»]/g,'"').replace(/[…]/g,'...').replace(/[  ]/g,' ').replace(/[âêîôûëïçœŒÀÂÈÊÎÔÙÛ]/g,c=>translit[c]);
const templates=(products:Product[])=>{
 const offers=products.filter(p=>p.status==='published'&&p.offer).map(p=>shortName(p.name));
 return [
  {id:'offer',label:'2e pizza offerte',icon:Gift,text:offers.length?`Ce soir, votre 2e pizza est offerte sur la ${offers.slice(0,3).join(', la ')} ! Commandez en ligne ou au 03 20 40 09 01.`:'Ce soir, votre 2e pizza est offerte ! Commandez en ligne ou au 03 20 40 09 01.'},
  {id:'free',label:'Message libre',icon:MessageSquare,text:''},
 ];
};
const announce=(p:Product)=>plain(`Nouveau à la carte : la ${shortName(p.name)} !${p.description?` ${p.description.replace(/\.$/,'')}.`:''} Dès ce soir, en Senior ${money(p.price)}${p.xxl!==null?` ou XXL ${money(p.xxl)}`:''}.`).replace(/ +/g,' ');

export function PromosAdmin({audience,sms,products,preset,clearPreset}:Props){
 const history=useResource<{campaigns:Campaign[]}>('admin/campaigns');
 const[message,setMessage]=useState(''),[confirm,setConfirm]=useState(false),[running,setRunning]=useState<Campaign|null>(null),[error,setError]=useState('');const stop=useRef(false);
 const pizzas=products.filter(p=>p.status==='published'&&isPizza(p)).sort((a,b)=>(b.sort||0)-(a.sort||0));
 // Arriving from "Annoncer par SMS" after publishing a pizza: the announcement is prefilled.
 useEffect(()=>{if(!preset)return;const p=products.find(x=>x.id===preset);const t=window.setTimeout(()=>{if(p)setMessage(announce(p));clearPreset();},0);return()=>window.clearTimeout(t);},[preset,products,clearPreset]);
 const host=typeof location==='undefined'?'':location.host;const full=`Dolce Pizz' : ${message.trim()}\nSTOP SMS : ${host}/stop`;const size=smsSize(full);
 const last=history.data?.campaigns.find(c=>c.status==='done'&&!c.simulated);const pending=history.data?.campaigns.find(c=>c.status==='sending');
 const[now,setNow]=useState(0);useEffect(()=>{const t=window.setTimeout(()=>setNow(Date.now()),0);return()=>window.clearTimeout(t);},[history.data]);
 const recent=!!last&&now>0&&now-Date.parse(last.created_at)<72*3600000;
 const run=async(c:Campaign)=>{stop.current=false;setRunning(c);setError('');let current=c;
  try{while(current.status==='sending'&&!stop.current){current=(await api<{campaign:Campaign}>(`admin/campaigns/${current.id}/send`,'POST',{})).campaign;setRunning(current);}
   if(current.status==='done')toast.success(current.simulated?`Envoi simulé : ${current.sent} SMS (mode démonstration)`:`${current.sent} SMS envoyés${current.failed?`, ${current.failed} en échec`:''}`);}
  catch(e){setError((e as Error).message);}finally{setRunning(null);await history.refresh();}};
 const send=async()=>{setConfirm(false);setError('');try{const r=await api<{campaign:Campaign}>('admin/campaigns','POST',{message:message.trim()});setMessage('');await run(r.campaign);}catch(e){setError((e as Error).message);}};
 return <div className="promos-admin">
  <div className="stat-grid promo-stats"><div className="stat"><p><Users size={15}/> Clients inscrits</p><strong>{audience.customers}</strong></div><div className="stat"><p><MessageSquare size={15}/> Acceptent les SMS</p><strong>{audience.subscribers}</strong></div><div className="stat"><p>Taux d’accord</p><strong>{audience.customers?Math.round(audience.subscribers/audience.customers*100):0} %</strong></div><div className="stat"><p>Dernier envoi</p><strong className="stat-date">{last?new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short'}).format(new Date(last.created_at)):'—'}</strong></div></div>
  {sms==='demo'&&<div className="banner">Mode démonstration : aucun SMS ne part vraiment (pas de clé Brevo). Les envois sont simulés pour tester.</div>}
  {sms==='off'&&<div className="banner">Pour envoyer de vrais SMS, ajoutez la clé BREVO_API_KEY dans les secrets du site.</div>}
  <section className="panel"><h2><Sparkles size={20}/> Nouveau message</h2><p className="small muted">Seuls les clients qui ont coché « Recevoir nos promos par SMS » le reçoivent. Le lien de désinscription est ajouté automatiquement. Envoi du lundi au samedi, de 8 h à 20 h.</p>
   <div className="promo-templates">{pizzas.slice(0,6).map(p=><button type="button" key={p.id} className="chip-button" onClick={()=>setMessage(announce(p))}>Annoncer la {shortName(p.name)}</button>)}{templates(products).map(t=>{const Icon=t.icon;return <button type="button" key={t.id} className="chip-button" onClick={()=>setMessage(t.text)}><Icon size={14}/> {t.label}</button>;})}</div>
   <Field label="Votre message" id="promo-text" hint={`${size.length} caractères · ${size.parts} SMS par client${size.gsm?'':' (emoji ou caractère spécial : SMS plus courts)'} · Les accents rares (î, ê, ç) sont simplifiés pour tenir en un SMS.`}><textarea id="promo-text" className="resize-none" rows={4} maxLength={420} value={message} onChange={e=>setMessage(plain(e.target.value))} placeholder="Ex. Ce week-end, la 2e pizza est offerte sur la Reine !"/></Field>
   <div className="sms-preview" aria-label="Aperçu du SMS"><span className="sms-sender">DolcePizz</span><p>{full}</p></div>
   {recent&&<p className="small field-error">Un SMS est parti il y a moins de 3 jours : espacez vos envois pour ne pas lasser vos clients.</p>}
   <ErrorBox message={error}/>
   {running?<div className="promo-progress" role="status"><div className="inline-between"><span>Envoi en cours… {running.sent+running.failed} / {running.total}</span><Button tone="quiet" onClick={()=>{stop.current=true;}}>Mettre en pause</Button></div><div className="progress-track"><span style={{width:`${running.total?(running.sent+running.failed)/running.total*100:0}%`}}/></div></div>
   :<Button disabled={message.trim().length<10||!audience.subscribers||sms==='off'||!!pending} onClick={()=>setConfirm(true)}><Send size={16}/> Envoyer à {audience.subscribers} client{audience.subscribers>1?'s':''}</Button>}
   {!audience.subscribers&&<p className="small muted">Aucun client n’a encore accepté les SMS. L’accord se donne à l’inscription, au moment de commander ou dans « Mon compte ».</p>}
  </section>
  <section className="panel"><h2>Envois précédents</h2>{history.loading?<p className="small muted">Chargement…</p>:!history.data?.campaigns.length?<p className="small muted">Aucun envoi pour le moment.</p>:<ul className="campaign-list">{history.data.campaigns.map(c=><li key={c.id}><div className="inline-between"><strong>{new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(c.created_at))}</strong><span className={`status ${c.status==='done'?'status-completed':'status-pending'}`}>{c.status==='done'?(c.simulated?'Simulé':'Envoyé'):'Interrompu'}</span></div><p className="small">{c.message.split('\n')[0]}</p><p className="small muted">{c.sent} / {c.total} SMS{c.failed?` · ${c.failed} en échec`:''}</p>{c.status==='sending'&&!running&&<Button tone="outline" onClick={()=>void run(c)}><RotateCcw size={15}/> Reprendre l’envoi</Button>}</li>)}</ul>}</section>
  <Modal open={confirm} onOpenChange={setConfirm} title={`Envoyer à ${audience.subscribers} client${audience.subscribers>1?'s':''} ?`} description={`${size.parts*audience.subscribers} SMS au total${sms==='demo'?' (simulés)':''}. Un SMS envoyé ne peut pas être rappelé.`}><div className="sms-preview"><span className="sms-sender">DolcePizz</span><p>{full}</p></div><div className="inline-between"><Button tone="quiet" onClick={()=>setConfirm(false)}>Revoir le message</Button><Button onClick={()=>void send()}><Send size={16}/> Envoyer</Button></div></Modal>
 </div>;
}
