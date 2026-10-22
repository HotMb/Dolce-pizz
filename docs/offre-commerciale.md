# Offre produit — plateforme de restauration multi-sites

## La promesse

Un seul système reçoit les commandes du site, du comptoir, du téléphone, des bornes et des plateformes partenaires; il applique un menu et des règles cohérents, puis suit la préparation jusqu’à la remise au client. Le gérant voit son établissement. Le réseau consulte une vue consolidée sans accéder aux données d’un autre tenant.

Le nom commercial du produit reste à choisir. Dolce Pizz’ sert de premier site pilote; l’architecture ne doit pas figer le produit sur cette enseigne.

## Modules que le produit vise à vendre

| Module | Bénéfice pour le restaurant | État du dépôt aujourd’hui |
|---|---|---|
| Commande web à emporter | Menu, personnalisation, créneau, suivi et fidélité | Prototype présent pour Ronchin |
| POS comptoir et mobile | Saisie de commandes, encaissement, remise et clôture | À construire; la démo permet à l’équipe de valider les commandes web |
| Centre d’appels | Recherche par téléphone, adresse, commande assistée et choix du site de livraison | À construire; routage postal pur et données d’organisation amorcés |
| Bornes | Commande autonome avec le menu publié du site | À construire |
| KDS Make Line / Four / Expeditor | Routage par article, avancement de cuisson, regroupement et contrôle de complétude | Écran cuisine simple existant et automate métier pur testé; écrans spécialisés et persistance restent à construire |
| Menu et recettes | Publication contrôlée des prix, disponibilité, suppléments et allergènes | Administration de carte, ingrédients et origines déjà dans la démo; versions par site à faire |
| SMS de service et fidélité | Informer le client, attribuer des points, gérer les préférences marketing | Fidélité et campagnes de démonstration présentes; SMS de commande prête à faire |
| Uber Eats et livraison propre | Recevoir et traiter les commandes externes dans le même flux de préparation | À construire; l’accès Uber partenaire et les zones de livraison restent à configurer |
| Tableau de bord réseau | Comparer les sites, gérer menus maîtres, permissions et performance | Fondation organisation/site ajoutée; back-office réseau à construire |
| Caisse et rapports | Encaissements, moyens de paiement, clôture, écarts et exports | Non implémentée; ne pas la vendre comme caisse conforme aujourd’hui |

## Comment les équipes l’utilisent

1. Le centre d’appels confirme le besoin et l’adresse. Pour une livraison, le système choisit un site admissible selon une zone configurée, puis vérifie sa capacité. Pour un retrait, le client choisit explicitement Ronchin ou Tourcoing.
2. Le canal valide le menu, les prix, les allergènes, les disponibilités et le créneau auprès du service central.
3. L’Expeditor ou le responsable accepte la commande; l’ordre part vers les tâches des postes concernés.
4. Make Line monte les pizzas et vérifie les personnalisations. Le Four confirme l’enfournement et suit la durée. Les boissons et desserts avancent sur leur poste.
5. L’Expeditor voit toute la commande. Il vérifie que chaque partie est prête avant de signaler « prête ».
6. Le système informe le client par SMS si la commande est directe, si un numéro est fourni et si l’envoi a été accepté. Uber Eats suit ses propres notifications client. Une commande sans numéro garde son ticket et son statut sur les écrans.
7. À la remise, le personnel rapproche la commande et le règlement au retrait. La caisse ne valide un paiement qu’après confirmation du terminal ou de l’employé autorisé.

## Installation chez un client

### Avant la visite

- Fiche de chaque site : nom, adresse vérifiée, téléphone, horaires, zone de livraison, capacité, prix, taxes et modes de retrait/livraison.
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
- **Commande directe** : le client paie au retrait selon la règle communiquée.
- **Uber Eats** : le connecteur doit être autorisé par le programme partenaire, associer chaque identifiant de magasin au bon site et gérer les webhooks signés et les délais d’acceptation du fournisseur.
- **Canaux** : le produit cible tous les canaux, mais les bornes, le téléphone, le POS complet, Uber, la caisse et les KDS spécialisés ne sont pas encore présents dans le dépôt.

Il faut donc présenter le projet comme un prototype enrichi et une plateforme en construction, pas comme un POS franchise déjà opérationnel. La phase commerciale pilote doit démarrer avec les fonctions effectivement terminées, puis activer les modules après leurs tests et l’accord des fournisseurs.
