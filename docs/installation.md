# Installation et exploitation — Dolce Pizz’

Pour chaque nouveau site, copiez le [dossier de recette d’établissement](./site-acceptance-record.md) dans l’espace privé d’exploitation et faites-le signer avant l’ouverture.

En cas de panne ou d’incident, suivre le [runbook d’incident](./incident-response.md) avant de relancer une action manuelle.

Avant d’ouvrir un établissement, compléter la [checklist de mise en production](./go-live-checklist.md) et conserver ses preuves dans le dossier de recette.

Pour l’installation des tablettes, bornes, imprimante et TPE, suivre la [fiche de déploiement matériel](./hardware-deployment.md), le [contrat d’adaptateur TPE](./tpe-adapter-contract.md) et conserver le dossier de recette du site.

Ce guide couvre le prototype web, le KDS, la prise de commande du personnel, le centre d’appels et les accès nominatifs par établissement. Make Line, Four et Expeditor sont présents à `/production`; `/equipe` permet d’ouvrir les postes autorisés, les appareils et leurs accès. L’écran `/equipe/commande` accepte les commandes comptoir et téléphone à retirer, ainsi que le POS mobile `Sur place` avec table, recalcule les prix côté serveur et envoie la commande à la production. `/equipe/caisse` liste les commandes prêtes, affiche la table pour une commande sur place, permet d’ouvrir l’addition détaillée depuis le serveur, de cocher les lignes encore dues ou de saisir une portion de ligne, puis de préparer automatiquement un paiement réparti (`allocations`), accepte plusieurs encaissements jusqu’au solde exact, impose un shift ouvert, capture uniquement les montants saisis en cash ou carte sans donnée carte et permet la clôture avec comptage espèces. Un propriétaire ou responsable peut enregistrer un remboursement manuel avec `POST /api/staff/refunds`; cette opération crée un journal immuable et réajuste le solde local, mais ne déclenche pas encore un remboursement bancaire automatique. `/borne` est l’interface client autonome: elle utilise un jeton `kiosk`, charge la carte publique, permet les modificateurs, demande un créneau et envoie la commande au même KDS; le paiement reste au retrait. Le raccordement TPE automatique et la certification restent à intégrer. Un consommateur SMS « commande prête » est livré, mais son fournisseur et son ordonnanceur doivent être configurés avant l’envoi réel. Le routage postal, l’historique centre d’appel, le relais d’impression local et le connecteur Uber Eats sont disponibles côté logiciel; le MDM matériel, les comptes fournisseurs et les essais terrain restent à configurer.

## 1. Prérequis

- Windows, macOS ou Linux.
- Node.js 22.13 ou plus récent et Git.
- Un compte Cloudflare pour le déploiement Workers/D1.
- Une clé SMS Brevo pour les SMS réels; ne jamais utiliser de vraies clés dans Git.
- Pour une caisse réelle : un TPE et un prestataire de paiement validés, plus le processus de conformité applicable au logiciel de caisse.

### Erreur fréquente sous Windows : Node trop ancien

Si `npm ci` affiche `EBADENGINE`, puis qu’une commande échoue avec `node: bad option: --import`, la version active est trop ancienne. Le projet ne fonctionne pas avec Node 18.16 ou une version antérieure.

Avec **nvm-windows** :

```powershell
nvm list
nvm install 24.5.0
nvm use 24.5.0
node -v
npm -v
```

`node -v` doit afficher `v22.13.0` ou une version supérieure. Fermer et rouvrir PowerShell si `nvm use` ne change pas la version active. Ensuite, depuis le dossier du projet :

```powershell
Remove-Item -Recurse -Force node_modules
npm ci
npm run db:migrate:local
npm run db:verify
```

Le script Windows `lancer-site.cmd` sélectionne automatiquement Node 24.5.0 lorsqu’il est installé dans nvm-windows. Ne lance pas les migrations avec l’ancien `node.exe` resté dans le PATH.

## 2. Installer et lancer en local

1. Récupérer le dépôt depuis le dépôt Git fourni par l’équipe.
2. Depuis le dossier du projet, installer les dépendances :

   ```powershell
   npm ci
   ```

