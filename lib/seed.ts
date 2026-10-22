// The opening menu, as first written to the database. After that, the database is the only source:
// the team adds, edits and removes pizzas from the admin. The browser also shows it while the live menu loads.
import {catalog,taglines,type Product} from './catalog';
import {seedRecipes,seedProductAllergens} from './menu';
import {pizzaPhotos} from './pizza-photos';

export const seedCatalog:Product[]=catalog.map((p,sort)=>({
 ...p,options:p.options||[],offer:false,ingredients:seedRecipes[p.id]||[],allergens:seedProductAllergens[p.id]||[],allergensChecked:false,
 tagline:taglines[p.id]||'',photo:pizzaPhotos.has(p.id)?'static':'',status:'published',spicy:p.id==='cannibale',sort,version:1,
}));
