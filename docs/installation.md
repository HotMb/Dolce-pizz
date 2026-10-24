# Installation et exploitation — Dolce Pizz’

Ce guide couvre le prototype web, le KDS, la prise de commande simple par le personnel et les accès nominatifs par établissement. Make Line, Four et Expeditor sont présents à `/production`; `/equipe` permet d’ouvrir les postes autorisés et de gérer leurs accès. L’écran `/equipe/commande` accepte les commandes comptoir et téléphone à retirer, recalcule les prix côté serveur et les envoie à la production. `/equipe/caisse` liste les commandes prêtes, impose un shift ouvert, capture le montant exact en cash ou carte sans donnée carte et permet la clôture avec comptage espèces. `/borne` est l’interface client autonome: elle utilise un jeton `kiosk`, charge la carte publique, permet les modificateurs, demande un créneau et envoie la commande au même KDS; le paiement reste au retrait. Le raccordement TPE automatique et la certification restent à intégrer. Un consommateur SMS « commande prête » est livré, mais son fournisseur et son ordonnanceur doivent être configurés avant l’envoi réel. POS mobile de salle, routage automatique du centre d’appels, relais hors ligne, MDM matériel et Uber Eats restent à intégrer.

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

   Pour un déploiement multi-enseignes, ajouter aussi `TENANT_HOSTS_JSON` dans le coffre de secrets, par exemple `{"dolce.example.fr":{"organizationId":"dolce-pizza","locationId":"ronchin"}}`. Le domaine est la seule source de portée publique; les paramètres `organizationId` et `locationId` ne servent pas à changer de tenant. Chaque entrée doit pointer vers une organisation et un établissement actifs déjà provisionnés dans D1.

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

8. Ouvrir `/equipe`. Sur une installation neuve, le premier compte activé avec le code administrateur reçoit l’adhésion propriétaire de Dolce Pizz’. La migration `0005` attribue cette adhésion aux administrateurs déjà présents du pilote. La migration `0006` rattache le menu, les ingrédients, les photos et les réglages existants à l’organisation `dolce-pizza`. La migration `0007` migre les profils/consentements clients, les points et les campagnes historiques vers cette même organisation, sépare le client de l’employé créateur d’une commande et supprime les anciens champs de consentement globaux. Elle ne crée pas de nouvelle enseigne et ne configure pas Tourcoing. Un nouveau collègue se connecte avec son propre mobile, copie l’identifiant affiché dans `/equipe` et le transmet au propriétaire. Celui-ci choisit l’établissement, l’identifiant et le rôle, puis confirme l’attribution. Depuis le bloc **Appareils** de cette même page, le propriétaire enrôle Make Line, Four, Expeditor, POS, borne ou relais imprimante; il transmet le jeton affiché une seule fois au poste, puis peut révoquer l’appareil. Retirer un accès bloque les requêtes suivantes et les mutations en attente vérifient aussi sa révocation. La gestion actuelle ne permet ni de transférer ni de retirer le propriétaire organisationnel.

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

### Créer une nouvelle enseigne

Le premier déploiement d’une enseigne est volontairement contrôlé. Un propriétaire déjà connecté appelle `POST /api/admin/onboarding` avec `installationCode`, les identifiants de l’organisation et du site, puis l’adresse française du point de retrait. Le code d’installation reste un secret Cloudflare (`ADMIN_SETUP_CODE`) et n’est jamais envoyé au navigateur ni enregistré en base. La route vérifie l’origine, la session, le format strict, le quota d’essais et crée dans un seul lot D1 l’organisation active, le site, les réglages, le propriétaire et le catalogue initial.

Exemple de liaison de domaine après création :

```json
{
  "tourcoing.dolcepizza.fr": { "organizationId": "dolce-pizza", "locationId": "tourcoing" },
  "ronchin.dolcepizza.fr": { "organizationId": "dolce-pizza", "locationId": "ronchin" }
}
```