3. Créer un fichier local `.env.local` non suivi par Git, avec les valeurs de développement nécessaires. Exemple de noms, sans vraies valeurs :

   ```text
   BREVO_API_KEY=<clé de test, facultative en local>

### Accès direct aux postes internes

Pour un poste de pizzeria, ajoutez dans `.env.local` une clé associée à un compte déjà présent dans la base :

```dotenv
INTERNAL_ACCESS_KEYS_JSON=[{"id":"otto-admin","key":"remplacer-par-une-cle-longue","phone":"06XXXXXXXX","target":"/equipe"},{"id":"pos-ronchin","key":"une-autre-cle-longue","phone":"06XXXXXXXX","target":"/equipe/commande"},{"id":"four-ronchin","key":"une-cle-four-longue","phone":"06XXXXXXXX","target":"/production?station=oven"}]
```

Le compte indiqué par `phone` doit déjà avoir le rôle correspondant dans l’établissement. La clé ouvre une session équipe de 12 heures, puis le serveur applique les droits habituels. Pour un déploiement hébergé, utilisez `keyHash` (SHA-256) à la place de `key` et ne mettez jamais une clé réelle dans Git.
   SMS_SENDER=DolcePizz
   ADMIN_SETUP_CODE=<secret de test long et unique>
   MARKETING_STOP_SECRET=<secret aléatoire long, différent du code admin>
   NOTIFICATION_DISPATCH_SECRET=<secret aléatoire distinct, 32 caractères ou plus>
   NOTIFICATION_SCHEDULER_CONFIGURED=1
   ```

   Pour un déploiement multi-enseignes, ajouter aussi `TENANT_HOSTS_JSON` dans le coffre de secrets, par exemple `{"dolce.example.fr":{"organizationId":"dolce-pizza","locationId":"ronchin"}}`. Le domaine est la seule source de portée publique; les paramètres `organizationId` et `locationId` ne servent pas à changer de tenant. Chaque entrée doit pointer vers une organisation et un établissement actifs déjà provisionnés dans D1.

4. Appliquer les migrations locales :

   ```powershell
   npm run db:migrate:local
   ```

   Vérifier ensuite une restauration de schéma vierge :

   ```powershell
   npm run db:verify
   ```

5. Démarrer l’application en local :

   ```powershell
   node --env-file=.env.local scripts/run-framework.mjs dev
   ```

6. Ouvrir l’adresse locale indiquée par le serveur, vérifier la carte, passer une commande de test, puis consulter `/admin` et `/production`. L’ancien chemin `/cuisine` redirige vers `/production`.

7. Pour éprouver les postes KDS, envoyer la commande de test en préparation depuis `/admin`; ouvrir `/production`, parcourir Make Line, Four puis Expeditor et confirmer que l’action « prête » reste bloquée tant que chaque unité n’a pas fini son parcours. Les allergènes et le routage doivent aussi être vérifiés dans les fiches menu; l’API applique ce contrôle côté serveur.

8. Ouvrir `/equipe`. Sur une installation neuve, le premier compte activé avec le code administrateur reçoit l’adhésion propriétaire de Dolce Pizz’. La migration `0005` attribue cette adhésion aux administrateurs déjà présents du pilote. La migration `0006` rattache le menu, les ingrédients, les photos et les réglages existants à l’organisation `dolce-pizza`. La migration `0007` migre les profils/consentements clients, les points et les campagnes historiques vers cette même organisation, sépare le client de l’employé créateur d’une commande et supprime les anciens champs de consentement globaux. La migration `0030` distingue les sessions OTP `customer` et `staff`; ouvrir une route d’équipe crée un cookie équipe de 12 heures, tandis que le compte client reste valable 90 jours. Elle ne crée pas de nouvelle enseigne et ne configure pas Tourcoing. Un nouveau collègue se connecte avec son propre mobile, copie l’identifiant affiché dans `/equipe` et le transmet au propriétaire. Celui-ci choisit l’établissement, l’identifiant et le rôle, puis confirme l’attribution. Depuis le bloc **Appareils** de cette même page, le propriétaire enrôle Make Line, Four, Expeditor, POS, borne ou relais imprimante; il transmet le jeton affiché une seule fois au poste, puis peut le faire tourner périodiquement ou révoquer l’appareil. La rotation invalide immédiatement l’ancien jeton et n’affiche le nouveau qu’une seule fois. Retirer un accès bloque les requêtes suivantes et les mutations en attente vérifient aussi sa révocation. Pour changer de responsable d’enseigne, ouvrir `/equipe/proprietaire`, saisir l’identifiant d’un compte existant et la phrase exacte `TRANSFERER LA PROPRIETE`; l’ancien propriétaire est révoqué dans la même transaction et le transfert est audité.
   Pour une commande POS ou téléphone, le personnel ne coche « Envoyer un SMS quand la commande sera prête » qu’après accord explicite du client. Cette confirmation crée la preuve `staff_confirmed`; décocher la case ou laisser le mobile vide désactive le SMS et conserve le ticket imprimé si nécessaire.

