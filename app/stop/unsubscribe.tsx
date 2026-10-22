'use client';
/* eslint-disable @next/next/no-html-link-for-pages */
import {useState} from 'react';
import {BellOff,Check} from 'lucide-react';
import {api,Button,ErrorBox,Field} from '../components';
// The STOP link of every promotional SMS: one field, no sign-in, same answer whether or not the number is known.
export function Unsubscribe(){
 const[phone,setPhone]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState('');
 const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{await api('marketing/stop','POST',{phone});setDone(true);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <main id="contenu" className="page-shell"><div className="panel auth-panel">{done?<><Check size={43}/><h1>C’EST NOTÉ.</h1><p>Ce numéro ne recevra plus nos SMS promotionnels. Vous recevrez toujours les codes de connexion que vous demandez.</p><a className="btn btn-outline" href="/">Retour à la carte</a></>:<form noValidate onSubmit={submit}><BellOff size={43}/><h1>NE PLUS RECEVOIR NOS SMS.</h1><p>Indiquez le numéro qui reçoit nos promotions : il sera retiré de la liste immédiatement, sans frais.</p><ErrorBox message={error}/><Field label="Numéro de mobile" id="stop-phone"><input id="stop-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="06 12 34 56 78" value={phone} onChange={e=>setPhone(e.target.value)}/></Field><Button type="submit" busy={busy}>Me désinscrire</Button><p className="auth-note">Vous pouvez aussi gérer ce choix dans <a href="/compte"><u>Mon compte</u></a>.</p></form>}</div></main>;
}