En production, cette valeur reste disponible pour les installations historiques, mais les nouveaux domaines peuvent être enregistrés dans D1 depuis `GET/POST /api/admin/domains`. Le propriétaire crée un domaine en état `pending`, publie le TXT `_dolce-verify.<domaine>` renvoyé une seule fois, puis demande la vérification. Le Worker interroge DNS-over-HTTPS et n’active le domaine qu’après correspondance exacte. Un domaine absent de `TENANT_HOSTS_JSON` et non vérifié en base est refusé par l’API; aucun paramètre d’URL ne peut choisir une autre enseigne.

Les réglages d’horaires, de capacité et de fidélité sont stockés par établissement dans `location_config` (migration `0014`). Une installation historique qui n’a pas encore activé ses réglages locaux utilise temporairement son modèle organisationnel; l’onboarding d’une nouvelle enseigne crée directement le réglage de son premier site.

La carte maître reste dans `products`. La migration `0017` ajoute `location_product_overrides` : le POS, les bornes et la commande web lisent une disponibilité, un prix ou un format XXL local lorsqu’il existe, sinon la valeur maître. Les modifications passent par `GET/POST /api/staff/catalog-overrides`, avec rôle responsable, portée établissement et version optimiste.

### Connecter Uber Eats

1. Depuis l’API propriétaire `GET/POST /api/admin/delivery-integrations`, créer une liaison pour chaque magasin avec le `provider` `uber_eats`, l’identifiant de magasin Uber et le couple organisation/établissement correspondant. Une désactivation conserve l’historique et empêche les nouveaux webhooks.
2. Configurer `UBER_EATS_WEBHOOK_SECRET` dans le Worker et déclarer `/api/integrations/uber/webhook` auprès du partenaire.
3. Le webhook doit envoyer `X-Uber-Signature` et un événement normalisé contenant `eventId`, `eventType`, `storeId`, `orderId`, `totalCents` et les articles avec leur SKU local.
4. Une commande importée apparaît dans le POS avec `channel=uber_eats`, paiement déjà réglé par l’agrégateur et retrait de toute notification SMS. Un SKU inconnu ou une fiche sans routage/allergènes validés reste bloqué dans le KDS jusqu’à correction du menu.

### Reporting franchiseur

La page `/equipe/rapports` appelle `GET /api/admin/reports?organizationId=<id>&from=AAAA-MM-JJ&to=AAAA-MM-JJ` et fournit au propriétaire les totaux de commandes, chiffre d’affaires encaissé, annulations, détail par établissement, canal et moyen de paiement. La période est limitée à 31 jours; les requêtes sont toujours filtrées par l’organisation du propriétaire et aucune donnée client brute n’est renvoyée.

1. Installer un routeur professionnel; réserver un réseau/SSID aux appareils POS/KDS et empêcher les clients Wi-Fi d’accéder aux appareils métier.
2. Raccorder le relais local et l’imprimante cuisine en Ethernet si possible; donner une alimentation protégée au relais, au routeur et à l’imprimante. Le relais utilise le rôle d’appareil `printer_gateway` et récupère les jobs sur `/api/internal/print-jobs` avec son jeton Bearer; le jeton n’est jamais imprimé dans les journaux.
3. Installer des écrans tactiles lisibles depuis le poste de travail, avec supports fixes et alimentation sécurisée.
4. Connecter le TPE via le prestataire retenu; ne pas saisir ni enregistrer les données de carte dans les tablettes.
5. Tester l’impression d’un ticket, la reprise après une coupure réseau, la réimpression et le rejet d’un ticket après cinq échecs avant l’ouverture. Chaque changement d’état est idempotent grâce à l’identifiant d’opération et au bail du relais.

### Profils d’écran