9. Pour éprouver la saisie du personnel, attribuer le rôle Comptoir ou Centre d’appels, ouvrir `/equipe/commande`, choisir le canal, saisir les articles et confirmer l’établissement et le créneau. En canal téléphone, le code postal interroge les zones configurées et propose les établissements autorisés; l’employé confirme explicitement le point de retrait avant l’envoi. La commande apparaît en préparation dans les postes KDS. Un SMS de retrait ne sera mis en file que si le client donne son mobile et confirme explicitement ce SMS. Si aucune zone ne correspond, l’employé choisit manuellement un établissement actif auquel son compte a accès.

10. Pour vérifier les notifications sans envoi, configurer seulement le secret interne et suivre le mode `dryRun` de [notifications.md](notifications.md). Il n’utilise pas Brevo et ne modifie pas l’outbox. Le propriétaire peut consulter `/equipe/notifications` pour les compteurs et les événements ouverts; aucun numéro ni contenu de commande n’y apparaît. Pour l’exploitation, configurer une clé SMS et un ordonnanceur serveur sécurisé; le navigateur ne doit jamais connaître le secret. Les anciennes commandes sans contact confirmé ne sont pas notifiées automatiquement.

Les scripts locaux utilisent une base locale. Ne branche pas cette configuration sur une base de production et n’y ajoute pas de données réelles de clients.

## 3. Démo Cloudflare

Le script `mettre-en-ligne-demo.cmd` prépare une base D1 et publie la démo sur le compte Cloudflare configuré. Le déploiement hébergé ne révèle pas les codes de connexion : un fournisseur SMS réel est requis pour qu’un code soit envoyé. Sans fournisseur, seul un lancement local sur une adresse loopback peut afficher un code de test. `SMS_CAMPAIGNS_DEMO=1` simule uniquement les campagnes promotionnelles; il ne permet pas de se connecter. Le script crée aussi un secret distinct pour signer les liens de désinscription. Fournir `PUBLIC_BASE_URL=https://...` au lancement déclenche automatiquement le contrôle des en-têtes HTTP après publication; sans cette variable, exécuter `npm run security:http -- --url=https://...` depuis un réseau qui atteint le domaine.

Avant de partager cette démo :

1. Utiliser uniquement des données et numéros de test.
2. Garder le code administrateur séparé des messages et du dépôt; le script le conserve dans `.env.demo`, un fichier ignoré par Git.
3. Vérifier qu’aucune clé privée ou donnée client n’est incluse dans le build.
4. Après la démonstration, détruire l’environnement de test ou le conserver sans données réelles et avec les secrets renouvelés.

Ce script n’est pas une procédure de mise en production. La procédure de production doit utiliser une base distincte, des secrets réels configurés dans Cloudflare, un environnement sans mode démo, une authentification d’équipe, des sauvegardes et une migration revue avant publication.

Avant une publication de production, charger les variables du coffre dans l’environnement du déploiement puis exécuter `npm run preflight:production`. Le préflight lance d’abord le scan avec inspection des `.env*`, puis exige `ADMIN_SETUP_CODE`, `MARKETING_STOP_SECRET`, `NOTIFICATION_DISPATCH_SECRET`, `BREVO_API_KEY`, `SMS_SENDER` (1 à 11 caractères, commençant par une lettre), `CF_D1_DATABASE_ID`, `CF_WORKER_NAME`, un `PUBLIC_BASE_URL` HTTPS public et un `TENANT_HOSTS_JSON` valide; `NOTIFICATION_SCHEDULER_CONFIGURED=1` doit être défini après installation et test de l’ordonnanceur. Il refuse `SMS_DEMO` et `SMS_CAMPAIGNS_DEMO`. Il n’affiche aucune valeur secrète. En développement, `npm run security:scan` ignore les fichiers `.env*` locaux; `npm run security:scan:env` les inclut explicitement.

