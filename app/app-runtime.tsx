'use client';

import {usePathname,useSearchParams} from 'next/navigation';
import {Providers} from './components';

const INTERNAL_PREFIXES=['/interne','/equipe','/production','/cuisine','/borne','/admin'];
const isInternal=(pathname:string,returnTo:string)=>INTERNAL_PREFIXES.some(prefix=>pathname===prefix||pathname.startsWith(`${prefix}/`))||INTERNAL_PREFIXES.some(prefix=>returnTo===prefix||returnTo.startsWith(`${prefix}/`));

/**
 * The operations console has no dependency on the public storefront runtime.
 * Public routes keep the cart/catalog provider; internal routes mount only the
 * screens and their authenticated API calls. The kiosk opts into Providers
 * locally because it owns its own cart.
 */
export function AppRuntime({children}:{children:React.ReactNode}){
 const pathname=usePathname();
 const search=useSearchParams();
 const returnTo=search.get('retour')||'';
 const internal=!!pathname&&isInternal(pathname,returnTo);
 return internal? <>{children}</> : <Providers>{children}</Providers>;
}
