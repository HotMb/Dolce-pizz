# Déploiement interne prioritaire

Le site client public est volontairement mis en attente. Le premier objectif est de faire fonctionner le service dans la pizzeria sur un réseau local : prise de commande, Make Line, Four, Expeditor et encaissement au retrait.

## Principe

Un ordinateur ou mini-PC sert de serveur local. Les tablettes et bornes sont connectées au même Wi-Fi privé et ouvrent la même adresse locale. Les commandes sont donc partagées par le serveur et ne dépendent pas du site public.

## Installation sur place

1. Installer Node.js 24.5 ou plus récent sur le serveur local.
2. Ouvrir le dépôt et lancer `npm install`.
3. Initialiser la base locale avec `npm run db:migrate:local`.
4. Démarrer le mode réseau interne avec `npm run dev:interne`.
5. Relever l’adresse IPv4 du serveur (par exemple `192.168.1.50`).
6. Sur chaque tablette du même Wi-Fi, ouvrir `http://192.168.1.50:5173/interne`.
7. Se connecter avec le compte équipe, choisir l’établissement Ronchin et ouvrir le poste correspondant.

Ne pas ouvrir le port du serveur sur Internet et ne pas configurer de redirection de port sur la box. Le Wi-Fi des appareils de production doit être séparé du Wi-Fi invité.

## Répartition des écrans

- POS employé : prise de commande comptoir ou téléphone.
- Make Line : montage et préparation manuelle.
- Four : cuisson et minuterie.
- Expeditor : contrôle de la commande complète et passage à « prête ».
- Caisse : paiement espèces ou carte au retrait.
- Borne : commande autonome ; à utiliser après validation du parcours employé.

Le flux standard ne dépend pas d’Expeditor : la validation du Make Line fait passer l’article au Four, puis le Four peut cliquer « Marquer prête · SMS + ticket » lorsque les préparations requises sont terminées. Expeditor reste un poste facultatif pour les commandes complexes ou lorsqu’un responsable veut contrôler l’assemblage complet.

Quand le Four marque la commande prête, le serveur crée une notification SMS si un numéro autorisé existe et crée un job `ready_ticket` dans la file d’impression. Le relais imprimante enrôlé récupère cette file et imprime automatiquement. Uber Eats et les commandes sans numéro restent sans SMS.

Dans `/equipe`, le propriétaire enrôle chaque appareil et donne un jeton limité à son rôle. Le jeton ne doit pas être photographié ni partagé entre établissements.

## Test de réception avant le service

1. Créer une commande test depuis le POS avec une pizza, une boisson et un numéro de téléphone fictif.
2. Vérifier son apparition dans Make Line.
3. Valider la préparation, puis vérifier le passage dans Four.
4. Valider l’enfournement et la cuisson.
5. Vérifier dans Expeditor que tous les articles sont présents.
6. Marquer la commande prête.
7. Ouvrir Caisse, retrouver la commande et l’encaisser en espèces puis refaire un test par carte.
8. Vérifier le ticket dans la supervision impression.

Le SMS, l’imprimante physique, le TPE et Uber Eats restent des intégrations à configurer avec leurs identifiants réels. Leur absence ne doit pas empêcher le flux interne de fonctionner.

## Accès depuis le domicile

Ne publiez pas directement le port `5173` et ne faites pas de redirection de port sur la box. Pour consulter l’activité depuis chez vous, installez un VPN privé comme Tailscale sur le serveur de la pizzeria et sur votre ordinateur personnel, puis autorisez uniquement votre compte dans une règle d’accès en lecture seule. Une autre option est un tunnel Cloudflare Access avec MFA ; il doit protéger `/equipe`, `/equipe/sante`, `/equipe/impression`, `/equipe/notifications` et `/equipe/audit`.

L’accès distant doit permettre de consulter les journaux et l’état des files, mais pas d’utiliser un jeton de tablette, d’encaisser une commande ou de modifier la production sans rôle responsable. Les postes de cuisine restent sur le Wi-Fi privé local.
