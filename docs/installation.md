# Installation et exploitation — Dolce Pizz’

Ce guide couvre l’installation du prototype existant et l’installation cible des postes POS/KDS. Les postes Make Line, Four, Expeditor, les bornes, le relais local et les connecteurs de livraison sont encore à développer; ils ne peuvent pas être activés par une simple installation aujourd’hui.

## 1. Prérequis

- Windows, macOS ou Linux.
- Node.js 22.13 ou plus récent et Git.
- Un compte Cloudflare pour le déploiement Workers/D1.
- Une clé SMS Brevo pour les SMS réels; ne jamais utiliser de vraies clés dans Git.
- Pour une caisse réelle : un TPE et un prestataire de paiement validés, plus le processus de conformité applicable au logiciel de caisse.

## 2. Installer et lancer en local

1. Récupérer le dépôt depuis le dépôt Git fourni par l’équipe.
2. Depuis le dossier du projet, installer les dépendances :

   ```powershell
   npm ci
   ```

3. Créer un fichier local `.env.local` non suivi par Git, avec les valeurs de développement nécessaires. Exemple de noms, sans vraies valeurs :

   ```text
   BREVO_API_KEY=<clé de test, facultative en local>
   SMS_SENDER=DolcePizz
   ADMIN_SETUP_CODE=<secret de test long et unique>
   MARKETING_STOP_SECRET=<secret aléatoire long, différent du code admin>
   ```

4. Appliquer les migrations locales :

   ```powershell
   npm run db:migrate:local
   ```

5. Démarrer l’application en local :

   ```powershell
   node --env-file=.env.local scripts/run-framework.mjs dev
   ```

6. Ouvrir l’adresse locale indiquée par le serveur, vérifier la carte, passer une commande de test, puis consulter `/admin` et `/cuisine`.

Les scripts locaux utilisent une base locale. Ne branche pas cette configuration sur une base de production et n’y ajoute pas de données réelles de clients.

## 3. Démo Cloudflare

Le script `mettre-en-ligne-demo.cmd` prépare une base D1 et publie la démo sur le compte Cloudflare configuré. Le déploiement hébergé ne révèle pas les codes de connexion : un fournisseur SMS réel est requis pour qu’un code soit envoyé. Sans fournisseur, seul un lancement local sur une adresse loopback peut afficher un code de test. `SMS_CAMPAIGNS_DEMO=1` simule uniquement les campagnes promotionnelles; il ne permet pas de se connecter. Le script crée aussi un secret distinct pour signer les liens de désinscription.

Avant de partager cette démo :

1. Utiliser uniquement des données et numéros de test.
2. Garder le code administrateur séparé des messages et du dépôt; le script le conserve dans `.env.demo`, un fichier ignoré par Git.
3. Vérifier qu’aucune clé privée ou donnée client n’est incluse dans le build.
4. Après la démonstration, détruire l’environnement de test ou le conserver sans données réelles et avec les secrets renouvelés.

Ce script n’est pas une procédure de mise en production. La procédure de production doit utiliser une base distincte, des secrets réels configurés dans Cloudflare, un environnement sans mode démo, une authentification d’équipe, des sauvegardes et une migration revue avant publication.

## 4. Installation cible dans un restaurant

### Réseau et matériel

1. Installer un routeur professionnel; réserver un réseau/SSID aux appareils POS/KDS et empêcher les clients Wi-Fi d’accéder aux appareils métier.
2. Raccorder le relais local et l’imprimante cuisine en Ethernet si possible; donner une alimentation protégée au relais, au routeur et à l’imprimante.
3. Installer des écrans tactiles lisibles depuis le poste de travail, avec supports fixes et alimentation sécurisée.
4. Connecter le TPE via le prestataire retenu; ne pas saisir ni enregistrer les données de carte dans les tablettes.
5. Tester l’impression d’un ticket et la reprise après une coupure réseau avant l’ouverture.

### Profils d’écran

- **POS comptoir** : saisie, modification autorisée, paiement et clôture de caisse.
- **POS mobile** : commandes en salle et notifications de commandes prêtes.
- **Centre d’appels** : recherche client, adresse, établissement admissible et commande téléphonique.
- **Borne** : menu publié, commande et ticket; selon la règle actuelle, paiement au comptoir au retrait.
- **Make Line** : articles à assembler et allergènes.
- **Four** : articles à enfourner, ordre et minuteurs.
- **Expeditor** : commande regroupée, vérification, statut prête et remise.

Un appareil doit être enrôlé auprès d’un tenant et d’un établissement. Les identifiants d’équipe sont nominatifs; les changements d’établissement et les remboursements sont audités.

## 5. Ouverture d’un nouvel établissement

Préparer les informations suivantes avant d’activer la commande : nom public, adresse exacte, téléphone, horaires, mode de retrait, mode de livraison, zone (codes postaux ou polygone), capacités par créneau, menu/prix, taxes, imprimantes, postes de production et utilisateurs autorisés.

Pour Dolce Pizz’, Ronchin est renseigné dans la démo à l’adresse 191 avenue Jean-Jaurès, 59790 Ronchin, téléphone 03 20 40 09 01. L’adresse et la zone de Tourcoing doivent être fournies et vérifiées avant d’activer le routage automatique.

## 6. Procédure de mise à jour

1. Sauvegarder/exporter la base concernée.
2. Tester la nouvelle version et les migrations sur une copie.
3. Vérifier accès tenant/site, commande idempotente, prix, paiement à encaisser et impression.
4. Publier hors des heures de service et surveiller les commandes entrantes.
5. Garder le build précédent et la procédure de retour arrière disponibles.

## 7. Ce qui reste à livrer avant une installation de production

- Provisionnement de tenants et d’établissements, isolation des données et permissions par rôle/site.
- Parcours POS, téléphone et borne, avec sélection d’établissement et règles d’encaissement.
- KDS par poste, routage par article, minuteurs, complétude Expeditor et journal des actions.
- Caisse, TPE, clôture de shift, rapprochement des transactions et reçus.
- SMS de commande prête distinct des SMS marketing; gestion des erreurs et doublons.
- Connecteurs Uber Eats/livraison et validation de leurs webhooks.
- Relais local, synchronisation hors ligne, procédures de sauvegarde/restauration et supervision.
- Revue sécurité, tests d’accès croisé, conformité caisse France et pilote avec les équipes.
