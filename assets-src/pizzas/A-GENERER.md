# Photos de pizzas : ajout et remplacement

Chaque recette de la carte a sa photo : `assets-src/pizzas/<identifiant>.png` (ou `.jpg`, `.webp`).
Après tout ajout ou remplacement, lancez :

```
npm run photos
```

Le script centre la pizza, la détoure (fond transparent), crée les versions 320/640/1024 px dans
`public/assets/pizzas/` et met à jour `lib/pizza-photos.ts`. La pizza apparaît alors automatiquement
sur la roue d'accueil, dans la carte, dans la fiche produit, le panier et le suivi de commande.
`mettre-en-ligne-demo.cmd` lance aussi cette étape avant chaque mise en ligne.

## Style à respecter (identique aux 20 photos existantes)

Photographie culinaire réaliste, vue de dessus exactement à la verticale, pizza entière parfaitement
centrée et occupant environ 95 % d’une image carrée 1024 × 1024, fond noir mat uni, éclairage studio
doux, croûte napolitaine dorée et légèrement tachetée, fromage fondu. Aucun texte, aucune main, aucun
ustensile, aucune planche, aucun ingrédient autour de la pizza.

## Les 9 photos manquantes

Copiez une ligne dans votre outil de génération d’images, précédée du style ci-dessus.

| Fichier à créer | Recette à représenter |
|---|---|
| `cream-beef.png` | base crème fraîche, mozzarella, bœuf haché, pomme de terre, oignons, chèvre |
| `salsa.png` | base crème fraîche, mozzarella, poulet, merguez, poivrons, oignons, filet de sauce algérienne |
| `thai.png` | base crème fraîche, mozzarella, poulet, poivrons, olives, filet de sauce thaï |
| `calzone.png` | calzone entière pliée en demi-lune, pâte dorée, vue de dessus, centrée |
| `pesto.png` | sauce tomate, mozzarella, poulet, filet de sauce pesto maison |
| `pimiento.png` | sauce tomate, mozzarella, poulet, olives, filet de sauce TN (harissa) |
| `napoli.png` | sauce tomate, mozzarella, filets d’anchois |
| `fromagesque.png` | base crème fraîche, mozzarella, emmental, raclette, sauce gruyère |
| `diavulo.png` | sauce tomate, mozzarella, merguez, chorizo, poivrons, copeaux de parmesan |

Les visuels restent illustratifs : la carte le précise (« Visuels générés par IA, non contractuels »).
