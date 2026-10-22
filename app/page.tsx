import {Storefront} from './storefront';
// What search engines show for the restaurant (Google "local business" card).
const restaurant={'@context':'https://schema.org','@type':'Restaurant',name:'Dolce Pizz’',servesCuisine:['Pizza','Cuisine italienne'],telephone:'+33 3 20 40 09 01',priceRange:'€',address:{'@type':'PostalAddress',streetAddress:'191 avenue Jean-Jaurès',postalCode:'59790',addressLocality:'Ronchin',addressCountry:'FR'},acceptsReservations:false};
export default function Page(){return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(restaurant)}}/><Storefront/></>;}
