'use client';

import {usePathname,useSearchParams} from 'next/navigation';
import {Header,Footer} from './components';

const INTERNAL_PREFIXES=['/interne','/equipe','/production','/cuisine','/borne','/admin'];
const isInternal=(pathname:string,returnTo:string)=>INTERNAL_PREFIXES.some(prefix=>pathname===prefix||pathname.startsWith(`${prefix}/`))||INTERNAL_PREFIXES.some(prefix=>returnTo===prefix||returnTo.startsWith(`${prefix}/`));

/** Keeps the restaurant console separate from the public Dolce Pizz’ storefront. */
export function InternalChrome({children}:{children:React.ReactNode}){
 const pathname=usePathname();
 const search=useSearchParams();
 const internal=pathname?isInternal(pathname,search.get('retour')||''):false;
 return <>{!internal&&<Header/>}{children}{!internal&&<Footer/>}</>;
}
