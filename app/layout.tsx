import type {Metadata} from 'next';
import './globals.css';
import './dolce.css';
import {Providers,Header,Footer} from './components';
export const metadata:Metadata={title:{default:'Dolce Pizz’ — Votre soirée pizza à Ronchin',template:'%s · Dolce Pizz’'},description:'Découvrez la carte Dolce Pizz’ à Ronchin : pizzas Senior 31 cm et XXL 40 cm, desserts et boissons. Commandez à emporter, réglez sur place.',robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="fr"><body><Providers><Header/>{children}<Footer/></Providers></body></html>;}
