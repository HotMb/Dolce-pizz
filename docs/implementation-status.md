# État des exigences du produit complet

Ce suivi conserve le périmètre demandé : un POS/KDS SaaS commercialisable auprès de plusieurs enseignes et établissements en France. Un composant livré ne prouve pas que le produit complet est exploitable. Les commandes directes du pilote sont à retirer et payer sur place; aucune livraison maison n’est prévue. Uber Eats reste un canal partenaire distinct.

| Exigence | État actuel et preuve | Travail restant pour la cible |
|---|---|---|
| Commande web | Parcours Ronchin, prix serveur, créneaux, suivi, fidélité, commande idempotente; routes réelles éprouvées par `tests/staff-order-integration.test.ts` | Choix public multi-sites, menu et comptes clients isolés par enseigne |
| KDS Make Line, Four, Expeditor | Tickets et événements persistés, contrôle de complétude, révision, snapshots/allergènes, écrans tactiles; tests métier et API | Pilote terrain, reprise matérielle, mesure des durées, supervision et validation des imprimantes |
| Personnel et permissions | `/equipe`, adhésions actives, station/site/org, audit des attributions/retraits, garde SQL après révocation; tests `staff-access` et intégration | Enrôlement des appareils, sessions de personnel adaptées aux postes partagés, authentification renforcée, récupération/transfert du propriétaire |
| Plusieurs établissements | KDS et consommateur SMS sélectionnent et filtrent le scope; Ronchin actif, Tourcoing non configuré | Adresse/horaires/zone Tourcoing vérifiés, réglages/menu par site, provisionnement et déploiement des deux sites |
| Isolation SaaS complète | Organisations/sites/contraintes et autorisations staff/KDS présentes | Menu, réglages, comptes clients, fidélité, campagnes, photos, rapports et anciens endpoints encore globaux; ne pas accueillir plusieurs clients réels sur cette base |
| POS comptoir | Écran `/equipe/commande` pour comptoir, avec carte, composition, allergènes, offre menu, créneaux et récapitulatif; prix recalculé serveur, commande idempotente envoyée à la production, paiement dû au retrait; test SQLite `tests/staff-orders.test.ts` | Encaissement au comptoir, gestion de caisse/shift, TPE, tickets imprimés et menu isolé par établissement |
| POS mobile | Aucun écran salle/table n’est livré | Tables, service à table, transfert de commande et notifications du personnel |
| Centre d’appels | Même écran de prise de commande avec canal téléphone, mobile facultatif et retrait; le code postal n’aide pas encore à choisir un établissement | Règles de zones par code postal, Tourcoing configuré, routage/confirmation serveur, recherche client autorisée et traçabilité d’appel |
| Deux bornes client | Menu/commande web réutilisables; rôle d’appareil prévu dans le schéma | Mode autonome sans session client partagée, panier par visite, téléphone facultatif, reset et commande invité sécurisée, impression |
| Encaissement au retrait | État `due_at_pickup`, aucun enregistrement de données carte | Journal de caisse, taxes par catégorie, TPE/adaptateur fournisseur, paiements espèces/carte, erreurs et reprises, remboursements, shifts/clôture, conformité française de la version |
| SMS « commande prête » | Outbox transactionnelle et consommateur sécurisé, bail/CAS, contrôles de contact et fraîcheur, retries429, mode dryRun; tests transport simulé et SQL réels | Secrets fournisseur/ordonnanceur et essai contrôlé réel; délivrabilité, écran de réconciliation, expéditeur par enseigne et suivi opérateur |
| Marketing et fidélité | Consentement et STOP signé, campagnes et ledger existants | Isolation par enseigne, conservation/suppression, validation d’exploitation et mesure du programme |
| Uber Eats/agrégateurs | Architecture adaptateur décrite; aucun connecteur actif | Accès partenaire, mapping stores, webhooks signés, inbox dédupliquée, acceptation/refus, rapprochement, essais sandbox et terrain |
| Imprimantes et matériel | Mise en page ticket navigateur, guide réseau et profils tablette | Spooler local, protocole/modèle matériel, ACK/réimpression tracée, TPE et installation physique |
| Hors ligne et temps réel | Polling quatre secondes KDS, lecture seule explicite en perte réseau | Relais local durable, événements/synchronisation, conflits, reprise et fenêtres de données; SSE/WebSocket après mesure |
| Orchestration prédictive/IA | Priorité par état, créneau promis et création; aucune IA décisionnelle | Charge par poste, temps standards, prévisions calibrées et explicables, validation des suggestions par responsable |
| Back-office enseigne/franchise | Modèle organisation/site, gestion des accès KDS | Menu maître versionné, délégation prix, disponibilité par site, rapports consolidés et gouvernance tenant |
| Installation/exploitation | Guides architecture, installation, notifications, offre et sécurité dans `docs/` | Automatisation des environnements, sauvegarde/restauration éprouvée, monitoring, journal d’incident, objectifs de reprise et support |
| Identité du code et publication | `main` commence par `Build Dolce Pizz online ordering site`; les identifiants applicatifs sont `dolce-pizza`/`ronchin` et le script cible `dolce-pizz-demo`. Le projet Sites est nommé « Pizza Delizio — Commande & fidélité » parce qu’il s’agit du clone de travail confirmé par l’utilisateur. | Garder la progression dans `codex/dolce-pos-saas-foundation`; vérifier séparément toute publication du Worker public |
| Git et sécurité | Branche locale `codex/dolce-pos-saas-foundation`; revue indépendante, tests négatifs et tests d’intégration des handlers réels | Push distant à confirmer lorsque le serveur Git sera joignable; tests d’intrusion, audit des dépendances actualisé et revue de toute nouvelle frontière |

## Jalon accès et notifications

La migration `0005_staff_and_notifications.sql` ajoute l’audit du personnel, le contact de notification figé sur la commande et les métadonnées du consommateur SMS. Les anciens administrateurs du pilote deviennent propriétaires explicites de Dolce Pizz’; les anciennes commandes ne reçoivent aucune confirmation de numéro inventée. Les installations neuves provisionnent leur premier propriétaire par le code d’installation privé.

La suite de 67 tests comprend des tests de véritables handlers HTTP exécutant le SQL contre SQLite en mémoire : connexion OTP locale sans fournisseur, activation propriétaire, droits d’un équipier Four, refus entre sites/organisations/postes, révocation, commande web idempotente, isolement des commandes staff, limites de capacité avec formats de créneaux historiques, parcours complet Make Line/Four/Expeditor, outbox unique pour la transition, dryRun sans envoi et migration d’un pilote existant. Les essais de fournisseur utilisent un transport fictif; aucun SMS réel n’a été envoyé.

## Suite prioritaire

Construire la création canonique des commandes pour le comptoir, le centre d’appels et les bornes avec contacts facultatifs et contexte de canal. Migrer en parallèle menu/réglages/clients/fidélité vers le tenant/site avant d’ouvrir de nouveaux tenants. Le paiement, les équipements et les partenaires requièrent leurs adaptateurs, accès et essais; ils restent dans le périmètre du produit complet.
