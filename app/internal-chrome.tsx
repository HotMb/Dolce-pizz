'use client';

import {usePathname} from 'next/navigation';
import {Header,Footer} from './components';

const INTERNAL_PREFIXES=['/interne','/equipe','/production','/cuisine','/borne','/admin'];
const isInternal=(pathname:string)=>INTERNAL_PREFIXES.some(prefix=>pathname===prefix||pathname.startsWith(`${prefix}/`));

/** Keeps the restaurant console separate from the public Dolce Pizz’ storefront. */
export function InternalChrome({children}:{children:React.ReactNode}){
 const pathname=usePathname();
 const internal=pathname?isInternal(pathname):false;
 return <>{!internal&&<Header/>}{children}{!internal&&<Footer/>}</>;
}
