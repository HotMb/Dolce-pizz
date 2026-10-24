import type {Metadata} from 'next';
import {KioskPage} from './kiosk';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Borne client · Dolce Pizz’',robots:{index:false,follow:false}};
export default function Page(){return <KioskPage/>;}
