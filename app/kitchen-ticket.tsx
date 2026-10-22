'use client';
import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {money,sizeLabel} from '@/lib/catalog';
import type {Order} from './components';
const time=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'});
const day=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',weekday:'long',day:'numeric',month:'long'});
export const slotTime=(iso:string)=>time.format(new Date(iso));
export const orderNumber=(o:Order)=>`#${o.id.slice(0,6).toUpperCase()}`;
// Browsers only play sound after a tap, so each screen unlocks it once with a button.
let audio:AudioContext|null=null;
export function chime(){if(!audio)return;[988,988,1319].forEach((hz,i)=>{const at=audio!.currentTime+i*.28,o=audio!.createOscillator(),g=audio!.createGain();o.type='square';o.frequency.value=hz;g.gain.setValueAtTime(.18,at);g.gain.exponentialRampToValueAtTime(.001,at+.22);o.connect(g).connect(audio!.destination);o.start(at);o.stop(at+.24);});}
export function enableSound(){audio??=new AudioContext();void audio.resume();chime();}
// Customer changes are printed in capitals: an allergy must never be missed in the rush.
const Mods=({without,extra}:{without?:string[];extra?:string[]})=><>{!!without?.length&&<span className="ticket-without">SANS {without.join(', ').toLocaleUpperCase('fr')}</span>}{!!extra?.length&&<span className="ticket-extra">+ {extra.join(', ').toLocaleUpperCase('fr')}</span>}</>;
export function TicketLines({order}:{order:Order}){return <ul className="ticket-lines">{order.items.map((i,n)=><li key={n}><b>{i.quantity} × {i.name}</b><small>{sizeLabel(i.size)}{i.option&&` · ${i.option}`}{i.ticket&&' · 1 offerte (ticket fidélité)'}</small><Mods without={i.without} extra={i.extra}/>{i.free&&<span className="free-line">+ {i.quantity} × {i.free.name}{i.free.option&&` · ${i.free.option}`} · OFFERTE</span>}{i.free&&<Mods without={i.free.without} extra={i.free.extra}/>}</li>)}</ul>;}
function PrintTicket({order:o}:{order:Order}){return <article className="kitchen-print"><p className="kp-brand">DOLCE PIZZ’ · CUISINE</p><p className="kp-number">{orderNumber(o)}</p><p className="kp-slot">RETRAIT {slotTime(o.slot)}</p><p>{day.format(new Date(o.slot))}</p><p>{o.name} · {o.phone}</p><hr/><TicketLines order={o}/>{o.note&&<p className="kp-note">NOTE : {o.note}</p>}<hr/><p className="kp-total">À encaisser : {money(o.total)}</p></article>;}
// Prints one kitchen ticket (80 mm receipt layout) instead of the whole page.
export function usePrintTicket(){
 // A counter lets the same ticket be printed again even if the tablet never fires "afterprint".
 const[job,setJob]=useState<{order:Order;n:number}|null>(null);
 useEffect(()=>{if(!job)return;document.body.classList.add('print-one');const done=()=>setJob(null);window.addEventListener('afterprint',done);const t=window.setTimeout(()=>window.print(),60);return()=>{window.clearTimeout(t);window.removeEventListener('afterprint',done);document.body.classList.remove('print-one');};},[job]);
 return {print:(order:Order)=>setJob(j=>({order,n:(j?.n||0)+1})),area:job?createPortal(<div className="print-area"><PrintTicket order={job.order}/></div>,document.body):null};
}
