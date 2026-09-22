export type Product = {id:string; name:string; category:string; description:string; price:number; xxl:number|null; available:boolean; options?:string[]};
export const categories = [
 {id:'tomate',name:'Base tomate',eyebrow:'Les incontournables',image:'/assets/tomate.png',position:'50% 76%',color:'red'},
 {id:'creme',name:'Crème fraîche',eyebrow:'Douces & généreuses',image:'/assets/creme.png',position:'50% 75%',color:'gold'},
 {id:'speciales',name:'Les spéciales',eyebrow:'Le caractère Dolce',image:'/assets/speciales.png',position:'50% 30%',color:'red'},
 {id:'italian',name:'Italian touch',eyebrow:'Un air d’Italie',image:'/assets/italian.png',position:'50% 47%',color:'red'},
 {id:'kids',name:'Menu kids',eyebrow:'Pour les petits',image:'/assets/speciales.png',position:'50% 80%',color:'gold'},
 {id:'desserts',name:'Desserts',eyebrow:'La touche sucrée',image:'/assets/desserts.png',position:'50% 20%',color:'red'},
 {id:'boissons',name:'Boissons',eyebrow:'Bien au frais',image:'/assets/desserts.png',position:'50% 72%',color:'red'},
];
const pizza=(id:string,name:string,category:string,description:string,options?:string[]):Product=>({id,name,category,description,price:1700,xxl:2200,available:true,options});
export const catalog:Product[]=[
 pizza('margarita','Margarita','tomate','Sauce tomate, mozzarella, olives noires.'),
 pizza('4-fromages','4 Fromages','tomate','Sauce tomate, mozzarella, chèvre, bleu, emmental.'),
 pizza('thon','Thon Provençale','tomate','Sauce tomate, mozzarella, oignons rouges, tomates cerises, olives noires, thon.'),
 pizza('orientale','Orientale','tomate','Sauce tomate, mozzarella, merguez, poivrons, olives noires, œuf.'),
 pizza('chorizo','Chorizo','tomate','Sauce tomate, mozzarella, jambon de dinde, chorizo, poivrons, œuf.'),
 pizza('reine','Reine','tomate','Sauce tomate, mozzarella, champignons, jambon de dinde.'),
 pizza('vegetarienne','Végétarienne','tomate','Sauce tomate, mozzarella, oignons rouges, tomates cerises, olives noires, poivrons.'),
 pizza('bolognaise','Bolognaise','tomate','Sauce tomate, mozzarella, bœuf haché, poivrons, oignons rouges.'),
 pizza('royale','Royale','tomate','Sauce tomate, mozzarella, bœuf haché, œuf, merguez.'),
 pizza('chevre-miel','Chèvre Miel','creme','Crème fraîche, mozzarella, chèvre, miel.'),
 pizza('boursin','Boursin','creme','Crème fraîche, mozzarella, poulet, champignons, Boursin.'),
 pizza('chicken','Chicken','creme','Crème fraîche, mozzarella, poulet, pomme de terre, olives, oignons.'),
 pizza('saumon','Saumon','creme','Crème fraîche, mozzarella, saumon fumé, pomme de terre, oignons.'),
 pizza('paysanne','Paysanne','creme','Crème fraîche, mozzarella, jambon, pomme de terre, olives, oignons.'),
 pizza('savoyarde','Savoyarde','creme','Crème fraîche, mozzarella, lardons fumés, pomme de terre, raclette.'),
 pizza('forestiere','Forestière','creme','Crème fraîche, mozzarella, lardons fumés, jambon, champignons, origan.'),
 pizza('boisee','Boisée','creme','Crème fraîche, mozzarella, poulet, poivrons, olives, sauce gruyère, pomme de terre.'),
 pizza('indienne','Indienne','creme','Crème fraîche, mozzarella, poulet, champignons, sauce curry.'),
 pizza('cannibale','Cannibale','speciales','Sauce tomate, mozzarella, poulet, merguez, bœuf haché, poivrons, sauce barbecue.'),
 pizza('cream-beef','Cream Beef','speciales','Crème fraîche, mozzarella, bœuf haché, pomme de terre, oignons, chèvre.'),
 pizza('salsa','Salsa','speciales','Crème fraîche, mozzarella, poulet, merguez, poivrons, oignons, sauce algérienne.'),
 pizza('thai','Thaï','speciales','Crème fraîche, mozzarella, poulet, poivrons, olives, sauce thaï.'),
 pizza('calzone','Calzone','italian','Sauce tomate, mozzarella, poulet ou viande hachée ou jambon de dinde au choix.',['Poulet','Viande hachée','Jambon de dinde']),
 pizza('pesto','La Pesto','italian','Sauce tomate, mozzarella, poulet, sauce pesto maison.'),
 pizza('tartuffo','Tartuffo','italian','Crème truffée, mozzarella, jambon de dinde, roquette, parmesan.'),
 pizza('pimiento','La Pimiento','italian','Sauce tomate, mozzarella, poulet, olive, sauce TN.'),
 pizza('napoli','Napoli','italian','Sauce tomate, mozzarella, anchois.'),
 pizza('fromagesque','La Fromagesque','italian','Crème fraîche, mozzarella, emmental, raclette, sauce gruyère.'),
 pizza('diavulo','Diavulo','italian','Sauce tomate, mozzarella, merguez, chorizo, poivrons, parmesan.'),
 {id:'kids',name:'Menu Kids',category:'kids',description:'Pizza reine (jambon) en forme de lapin + Capri-Sun + une surprise.',price:600,xxl:null,available:true},
 ...[
 ['daim','Tarte aux Daim','Une part de tarte aux Daim.',250],['tiramisu','Tiramisu','Un dessert au café.',250],['ben-jerrys','Ben & Jerry’s','Pot de glace. Parfum selon disponibilité.',250],['haagen-dazs','Häagen-Dazs','Pot de glace. Parfum selon disponibilité.',250],['mars','Barre glacée','Barre glacée Mars.',150]
 ].map(([id,name,description,price])=>({id,name,description,price,category:'desserts',xxl:null,available:true} as Product)),
 ...[
 ['canette','Canette 33 cl','Coca-Cola. Autres références selon disponibilité.',150],['cristaline','Cristaline 50 cl','Eau plate.',80],['caprisun','Capri-Sun 200 ml','Boisson aux fruits.',50],['coca','Coca-Cola 1,5 L','Bouteille à partager.',250],['oasis','Oasis 2 L','Bouteille à partager.',300]
 ].map(([id,name,description,price])=>({id,name,description,price,category:'boissons',xxl:null,available:true} as Product))
];
export const money=(c:number)=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:c%100===0?0:2}).format(c/100);
export const statuses:Record<string,string>={pending:'À confirmer',confirmed:'Confirmée',preparing:'En préparation',ready:'Prête à retirer',completed:'Retirée et payée',rejected:'Refusée',cancelled:'Annulée'};
export const days=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
