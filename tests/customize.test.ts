import assert from 'node:assert/strict';
import {test} from 'node:test';
import {seedCatalog} from '../lib/seed';
import {seedIngredients,allergensOf,describe,slugify,originsOf,composition} from '../lib/menu';
import {priceCart,MAX_EXTRAS,type CartLine,type Menu} from '../lib/pricing';

const products=seedCatalog.map(p=>p.id==='reine'?{...p,offer:true}:p.id==='margarita'?{...p,price:2000,xxl:2600}:p);
const menu:Menu={products,ingredients:seedIngredients,extraPrice:150};
const line=(changes:Partial<CartLine>={}):CartLine=>({id:'reine',size:'senior',option:'',quantity:1,...changes});

test('removing ingredients is free; each supplement costs the single supplement price',()=>{
 const r=priceCart([line({removed:['champignons'],added:['chorizo','oeuf']})],menu);
 assert.equal(r.problem,'');assert.equal(r.total,1700+2*150);assert.equal(r.extras,300);
 assert.deepEqual(r.lines[0].without,['Champignons']);assert.deepEqual(r.lines[0].extra,['Chorizo','Œuf']);
 assert.equal(priceCart([line({added:['chorizo'],quantity:3})],menu).total,3*(1700+150));
 assert.equal(priceCart([line({added:['chorizo']})],{...menu,extraPrice:200}).total,1900);
});
test('the dough cannot be removed, unknown or non-supplement ingredients cannot be added, 5 supplements maximum',()=>{
 for(const l of [line({removed:['pate']}),line({removed:['thon']}),line({added:['pate']}),line({added:['sauce-curry']}),line({added:['inconnu']}),line({removed:['champignons'],added:['champignons']}),line({added:['chorizo','chorizo']}),line({id:'canette',size:'unique',removed:['pate']})])assert.ok(priceCart([l],menu).problem,JSON.stringify(l));
 const six=['chorizo','oeuf','thon','miel','roquette','anchois'];assert.equal(six.length,MAX_EXTRAS+1);
 assert.ok(priceCart([line({added:six})],menu).problem);assert.equal(priceCart([line({added:six.slice(0,5)})],menu).problem,'');
});
test('an out-of-stock ingredient blocks the pizza until the customer removes it',()=>{
 const out={...menu,ingredients:seedIngredients.map(i=>i.id==='champignons'?{...i,available:false}:i)};
 assert.match(priceCart([line()],out).problem,/Champignons manque/);
 assert.equal(priceCart([line({removed:['champignons']})],out).problem,'');
 assert.ok(priceCart([line({id:'margarita',added:['champignons']})],out).problem);
});
test('second pizza offer: same size, the more expensive one is paid, supplements of both pizzas are paid',()=>{
 // Reine 17 € + Margarita 20 € in Senior: the customer pays 20 €, the 17 € pizza is free.
 const senior=priceCart([line({freeId:'margarita'})],menu);assert.equal(senior.total,2000);assert.equal(senior.offer,1700);
 // In XXL the free pizza is an XXL too: Reine 22 € + Margarita 26 €.
 const xxl=priceCart([line({size:'xxl',freeId:'margarita'})],menu);assert.equal(xxl.total,2600);assert.equal(xxl.offer,2200);
 const custom=priceCart([line({freeId:'margarita',added:['chorizo'],freeRemoved:['olives'],freeAdded:['oeuf']})],menu);
 assert.equal(custom.problem,'');assert.equal(custom.total,2000+300);assert.deepEqual(custom.lines[0].free?.without,['Olives noires']);assert.deepEqual(custom.lines[0].free?.extra,['Œuf']);
 assert.ok(priceCart([line({freeId:'margarita',freeRemoved:['pate']})],menu).problem);
});
test('the loyalty ticket never covers supplements',()=>{
 const r=priceCart([line({added:['chorizo']})],menu,true);assert.equal(r.ticketDiscount,1700);assert.equal(r.total,150);
});
test('allergens follow the customer’s changes, the garnish option and the product’s own list',()=>{
 const reine=products.find(p=>p.id==='reine')!,calzone=products.find(p=>p.id==='calzone')!,tiramisu=products.find(p=>p.id==='tiramisu')!;
 assert.deepEqual(allergensOf(reine,seedIngredients),['gluten','lait']);
 assert.deepEqual(allergensOf(reine,seedIngredients,['mozzarella'],['oeuf','thon']),['gluten','oeufs','poissons']);
 assert.deepEqual(allergensOf(tiramisu,seedIngredients),['gluten','oeufs','lait']);
 assert.ok(composition(calzone,seedIngredients,[],[],'Poulet').some(i=>i.id==='poulet'));
 const withOrigin=seedIngredients.map(i=>i.id==='poulet'?{...i,origin:'France'}:i);
 assert.deepEqual(originsOf(composition(calzone,withOrigin,[],[],'Poulet')),['Poulet : France']);
});
test('every opening recipe uses known ingredients; generated texts and ids are clean',()=>{
 const known=new Set(seedIngredients.map(i=>i.id));
 for(const p of seedCatalog)for(const id of p.ingredients||[])assert.ok(known.has(id),`${p.id}: ${id}`);
 assert.equal(describe(['pate','sauce-tomate','mozzarella','olives'],seedIngredients),'Sauce tomate, mozzarella, olives noires.');
 assert.equal(slugify('La Pêche Œuf & Crème'),'la-peche-oeuf-creme');
});