Les réponses web ajoutent aussi des en-têtes de protection contre l’encodage MIME, l’intégration dans une iframe, la fuite de référent et l’accès aux capteurs. Après chaque publication, vérifier ces en-têtes sur le domaine public et tester les parcours borne, POS et KDS avant d’ajouter une politique CSP plus stricte.

Le contrôle automatisé se lance depuis une machine qui peut joindre le domaine :

```powershell
npm run security:http -- --url=https://restaurant.exemple.fr
```

Le script n’affiche pas le contenu de la réponse et refuse les redirections ainsi que les origines HTTP non locales.

## 4. Installation cible dans un restaurant

### Réseau et matériel

### Créer une nouvelle enseigne

Le premier déploiement d’une enseigne est volontairement contrôlé. Un propriétaire déjà connecté appelle `POST /api/admin/onboarding` avec `installationCode`, les identifiants de l’organisation et du site, puis l’adresse française du point de retrait. Le code d’installation reste un secret Cloudflare (`ADMIN_SETUP_CODE`) et n’est jamais envoyé au navigateur ni enregistré en base. La route vérifie l’origine, la session `staff`, le rôle propriétaire lorsque la base contient déjà une enseigne, le format strict et le quota d’essais, puis crée dans un seul lot D1 l’organisation active, le site, les réglages, le propriétaire et le catalogue initial. Une base totalement vide conserve le bootstrap initial au moyen du secret d’installation.

Exemple de liaison de domaine après création :

```json
{
  "tourcoing.dolcepizza.fr": { "organizationId": "dolce-pizza", "locationId": "tourcoing" },
  "ronchin.dolcepizza.fr": { "organizationId": "dolce-pizza", "locationId": "ronchin" }
}
```

En production, cette valeur reste disponible pour les installations historiques, mais les nouveaux domaines peuvent être enregistrés dans D1 depuis `GET/POST /api/admin/domains`. Le propriétaire crée un domaine en état `pending`, publie le TXT `_dolce-verify.<domaine>` renvoyé une seule fois, puis demande la vérification. Le Worker interroge DNS-over-HTTPS et n’active le domaine qu’après correspondance exacte. Un domaine absent de `TENANT_HOSTS_JSON` et non vérifié en base est refusé par l’API; aucun paramètre d’URL ne peut choisir une autre enseigne.

Le propriétaire peut effectuer la même opération depuis `/equipe/domaines`. L’écran ne propose que les établissements de ses enseignes, affiche le jeton TXT une seule fois après création et conserve la vérification côté serveur. Un responsable de site ou un membre du centre d’appels ne voit pas cet écran et ne peut pas enregistrer de domaine.

Les réglages d’horaires, de capacité et de fidélité sont stockés par établissement dans `location_config` (migration `0014`). Une installation historique qui n’a pas encore activé ses réglages locaux utilise temporairement son modèle organisationnel; l’onboarding d’une nouvelle enseigne crée directement le réglage de son premier site.

La carte maître reste dans `products`. La migration `0017` ajoute `location_product_overrides` : le POS, les bornes et la commande web lisent une disponibilité, un prix ou un format XXL local lorsqu’il existe, sinon la valeur maître. Le propriétaire ou le responsable utilise `/equipe/catalogue-local`; l’écran appelle `GET/POST /api/staff/catalog-overrides`, avec portée établissement et version optimiste.

### Connecter Uber Eats

Avant l’activation, suivre le [contrat d’intégration Uber Eats](./uber-eats-contract.md) et joindre ses preuves au dossier de recette.

