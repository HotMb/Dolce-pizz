# Offre produit — plateforme de restauration multi-sites

## La promesse

Un seul système reçoit les commandes du site, du comptoir, du téléphone, des bornes et des plateformes partenaires; il applique un menu et des règles cohérents, puis suit la préparation jusqu’à la remise au client. Le gérant voit son établissement. Le réseau consulte une vue consolidée sans accéder aux données d’un autre tenant.

Le nom commercial du produit reste à choisir. Dolce Pizz’ sert de premier site pilote; l’architecture ne doit pas figer le produit sur cette enseigne.

## Modules que le produit vise à vendre

| Module | Bénéfice pour le restaurant | État du dépôt aujourd’hui |
|---|---|---|
| Commande web à emporter | Menu, personnalisation, créneau, suivi et fidélité | Prototype présent pour Ronchin |
| POS comptoir et mobile | Saisie de commandes, encaissement, remise et clôture | À construire; la démo permet à l’équipe de valider les commandes web |
| Centre d’appels | Commande assistée, code postal de suggestion, choix explicite du site de retrait, créneau, historique d’appel tenant-scopé et envoi en production | Les zones postales doivent être provisionnées par enseigne |
| Bornes | Commande autonome avec le menu publié du site | À construire |
| KDS Make Line / Four / Expeditor | Routage par article, avancement de cuisson, regroupement et contrôle de complétude | KDS persisté avec comptes nominatifs et permissions par organisation/site/poste; Ronchin configuré, exploitation commerciale et appareils à finaliser |
| Menu et recettes | Publication contrôlée des prix, disponibilité, suppléments et allergènes | Administration de carte, ingrédients et origines déjà dans la démo; versions par site à faire |
| SMS de service et fidélité | Informer le client, attribuer des points, gérer les préférences marketing | Fidélité et campagnes présentes; outbox et consommateur transactionnel livrés, fournisseur/ordonnanceur et essais de délivrance à configurer |
| Uber Eats | Recevoir les commandes Uber dans le même flux de préparation; Uber gère son propre transport | À construire; l’accès partenaire et le rattachement de chaque restaurant sont à configurer. Pas de livraison maison au pilote |
| Tableau de bord réseau | Comparer les sites, gérer menus maîtres, permissions et performance | Fondation organisation/site ajoutée; back-office réseau à construire |
| Caisse et rapports | Encaissements, moyens de paiement, shifts, clôture et écarts | Prototype livré; vendre comme module pilote avec terminal et conformité à finaliser |

## Comment les équipes l’utilisent

1. Le centre d’appels confirme le besoin et l’adresse, puis propose le site de retrait selon une zone postale configurée et sa capacité. Le client vient chercher la commande; aucune livraison maison n’est proposée. Le site web lui demande de choisir explicitement son restaurant.
2. Le canal valide le menu, les prix, les allergènes, les disponibilités et le créneau auprès du service central.
3. L’Expeditor ou le responsable accepte la commande; l’ordre part vers les tâches des postes concernés.
4. Make Line monte les pizzas et vérifie les personnalisations. Le Four confirme l’enfournement et suit la durée. Les boissons et desserts avancent sur leur poste.
5. L’Expeditor voit toute la commande. Il vérifie que chaque partie est prête avant de signaler « prête ».
6. La tranche actuelle crée une entrée SMS durable pour les commandes directes avec mobile confirmé. Le consommateur serveur peut l’envoyer via Brevo après configuration du fournisseur et de son ordonnanceur. Il écarte les événements périmés et conserve les résultats incertains pour rapprochement manuel; Uber Eats garde ses propres notifications client.
7. Le client paie au retrait. Le prototype enregistre le paiement cash/carte saisi par l’opérateur, rattache la vente à un shift et contrôle la clôture; le terminal automatique et la conformité caisse restent à finaliser avant commercialisation générale.

## Installation chez un client

### Avant la visite

- Fiche de chaque site : nom, adresse vérifiée, téléphone, horaires, zone postale de suggestion de site pour le retrait téléphonique, capacité, prix, TVA et mode de retrait.
- Matériel et réseau : tablettes/écrans, supports, Wi-Fi métier isolé, imprimantes, TPE et éventuel mini-PC relais.
- Données du menu : recettes, options, allergènes, photos, disponibilités, prix par site et instructions de production.
- Fournisseurs et accès : SMS, TPE, agrégateurs, imprimantes et comptes de gestion.

### Mise en service

1. Créer l’organisation SaaS et ses établissements.
2. Charger le menu maître, vérifier chaque recette/allergène et publier une version de test.
3. Créer les comptes nominaux de l’équipe et limiter leurs permissions à leur rôle et à leurs sites.
4. Enrôler chaque appareil : POS, borne, Make Line, Four, Expeditor et imprimante. L’appareil affiche uniquement le poste qui lui est attribué.
5. Exécuter des commandes de test depuis chaque canal, vérifier le ticket, le statut, le SMS et la clôture.
6. Former l’équipe, activer le site, surveiller les commandes pendant le premier service et conserver un processus de secours papier.

Les écrans de cuisine peuvent être des tablettes fixes ou des écrans tactiles résistants. Une pizzeria à faible volume peut commencer avec un écran KDS unique utilisant plusieurs vues; séparer Make Line, Four et Expeditor en appareils dédiés ne se justifie que si le volume et l’aménagement de la cuisine le demandent. La borne et le POS de comptoir sont des postes distincts, avec un accès restreint.

## Offre et tarification à tester

Une commercialisation claire peut combiner un abonnement par établissement et des options : commande web, POS/KDS, multi-sites, bornes, connecteurs agrégateurs, fidélité/SMS, rapports avancés et relais hors ligne. Le matériel, l’installation et la formation sont chiffrés séparément. Les paiements carte restent facturés par le prestataire choisi.

Ce découpage est une hypothèse produit; il faudra le tester avec des restaurateurs avant de publier des prix ou de promettre des intégrations.

## Premier pilote Dolce Pizz’

- **Ronchin** : adresse et téléphone confirmés dans la démo, 191 avenue Jean-Jaurès, 59790 Ronchin, 03 20 40 09 01.
- **Tourcoing** : la page de démonstration publique ne montre que Ronchin et le dépôt ne contient pas l’adresse ni les zones de Tourcoing. Le lieu reste désactivé pour toute décision automatique tant que ses coordonnées et zones ne sont pas confirmées.
- **Commande directe** : web et téléphone à emporter seulement; le client paie au retrait selon la règle communiquée. Pas de livraison maison.
- **Uber Eats** : le connecteur doit être autorisé par le programme partenaire, associer chaque identifiant de magasin au bon site et gérer les webhooks signés et les délais d’acceptation du fournisseur.
- **Canaux** : le socle couvre déjà web, comptoir/téléphone, bornes, KDS, caisse de retrait, Uber Eats signé et SMS transactionnel en file; le POS mobile de salle, le fournisseur SMS réel, le TPE automatique et les adaptateurs matériels restent à livrer.

Il faut donc présenter le projet comme un prototype enrichi et une plateforme en construction, pas comme un POS franchise déjà opérationnel. La phase commerciale pilote doit démarrer avec les fonctions effectivement terminées, puis activer les modules après leurs tests et l’accord des fournisseurs.