- **POS comptoir** : saisie d’une commande et transmission au KDS livrées à `/equipe/commande`; `/equipe/caisse` impose un shift ouvert, capture le paiement au retrait et permet la clôture avec comptage espèces. Le TPE automatique et la certification restent à intégrer.
- **POS mobile** : cible pour les commandes en salle et les alertes; non livré.
- **Centre d’appels** : saisie de commande téléphone livrée dans le même écran; `/api/staff/routing` permet de configurer les codes postaux par site et de proposer les établissements actifs, avec validation serveur avant création de la commande.
- **Borne** : enrôler un appareil depuis `/equipe` avec le rôle `kiosk`, conserver le jeton affiché une seule fois, puis ouvrir `/borne` sur l’appareil et le saisir dans l’écran de configuration. L’interface charge le catalogue, utilise un panier `dolce-kiosk-cart` séparé des autres écrans, demande le créneau, transmet une commande `channel=kiosk` avec prix recalculé côté serveur et affiche un reçu après acceptation. En production, verrouiller le navigateur par MDM, ne pas partager le jeton entre bornes et prévoir sa révocation en cas de remplacement.
- **Make Line, Four, Expeditor** : disponibles via `/production`; D1 journalise l’avancement avec l’identité nominative. Les appareils se préparent depuis le bloc Appareils de `/equipe` avec un rôle et un jeton expirant; le heartbeat `/api/device/heartbeat` permet de vérifier leur identité sans stocker le jeton en clair. La dernière vue KDS est conservée dans la session du navigateur. Une validation faite hors connexion est placée dans une file locale limitée à 50 actions; au retour réseau, chaque action est rejouée avec sa révision attendue. Une action devenue obsolète est retirée et signalée, jamais appliquée silencieusement.

Un appareil doit être enrôlé auprès d’un tenant et d’un établissement. Les identifiants d’équipe sont nominatifs; les changements d’établissement et les remboursements sont audités.

## 5. Ouverture d’un nouvel établissement

Préparer les informations suivantes avant d’activer la commande : nom public, adresse exacte, téléphone, horaires, mode de retrait, zone de routage par codes postaux, capacités par créneau, menu/prix, TVA, imprimantes, postes de production et utilisateurs autorisés. Le pilote Dolce Pizz’ est en retrait uniquement; aucune livraison maison n’est disponible.

Pour Dolce Pizz’, Ronchin est renseigné dans la démo à l’adresse 191 avenue Jean-Jaurès, 59790 Ronchin, téléphone 03 20 40 09 01. L’adresse et la zone de Tourcoing doivent être fournies et vérifiées avant d’activer le routage automatique.

## 6. Procédure de mise à jour

1. Sauvegarder/exporter la base concernée.
2. Tester la nouvelle version et les migrations sur une copie.
3. Avant `0007`, vérifier qu’aucune écriture de fidélité n’est orpheline et qu’aucune campagne ne référence un compte supprimé. La migration s’arrête sans supprimer de données si elle détecte ce cas.
4. Mettre le pilote en maintenance pendant l’application de `0007`, `0008`, `0009` puis `0010` et la publication du nouveau Worker : l’ancien Worker écrit encore l’ancien schéma, qui est volontairement retiré par ces migrations.
5. Vérifier accès tenant/site, zones postales et routage, enrôlement puis révocation d’un appareil, commande idempotente, profil/consentement, solde fidélité, campagne de test, prix, paiement à encaisser et impression.
6. Publier hors des heures de service et surveiller les commandes entrantes.
7. Garder l’export de base et la procédure de retour arrière disponibles; une restauration de schéma nécessite aussi la restauration des données correspondantes.

## 7. Ce qui reste à livrer avant une installation de production

- Résolution du tenant depuis un domaine/configuration de confiance, onboarding de nouvelles enseignes et administration franchiseur; les principaux objets client et équipe sont déjà isolés en base.
- TPE réel, annulations/remboursements, certification caisse et exports comptables.
- POS mobile de salle et routage du centre d’appels par zones postales vérifiées.
- Renforcement des sessions d’équipe, enrôlement et révocation des appareils; les rôles KDS par organisation/établissement/poste existent déjà.
- Enrôlement des appareils et configuration multi-sites sans constantes pilote.
- Caisse, TPE, paiement au retrait, clôture de shift, rapprochement des transactions et reçus.
- Configuration et supervision de l’ordonnanceur SMS, essai fournisseur contrôlé et écran de réconciliation des résultats incertains; le consommateur est livré.
- Connecteur Uber Eats et validation de ses webhooks; aucune livraison directe maison n’est prévue pour le pilote.
- Outbox serveur d’impression tenant-scopée livrée; il reste à fournir l’adaptateur matériel concret (ESC/POS ou pilote constructeur), les procédures de sauvegarde/restauration et la supervision.
- Revue sécurité, tests d’accès croisé, conformité caisse France et pilote avec les équipes.