1. Depuis l’API propriétaire `GET/POST /api/admin/delivery-integrations`, créer une liaison pour chaque magasin avec le `provider` `uber_eats`, l’identifiant de magasin Uber et le couple organisation/établissement correspondant. Une désactivation conserve l’historique et empêche les nouveaux webhooks.
2. Configurer `UBER_EATS_WEBHOOK_SECRET` dans le Worker et déclarer `/api/integrations/uber/webhook` auprès du partenaire.
3. Le webhook doit envoyer `X-Uber-Signature` et un événement normalisé contenant `eventId`, `eventType`, `storeId`, `orderId`, `totalCents` et les articles avec leur SKU local.
4. Une commande importée apparaît dans le POS avec `channel=uber_eats`, paiement déjà réglé par l’agrégateur et retrait de toute notification SMS. Un SKU inconnu ou une fiche sans routage/allergènes validés reste bloqué dans le KDS jusqu’à correction du menu. Si une erreur D1 survient après réception, l’inbox est marquée en échec et le même événement peut être rejoué; ne supprimez pas cet événement avant vérification.

### Reporting franchiseur

La page `/equipe/rapports` appelle `GET /api/admin/reports?organizationId=<id>&from=AAAA-MM-JJ&to=AAAA-MM-JJ` et fournit au propriétaire les totaux de commandes, chiffre d’affaires encaissé, annulations, détail par établissement, canal et moyen de paiement. La période est limitée à 31 jours; les requêtes sont toujours filtrées par l’organisation du propriétaire et aucune donnée client brute n’est renvoyée.

Le bouton **Exporter CSV** utilise le même contrôle propriétaire et la même période. Le fichier contient uniquement les agrégats par établissement, canal et paiement, avec séparateur `;` et encodage adapté à Excel français; aucun nom, téléphone, e-mail ou détail de commande n’est exporté.

### Demande d’effacement client

Un client connecté peut demander l’effacement de ses données commerciales avec `DELETE /api/me`. L’opération est limitée à l’organisation du domaine courant : le profil, le consentement et les coordonnées des commandes web sont anonymisés, tandis que les montants et l’historique opérationnel nécessaires à la caisse restent conservés. Le navigateur doit envoyer l’origine du site et la session OTP; aucun effacement inter-enseigne n’est possible.

1. Installer un routeur professionnel; réserver un réseau/SSID aux appareils POS/KDS et empêcher les clients Wi-Fi d’accéder aux appareils métier.
2. Raccorder le relais local et l’imprimante cuisine en Ethernet si possible; donner une alimentation protégée au relais, au routeur et à l’imprimante. Le relais utilise le rôle d’appareil `printer_gateway` et récupère les jobs sur `/api/internal/print-jobs` avec son jeton Bearer; le jeton et le contenu des tickets ne sont jamais écrits dans les journaux. Le dépôt fournit `npm run printer:gateway`: renseigner `PRINT_GATEWAY_URL`, `PRINT_GATEWAY_TOKEN` (64 caractères hexadécimaux), `PRINTER_HOST` et `PRINTER_PORT`. Le relais exige HTTPS pour une URL distante et n’accepte HTTP que vers la boucle locale. Il démarre en simulation (`DRY_RUN=1`), sans afficher le ticket; passer à `DRY_RUN=0` uniquement après un essai local contrôlé sur une imprimante ESC/POS réseau. Le propriétaire consulte `/equipe/impression` pour les jobs en attente ou en erreur; une relance est autorisée uniquement pour un échec confirmé, jamais pour un résultat fournisseur inconnu.
3. Installer des écrans tactiles lisibles depuis le poste de travail, avec supports fixes et alimentation sécurisée.
4. Connecter le TPE via le prestataire retenu; ne pas saisir ni enregistrer les données de carte dans les tablettes. L’endpoint `POST /api/staff/payments/terminal` reste volontairement en échec fermé (`terminal_not_configured`) tant qu’un adaptateur certifié n’est pas installé. Il ne confirme jamais un paiement et ne modifie aucun solde dans cet état. Les remboursements manuels créent aussi un ajustement négatif rattaché au shift d’origine afin que le rapprochement espèces reste exact.
5. Tester l’impression d’un ticket en simulation puis sur matériel, la reprise après une coupure réseau, la réimpression et le rejet d’un ticket après cinq échecs avant l’ouverture. Chaque changement d’état est idempotent grâce à l’identifiant d’opération et au bail du relais. Le relais ne confirme le job qu’après succès de l’impression ou de la simulation.

### Profils d’écran

