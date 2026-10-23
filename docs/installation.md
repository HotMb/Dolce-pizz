# Installation et exploitation — Dolce Pizz’

Ce guide couvre le prototype web, le KDS, la prise de commande simple par le personnel et les accès nominatifs par établissement. Make Line, Four et Expeditor sont présents à `/production`; `/equipe` permet d’ouvrir les postes autorisés et de gérer leurs accès. L’écran `/equipe/commande` accepte les commandes comptoir et téléphone à retirer, recalcule les prix côté serveur et les envoie à la production. Le paiement reste à faire en personne et n’est pas encaissé par cet écran. Un consommateur SMS « commande prête » est livré, mais son fournisseur et son ordonnanceur doivent être configurés avant l’envoi réel. POS mobile de salle, bornes, caisse/TPE, routage automatique du centre d’appels, relais hors ligne et Uber Eats restent à intégrer.

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
   NOTIFICATION_DISPATCH_SECRET=<secret aléatoire distinct, 32 caractères ou plus, facultatif sans ordonnanceur>
   ```

4. Appliquer les migrations locales :

   ```powershell
   npm run db:migrate:local
   ```

5. Démarrer l’application en local :

   ```powershell
   node --env-file=.env.local scripts/run-framework.mjs dev
   ```

6. Ouvrir l’adresse locale indiquée par le serveur, vérifier la carte, passer une commande de test, puis consulter `/admin` et `/production`. L’ancien chemin `/cuisine` redirige vers `/production`.

7. Pour éprouver les postes KDS, envoyer la commande de test en préparation depuis `/admin`; ouvrir `/production`, parcourir Make Line, Four puis Expeditor et confirmer que l’action « prête » reste bloquée tant que chaque unité n’a pas fini son parcours. Les allergènes et le routage doivent aussi être vérifiés dans les fiches menu; l’API applique ce contrôle côté serveur.

8. Ouvrir `/equipe`. Sur une installation neuve, le premier compte activé avec le code administrateur reçoit l’adhésion propriétaire de Dolce Pizz’. La migration `0005` attribue cette adhésion aux administrateurs déjà présents du pilote. Un nouveau collègue se connecte avec son propre mobile, copie l’identifiant affiché dans `/equipe` et le transmet au propriétaire. Celui-ci choisit l’établissement, l’identifiant et le rôle, puis confirme l’attribution. Retirer un accès bloque les requêtes suivantes et les mutations en attente vérifient aussi sa révocation. La gestion actuelle ne permet ni de transférer ni de retirer le propriétaire organisationnel.

9. Pour éprouver la saisie du personnel, attribuer le rôle Comptoir ou Centre d’appels, ouvrir `/equipe/commande`, choisir le canal, saisir les articles et confirmer l’établissement et le créneau. La commande apparaît en préparation dans les postes KDS. Un SMS de retrait ne sera mis en file que si le client donne son mobile et confirme explicitement ce SMS. Le code postal téléphone est actuellement une aide de saisie : tant que les zones et l’établissement de Tourcoing ne sont pas configurés, l’employé choisit le point de retrait dans la liste, qui ne propose que les établissements autorisés et actifs.

10. Pour vérifier les notifications sans envoi, configurer seulement le secret interne et suivre le mode `dryRun` de [notifications.md](notifications.md). Il n’utilise pas Brevo et ne modifie pas l’outbox. Pour l’exploitation, configurer une clé SMS et un ordonnanceur serveur sécurisé; le navigateur ne doit jamais connaître le secret. Les anciennes commandes sans contact confirmé ne sont pas notifiées automatiquement.

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

- **POS comptoir** : saisie d’une commande et transmission au KDS livrées à `/equipe/commande`; encaissement, caisse, TPE et clôture non livrés.
- **POS mobile** : cible pour les commandes en salle et les alertes; non livré.
- **Centre d’appels** : saisie de commande téléphone livrée dans le même écran; le point de retrait se choisit manuellement, le routage à partir des zones postales n’est pas livré.
- **Borne** : cible pour la commande et le ticket; paiement prévu au retrait; non livré.
- **Make Line, Four, Expeditor** : disponibles via `/production`; D1 journalise l’avancement avec l’identité nominative. Les accès se gèrent par site/poste dans `/equipe`; les sessions mobiles existantes restent à renforcer avant exploitation avec appareils partagés.

Un appareil doit être enrôlé auprès d’un tenant et d’un établissement. Les identifiants d’équipe sont nominatifs; les changements d’établissement et les remboursements sont audités.

## 5. Ouverture d’un nouvel établissement

Préparer les informations suivantes avant d’activer la commande : nom public, adresse exacte, téléphone, horaires, mode de retrait, zone de routage par codes postaux, capacités par créneau, menu/prix, TVA, imprimantes, postes de production et utilisateurs autorisés. Le pilote Dolce Pizz’ est en retrait uniquement; aucune livraison maison n’est disponible.

Pour Dolce Pizz’, Ronchin est renseigné dans la démo à l’adresse 191 avenue Jean-Jaurès, 59790 Ronchin, téléphone 03 20 40 09 01. L’adresse et la zone de Tourcoing doivent être fournies et vérifiées avant d’activer le routage automatique.

## 6. Procédure de mise à jour

1. Sauvegarder/exporter la base concernée.
2. Tester la nouvelle version et les migrations sur une copie.
3. Vérifier accès tenant/site, commande idempotente, prix, paiement à encaisser et impression.
4. Publier hors des heures de service et surveiller les commandes entrantes.
5. Garder le build précédent et la procédure de retour arrière disponibles.

## 7. Ce qui reste à livrer avant une installation de production

- Provisionnement de tenants et d’établissements, isolation des données et permissions par rôle/site.
- Encaissement au retrait, TPE, caisse/clôture de shift et reçus.
- POS mobile de salle, bornes client et routage du centre d’appels par zones postales vérifiées.
- Renforcement des sessions d’équipe, enrôlement et révocation des appareils; les rôles KDS par organisation/établissement/poste existent déjà.
- Enrôlement des appareils et configuration multi-sites sans constantes pilote.
- Caisse, TPE, paiement au retrait, clôture de shift, rapprochement des transactions et reçus.
- Configuration et supervision de l’ordonnanceur SMS, essai fournisseur contrôlé et écran de réconciliation des résultats incertains; le consommateur est livré.
- Connecteur Uber Eats et validation de ses webhooks; aucune livraison directe maison n’est prévue pour le pilote.
- Relais local, synchronisation hors ligne, procédures de sauvegarde/restauration et supervision.
- Revue sécurité, tests d’accès croisé, conformité caisse France et pilote avec les équipes.
