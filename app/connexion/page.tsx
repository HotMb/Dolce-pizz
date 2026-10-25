import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {currentUser} from '@/lib/auth';
import {Login} from './login';
export const dynamic='force-dynamic';export const metadata:Metadata={title:'Connexion'};
const safeReturn=(value?:string)=>value&&value.startsWith('/')&&!value.startsWith('//')&&!value.startsWith('/\\')?value:'/compte';
const isInternal=(value:string)=>/^\/(?:equipe|admin|production|cuisine|borne|interne)(?:\/|$)/.test(value);
export default async function Page({searchParams}:{searchParams:Promise<{retour?:string}>}){const{retour}=await searchParams;const target=safeReturn(retour);const user=await currentUser();if(user?.name)redirect(target);return <Login retour={target} start={isInternal(target)?'staff-key':user?'name':'phone'}/>;}
