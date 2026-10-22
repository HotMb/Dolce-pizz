import type {Metadata} from 'next';
import {Unsubscribe} from './unsubscribe';
export const metadata:Metadata={title:'Ne plus recevoir nos SMS'};
export default function Page(){return <Unsubscribe/>;}
