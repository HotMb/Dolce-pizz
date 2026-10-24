# Feuille de route de livraison POS/KDS SaaS

Cette feuille de route définit les phases de mise en service pour Dolce Pizz’ puis pour chaque nouvelle enseigne. Une phase n’est considérée comme terminée que si la preuve indiquée est conservée dans le dossier de recette de l’établissement.

## État vérifié du dépôt

| Phase | État | Preuve actuelle | Condition de sortie restante |
|---|---|---|---|
| 0 — Socle et isolation | **Passée côté logiciel** | 82 tests, 31 migrations, contrôles tenant/site/rôle/appareil et scans de sécurité | Rejouer la recette sur le déploiement D1 réel |
| 1 — Pilote Ronchin | **Go limité** | Parcours web, téléphone, POS, borne, Make Line, Four, Expeditor et caisse simulés dans SQLite | Données terrain, appareils enrôlés, TPE certifié et coupure réseau réelle |
| 2 — Notifications et impression | **Logiciel prêt, exploitation non validée** | Outbox SMS/impression, leases, réconciliation et relais HTTPS documentés | Brevo, ordonnanceur, imprimante et essais réels |
| 3 — Centre d’appels et second site | **Infrastructure prête, site incomplet** | Routage postal et isolation multi-site testés | Coordonnées et zones réelles de Tourcoing, puis recette indépendante |
| 4 — Agrégateurs et comptabilité | **Connecteur préparé** | Webhook Uber signé, idempotent et rejouable ; paiements locaux audités | Accès partenaire, sandbox, statuts externes et rapprochement comptable |
| 5 — Produit SaaS | **Socle commercial prêt, publication en attente** | Onboarding propriétaire, domaines vérifiés, catalogue local, sauvegarde isolée et préflight | URL du dépôt source, déploiement, DNS, secrets et checklist signée |

## Phase 0 — Socle logiciel et isolation

**Objectif :** rendre impossible le mélange entre enseignes, établissements, postes et rôles.

**Livré dans le dépôt :** organisations et établissements tenant-scopés, migrations versionnées, domaines vérifiés par TXT, rôles staff, appareils enrôlés, garde SQL et tests d’accès croisé.

**Sortie de phase :**

- `npm test` vert ;
- `npm run db:verify` vert ;
- une commande de deux tenants et un accès d’un autre établissement sont refusés ;
- aucun secret, token d’appareil ou numéro client n’apparaît dans les journaux.

## Phase 1 — Pilote Ronchin en retrait

**Objectif :** faire fonctionner le parcours réel sans livraison maison : web, téléphone, comptoir, borne, Make Line, Four, Expeditor, caisse et retrait.

**Sortie de phase :**

- adresse, téléphone, horaires, capacité et carte de Ronchin validés par le responsable ;
- chaque appareil est enrôlé, testé, puis révoqué et renouvelé sur un appareil de recette ;
- une commande de chaque canal traverse le cycle Make Line → Four → Expeditor → Prête ;
- le paiement cash est rapproché à la clôture du shift ;
- le paiement carte est accepté seulement après validation du TPE choisi ;
- une coupure réseau prouve que le KDS reste consultable et qu’aucune action obsolète n’est appliquée silencieusement.

## Phase 2 — Notifications, impression et exploitation

**Objectif :** supprimer les opérations manuelles répétitives tout en conservant une reprise sûre.

**Sortie de phase :**

- compte SMS, expéditeur, quotas et ordonnanceur configurés ;
- `npm run notifications:dispatch -- --dry-run` puis un essai réel contrôlé ;
- un SMS « commande prête » est envoyé uniquement avec un contact confirmé ;
- un client Uber ou sans numéro ne reçoit aucun SMS ;
- imprimante et relais ESC/POS testés avec panne réseau et résultat inconnu ;
- les notifications et impressions ouvertes sont surveillées dans `/equipe/sante`.

## Phase 3 — Centre d’appels et second établissement

**Objectif :** activer Tourcoing sans réutiliser les réglages de Ronchin.

**Données obligatoires avant ouverture :** adresse exacte, téléphone, code postal de retrait, horaires, capacité, zones de routage et carte validée.

**Sortie de phase :**

- l’adresse du client propose le bon établissement et le personnel confirme explicitement le choix ;
- une commande Tourcoing n’apparaît jamais dans le KDS ou les rapports Ronchin ;
- les prix, disponibilités et horaires locaux sont testés séparément ;
- le centre d’appels peut rechercher un client uniquement dans son enseigne ;
- les rapports agrégés par établissement sont exportés sans PII.

## Phase 4 — Agrégateurs et comptabilité

**Objectif :** brancher les services externes après validation du parcours interne.

**Sortie de phase :**

- accès partenaire Uber Eats validé par magasin ;
- signature, idempotence, rejeu, acceptation/refus et statuts externes testés en sandbox ;
- les SKU inconnus restent bloqués avant production ;
- les paiements et remboursements du prestataire sont rapprochés avec les shifts ;
- les exports comptables et la procédure de correction sont approuvés.

## Phase 5 — Produit SaaS commercialisable

**Objectif :** déployer une nouvelle enseigne sans modifier le code du pilote.

**Sortie de phase :**

- onboarding contrôlé, domaine vérifié et propriétaire créé ;
- carte maître, surcharges locales, fidélité et campagnes isolées ;
- appareils et rôles provisionnés par établissement ;
- sauvegarde distante restaurée sur une base isolée ;
- préflight production, audit npm complet, scan secrets et vérification HTTP réussis ;
- checklist [`go-live-checklist.md`](./go-live-checklist.md) signée et décision Go ou Go limité.

## Règle de décision

- **Go limité :** pilote interne, données de test ou paiements/SMS simulés, responsable et date de fin définis.
- **Go :** toutes les preuves critiques des phases 0 à 3 sont réunies et les fournisseurs utilisés sont validés.
- **No-Go :** données réelles sans sauvegarde restaurable, domaine non vérifié, appareil sans credential valide, isolation non prouvée ou paiement non rapproché.

Les secrets, adresses réelles et exports de base restent dans le coffre et le dossier de recette ; ils ne sont jamais ajoutés au dépôt Git.
