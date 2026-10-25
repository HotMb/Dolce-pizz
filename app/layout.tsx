import type {Metadata} from 'next';
import '@fontsource/anton/400.css';
import '@fontsource/permanent-marker/400.css';
import './globals.css';
import './dolce.css';
import './photography.css';
import './experience.css';
import './features.css';
import './mobile.css';
import {AppRuntime} from './app-runtime';
import {InternalChrome} from './internal-chrome';
import antonUrl from '@fontsource/anton/files/anton-latin-400-normal.woff2?url';
import markerUrl from '@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff2?url';
export const metadata:Metadata={title:{default:'Dolce Pizz’ — Votre soirée pizza à Ronchin',template:'%s · Dolce Pizz’'},description:'Découvrez la carte Dolce Pizz’ à Ronchin : pizzas Senior 31 cm et XXL 40 cm, desserts et boissons. Commandez à emporter, réglez sur place.',openGraph:{type:'website',locale:'fr_FR',siteName:'Dolce Pizz’',title:'Dolce Pizz’ — Pizzeria artisanale à Ronchin',description:'Pizzas Senior et XXL à emporter, à personnaliser en ligne. Commandez, réglez sur place.',images:[{url:'/assets/hero.png'}]},robots:{index:false,follow:false},icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){
 // Both brand fonts start loading with the page: text is laid out once instead of again when each font arrives.
 return <html lang="fr"><head>{[antonUrl,markerUrl].map(href=><link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous"/>)}</head><body><AppRuntime><InternalChrome>{children}</InternalChrome></AppRuntime></body></html>;}
