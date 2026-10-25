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
7. Lancer ensuite le raccourci correspondant au matériel. Chaque raccourci ouvre un écran fixe ; l’opérateur ne change pas de poste depuis l’interface.

### Raccourcis des postes

Depuis le dossier du dépôt, utiliser les fichiers suivants :

| Ordinateur ou tablette | Fichier à lancer | Écran ouvert |
| --- | --- | --- |
| Poste de préparation | `lancer-make-line.cmd` | Make Line / Montage |
| Poste devant le four | `lancer-four.cmd` | Four / Cuisson |
| Poste de prise de commande | `lancer-pos.cmd` | POS employé |
| Borne client | `lancer-borne.cmd` | Borne |
| Poste de paiement au retrait | `lancer-caisse.cmd` | Caisse |

`lancer-interne.cmd` ne doit être lancé qu’une seule fois sur le serveur local. Les autres fichiers ouvrent seulement le navigateur et se connectent au même serveur ; ils ne démarrent pas une base séparée. Si le serveur n’est pas encore démarré, un raccourci propose de le lancer automatiquement.

Sur le serveur lui-même, les raccourcis utilisent `localhost`. Sur une autre tablette, ils doivent utiliser l’adresse IP du serveur, par exemple `http://192.168.1.50:5173`, ou être remplacés par des favoris contenant cette adresse.

Ne pas ouvrir le port du serveur sur Internet et ne pas configurer de redirection de port sur la box. Le Wi-Fi des appareils de production doit être séparé du Wi-Fi invité.

## Répartition des écrans

- POS employé : prise de commande comptoir ou téléphone.
- Make Line : montage et préparation manuelle.
- Four : cuisson et minuterie.
- Expeditor : rôle facultatif non affiché dans les postes fixes du pilote ; le Four contrôle la complétude et passe directement la commande à « prête ».
- Caisse : paiement espèces ou carte au retrait.
- Borne : commande autonome ; à utiliser après validation du parcours employé.

Le flux standard est volontairement court : la validation du Make Line fait passer l’article au Four, puis le Four peut cliquer « Marquer prête · SMS + ticket » lorsque les préparations requises sont terminées. Le passage au Four est enregistré par le serveur et la carte du ticket est visible sur le poste Four sans recharger manuellement l’autre écran.

Quand le Four marque la commande prête, le serveur crée une notification SMS si un numéro autorisé existe et crée un job `ready_ticket` dans la file d’impression. Le relais imprimante enrôlé récupère cette file et imprime automatiquement. Uber Eats et les commandes sans numéro restent sans SMS.

Dans `/equipe`, le propriétaire enrôle chaque appareil et donne un jeton limité à son rôle. Le jeton ne doit pas être photographié ni partagé entre établissements.

## Test de réception avant le service

1. Créer une commande test depuis le POS avec une pizza, une boisson et un numéro de téléphone fictif.
2. Vérifier son apparition dans Make Line.
3. Valider la préparation, puis vérifier le passage dans Four.
4. Valider l’enfournement et la cuisson.
5. Vérifier que la carte passe au vert sur le poste Four.
6. Marquer la commande prête depuis Four.
7. Ouvrir Caisse, retrouver la commande et tester le paiement sur une commande de test temporaire.
8. Vérifier le ticket dans la supervision impression.

Le SMS, l’imprimante physique, le TPE et Uber Eats restent des intégrations à configurer avec leurs identifiants réels. Leur absence ne doit pas empêcher le flux interne de fonctionner.

## Accès depuis le domicile

Ne publiez pas directement le port `5173` et ne faites pas de redirection de port sur la box. Pour consulter l’activité depuis chez vous, installez un VPN privé comme Tailscale sur le serveur de la pizzeria et sur votre ordinateur personnel, puis autorisez uniquement votre compte dans une règle d’accès en lecture seule. Une autre option est un tunnel Cloudflare Access avec MFA ; il doit protéger `/equipe`, `/equipe/sante`, `/equipe/impression`, `/equipe/notifications` et `/equipe/audit`.

L’accès distant doit permettre de consulter les journaux et l’état des files, mais pas d’utiliser un jeton de tablette, d’encaisser une commande ou de modifier la production sans rôle responsable. Les postes de cuisine restent sur le Wi-Fi privé local.