- **POS comptoir** : saisie d’une commande et transmission au KDS livrées à `/equipe/commande`; `/equipe/caisse` impose un shift ouvert, interroge les commandes prêtes toutes les cinq secondes et signale une nouvelle commande (avec vibration si le terminal l’autorise), capture le paiement au retrait et permet la clôture avec comptage espèces. Le contrat d’adaptateur TPE est présent, mais aucun fournisseur n’est activé par défaut : le paiement carte reste manuel jusqu’à l’intégration et la certification choisies.
- **Tablettes KDS enrôlées** : un appareil Make Line, Four ou Expeditor peut appeler les routes de production avec son jeton Bearer limité au site et au poste. Pour configurer l’interface, ouvrir `/production?station=…` puis ajouter temporairement le jeton sous forme de fragment local `#device=<jeton>` (le fragment n’est pas envoyé au serveur); l’écran le déplace aussitôt dans le stockage local et vérifie `/api/device/bootstrap`. Le jeton n’est jamais placé dans une requête ou un journal; sa révocation ou son expiration bloque immédiatement les lectures et validations. L’interface web peut toujours fonctionner avec une session nominative. Le bootstrap limite les essais à 20 par heure et par adresse source : après un `429`, attendre le délai indiqué puis vérifier le réseau du poste avant de faire tourner le jeton.
- **POS mobile** : enrôler un appareil avec le rôle `pos`, puis ouvrir `/equipe/commande?device=1` et saisir le jeton dans l’écran de configuration. Le bootstrap détecte l’établissement du poste; l’interface limite alors les canaux à `pos` et le serveur refuse tout autre site ou canal. Le bouton **Verrouiller** efface le jeton du navigateur avant de remettre le poste à l’écran de configuration. Choisir `Sur place` exige une table (ex. `T4`), enregistrée dans le contexte de commande et affichée au KDS. Une session équipe autorisée peut transférer une commande `preparing` ou `ready` vers une autre table via `PATCH /api/staff/orders` avec sa version courante; les commandes terminées, annulées ou d’un autre établissement sont refusées. L’addition détaillée et le paiement réparti sont disponibles depuis `/equipe/caisse`.
- **Centre d’appels** : saisie de commande téléphone livrée dans le même écran; la recherche par mobile exact est limitée au propriétaire ou au rôle Centre d’appels de l’enseigne et ne renvoie que le nom, le numéro normalisé et des compteurs agrégés; `/api/staff/routing` permet de configurer les codes postaux par site et de proposer les établissements actifs, avec validation serveur avant création de la commande.
- **Borne** : enrôler un appareil depuis `/equipe` avec le rôle `kiosk`, conserver le jeton affiché une seule fois, puis ouvrir `/borne` sur l’appareil et le saisir dans l’écran de configuration. Le bootstrap vérifie le rôle et détecte automatiquement l’organisation et l’établissement du jeton : aucun site n’est codé dans l’interface. L’interface charge le catalogue, utilise un panier `dolce-kiosk-cart` séparé des autres écrans, demande le créneau, transmet une commande `channel=kiosk` avec prix recalculé côté serveur et affiche un reçu après acceptation. En production, verrouiller le navigateur par MDM, ne pas partager le jeton entre bornes et prévoir sa révocation en cas de remplacement.
- **Make Line, Four, Expeditor** : disponibles via `/production`; D1 journalise l’avancement avec l’identité nominative. Les appareils se préparent depuis le bloc Appareils de `/equipe` avec un rôle et un jeton expirant; le heartbeat `/api/device/heartbeat` permet de vérifier leur identité sans stocker le jeton en clair. La dernière vue KDS est conservée dans la session du navigateur. Une validation faite hors connexion est placée dans une file locale limitée à 50 actions; au retour réseau, chaque action est rejouée avec sa révision attendue. Une action devenue obsolète est retirée et signalée, jamais appliquée silencieusement.

Un appareil doit être enrôlé auprès d’un tenant et d’un établissement. Les identifiants d’équipe sont nominatifs; les changements d’établissement et les remboursements sont audités.

## 5. Ouverture d’un nouvel établissement

Préparer les informations suivantes avant d’activer la commande : nom public, adresse exacte, téléphone, horaires, mode de retrait, zone de routage par codes postaux, capacités par créneau, menu/prix, TVA, imprimantes, postes de production et utilisateurs autorisés. Le pilote Dolce Pizz’ est en retrait uniquement; aucune livraison maison n’est disponible.

