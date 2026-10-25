'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from '../components';

export type StaffStation='make_line'|'oven'|'expeditor';
export type StaffScope={organizationId:string;organizationName:string;locationId:string;locationName:string;roles:string[];stations:StaffStation[];writeStations:StaffStation[];canMarkReady:boolean;canManageStaff:boolean};
export type StaffAccess={account:{id:string;name:string};scopes:StaffScope[];roles:{id:string;label:string}[]};
const stations=['make_line','oven','expeditor'];

function parseAccess(value:unknown):StaffAccess{
 const data=value as StaffAccess|undefined;
 if(!data||typeof data.account?.id!=='string'||!Array.isArray(data.scopes)||!Array.isArray(data.roles))throw new Error('Les droits de ce compte ne sont pas disponibles. Réessayez.');
 for(const scope of data.scopes){
  if(typeof scope.organizationId!=='string'||typeof scope.locationId!=='string'||typeof scope.organizationName!=='string'||typeof scope.locationName!=='string'||!Array.isArray(scope.roles)||!Array.isArray(scope.stations)||!Array.isArray(scope.writeStations)||!scope.stations.every(station=>stations.includes(station))||!scope.writeStations.every(station=>scope.stations.includes(station))||typeof scope.canMarkReady!=='boolean'||typeof scope.canManageStaff!=='boolean')throw new Error('Les droits reçus sont incomplets. Réessayez.');
 }
 if(!data.roles.every(role=>typeof role.id==='string'&&typeof role.label==='string'))throw new Error('La liste des rôles est indisponible. Réessayez.');
 return data;
}

export function scopeQuery(scope:Pick<StaffScope,'organizationId'|'locationId'>){return new URLSearchParams({organizationId:scope.organizationId,locationId:scope.locationId}).toString();}
export function productionHref(scope:StaffScope,station:StaffStation){return `/production?${scopeQuery(scope)}&station=${station}`;}

/** Capabilities are revalidated, never stored in the browser as an authority. */
export function useStaffAccess(enabled=true){
 const[data,setData]=useState<StaffAccess|null>(null),[loading,setLoading]=useState(enabled),[error,setError]=useState(''),[status,setStatus]=useState<number|null>(null),[refreshing,setRefreshing]=useState(false);
 const controller=useRef<AbortController|null>(null),serial=useRef(0);
 const refresh=useCallback(async()=>{
  if(!enabled){setLoading(false);setRefreshing(false);return;}
  controller.current?.abort();
  const request=new AbortController(),id=++serial.current;controller.current=request;setRefreshing(true);
  try{const result=parseAccess(await api<unknown>('staff','GET',undefined,request.signal));if(id===serial.current&&!request.signal.aborted){setData(result);setError('');setStatus(null);}}
  catch(cause){if(id===serial.current&&!request.signal.aborted){const fault=cause as {message?:string;status?:number};setError(fault.message||'Impossible de vérifier vos accès. Réessayez.');setStatus(fault.status||null);if(fault.status===401||fault.status===403)setData(null);}}
  finally{if(id===serial.current&&!request.signal.aborted){setLoading(false);setRefreshing(false);controller.current=null;}}
 },[enabled]);
 useEffect(()=>{
  if(!enabled){setLoading(false);setRefreshing(false);return;}
  const first=window.setTimeout(()=>void refresh(),0);
  const poll=window.setInterval(()=>{if(!document.hidden&&navigator.onLine)void refresh();},30000);
  const visible=()=>{if(!document.hidden&&navigator.onLine)void refresh();};
  const offline=()=>{controller.current?.abort();controller.current=null;setRefreshing(false);setLoading(false);setError('Connexion interrompue. Les accès doivent être vérifiés avant toute modification.');setStatus(null);};
  document.addEventListener('visibilitychange',visible);window.addEventListener('online',visible);window.addEventListener('offline',offline);
  return()=>{window.clearTimeout(first);window.clearInterval(poll);controller.current?.abort();document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',visible);window.removeEventListener('offline',offline);};
 },[enabled,refresh]);
 return {data,loading,error,status,refreshing,refresh};
}