Pour Dolce Pizz’, Ronchin est renseigné dans la démo à l’adresse 191 avenue Jean-Jaurès, 59790 Ronchin, téléphone 03 20 40 09 01. La migration `0028` active uniquement le code postal `59790` pour ce site. L’adresse et la zone de Tourcoing doivent être fournies et vérifiées avant d’activer son routage automatique.

## 6. Procédure de mise à jour

1. Sauvegarder/exporter la base concernée.
2. Tester la nouvelle version et les migrations sur une copie.
3. Avant `0007`, vérifier qu’aucune écriture de fidélité n’est orpheline et qu’aucune campagne ne référence un compte supprimé. La migration s’arrête sans supprimer de données si elle détecte ce cas.
4. Mettre le pilote en maintenance pendant l’application de `0007`, `0008`, `0009` puis `0010` et la publication du nouveau Worker : l’ancien Worker écrit encore l’ancien schéma, qui est volontairement retiré par ces migrations.
5. Vérifier accès tenant/site, zones postales et routage, enrôlement puis révocation d’un appareil, commande idempotente, profil/consentement, solde fidélité, campagne de test, prix, paiement à encaisser et impression.
   Pour une modification de carte, vérifier aussi l’historique maître via `GET /api/admin/products/revisions?productId=<id>` avant toute restauration manuelle; les commandes historiques restent inchangées.
6. Publier hors des heures de service et surveiller les commandes entrantes.
7. Garder l’export de base et la procédure de retour arrière disponibles; une restauration de schéma nécessite aussi la restauration des données correspondantes. Après chaque restauration, exécuter `npm run db:verify` sur une copie de contrôle : cette commande vérifie les migrations et les références SQLite, mais ne remplace pas un test de restauration D1 distante.

### Sauvegarde D1

Après un build, `npm run db:backup` exporte la base D1 locale dans `backups/` (dossier ignoré par Git). Pour une base distante, utiliser explicitement `npm run db:backup -- --remote`; la commande exige l’authentification Wrangler et écrit un fichier horodaté. Ne pas envoyer ces fichiers dans le dépôt : ils peuvent contenir des commandes, des profils clients et des journaux opérationnels. Tester périodiquement une restauration de l’export sur une base isolée, puis exécuter `npm run db:verify` et un scénario de commande/KDS.

Pour valider un export avant restauration, utiliser `npm run db:verify-backup -- --file=backups/nom-du-fichier.sql`. Le fichier doit rester sous `backups/`; le contrôle restaure le SQL en mémoire, active les clés étrangères et échoue si une référence est invalide.

Pour produire une copie locale restaurée et vérifiable sans toucher à la base active, utiliser :

```bash
npm run db:restore-isolated -- --file=backups/nom-du-fichier.sql --output=backups/restore-check.sqlite
```

La commande refuse les chemins hors de `backups/`, une sortie qui existe déjà (sauf avec `--replace`) et une sortie qui n’est pas un fichier SQLite. Elle exécute `integrity_check` et `foreign_key_check`, puis supprime la copie si la restauration échoue. Ouvrir cette copie uniquement pour une recette de contrôle; elle ne remplace pas la restauration D1 de production.

## 7. Validation restante avant une installation de production

Les parcours logiciels principaux sont présents. L’ouverture d’un établissement reste conditionnée aux preuves de la checklist et aux validations suivantes :

- configurer le domaine vérifié, l’onboarding, les utilisateurs, les appareils et les zones postales réelles du site ;
- configurer le compte SMS, l’expéditeur et l’ordonnanceur, puis effectuer un essai contrôlé et rapprocher tout résultat incertain ;
- relier le magasin Uber Eats officiel, tester ses webhooks en sandbox et rapprocher les statuts et montants ;
- installer et éprouver le relais ESC/POS et l’imprimante réellement retenus, avec coupure réseau, reprise et réimpression ;
- intégrer un TPE certifié, valider les remboursements, la conformité française de caisse et les exports comptables ;
- appliquer le MDM aux bornes/tablettes, configurer les sauvegardes distantes et prouver une restauration isolée ;
- réaliser la recette terrain Ronchin puis Tourcoing, avec les données exactes de l’établissement et les équipes formées.
