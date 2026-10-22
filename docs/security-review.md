# Revue de sécurité — état du prototype

Date de revue : 22 octobre 2026. Portée : lecture ciblée du dépôt, correctifs des points prioritaires, tests du projet, lint, vérification TypeScript, build et application des migrations dans SQLite en mémoire. Cette revue ne constitue pas une certification ni une garantie d’absence de failles.

## Correctifs appliqués

- Les codes de connexion par SMS ne sont plus renvoyés par l’API hébergée. En l’absence de fournisseur SMS, l’authentification hébergée échoue proprement; seul un appel local sur loopback peut afficher un code de test.
- Le script de publication ne met plus `SMS_DEMO=1` sur le Worker et n’affiche plus `ADMIN_SETUP_CODE` dans la sortie du déploiement. Il le conserve dans `.env.demo`, ignoré par Git.
- Les liens de désinscription des nouveaux SMS promotionnels portent une preuve HMAC opaque liée au numéro normalisé. Le navigateur reçoit un cookie `HttpOnly`, limité à l’endpoint STOP et valable 30 minutes; l’API compare le numéro à la preuve avant de retirer le consentement.
- La signature STOP a son secret dédié `MARKETING_STOP_SECRET`. Le code admin sert seulement de repli pour les environnements déjà configurés; le script de déploiement crée le secret dédié et le conserve stable entre les mises à jour.
- Le premier flux de commande web attribue explicitement chaque nouvelle commande au tenant `dolce-pizza`, au site actif `ronchin`, au canal `web`, à la livraison `pickup` et au paiement dû au retrait. Les commandes sont refusées si ce site n’est pas actif.
- La migration ajoute des triggers SQLite qui rejettent les nouvelles commandes sans scope ou avec un couple organisation/site invalide. Les listes de créneaux, l’espace équipe, le KDS existant et les modifications d’état sont bornés au site pilote.
- La page `/cuisine` vérifie maintenant aussi le rôle équipe avant d’afficher son interface; l’API garde son contrôle `isAdmin` et son scope Ronchin. Ce rôle reste global et ne suffit pas à autoriser des employés par franchise/site.
- Un automate de production pur et testé séquence Make Line, Four et Expeditor, exige la complétude avant « prête » et vérifie les révisions attendues. Il n’est pas connecté aux routes ni à la persistance; le contrôle superviseur doit être appliqué à partir de l’identité autorisée côté serveur avant toute intégration.

## Limites ouvertes avant une vraie exploitation

1. **Le SaaS multi-tenant n’est pas terminé.** Le schéma contient les organisations, les sites, les memberships et les appareils, mais les anciennes tables de menu, fidélité, utilisateurs, campagnes et réglages restent globales. Les routes ne sont pas toutes filtrées par tenant/site. La démo ne doit pas héberger plusieurs clients réels sur la même base avant de finir cette migration et d’ajouter des tests d’accès croisé.
2. **Les comptes du personnel ne sont pas séparés des comptes clients.** Le rôle admin actuel est global et les sessions sont longues. Il faut introduire des identités d’équipe nominatives, des rôles par établissement, une révocation d’appareil/session et des permissions contrôlées côté serveur avant d’ouvrir les écrans de production à une équipe.
3. **Les anciennes URL `/stop` ne possèdent pas de preuve liée au destinataire.** Les nouveaux SMS contiennent le lien signé; les anciens messages envoyés avec une URL générique ne pourront pas utiliser la validation anonyme sécurisée après le déploiement de ce changement. Prévoir une procédure de support pour les demandes issues d’anciens SMS.
4. **La caisse et le paiement ne sont pas implémentés.** Aucune donnée carte n’est traitée par le prototype. Avant de commercialiser l’encaissement, séparer commande et paiement, tester les annulations/remboursements, et valider la conformité de la version concernée.
5. **Les écrans et la persistance des postes Make Line, Four et Expeditor, le relais hors ligne, les bornes et les connecteurs Uber ne sont pas implémentés.** Seul le modèle de transitions de production est présent. La revue ne couvre pas leurs futurs contrôles d’accès, webhooks ou synchronisation.
6. **L’audit complet des dépendances de développement laisse 8 avis élevés, 0 modéré et 0 critique.** Ils sont propagés par `braces@3.0.3` dans les chaînes ESLint/Vinext; le registre consulté ne publie pas de version corrigée. Les rétrogradations automatiques vers Next 14/Vinext 0.2 ne sont pas compatibles avec le projet, je ne les ai pas appliquées. Les avis modérés liés à `esbuild` sous Drizzle Kit et à `fflate` sous Satori ont été traités par des mises à jour/overrides ciblés et vérifiés. `npm audit --omit=dev` ne trouve aucune vulnérabilité dans l’arbre de production au moment de la revue. Recontrôler ces résultats avant chaque mise en production.
7. **Aucun audit externe, test d’intrusion ou test complet de permissions multi-tenant n’a été réalisé.** Il reste à ajouter ces contrôles avec des données de test et une procédure de rotation des secrets. La revue de code n’est pas une garantie d’absence de failles.

## Vérifications exécutées

- `npm test` : 40 tests passés, 0 échec, dont 8 tests ciblés sur le modèle de production; exécutés après mise à jour de React 19.3.1, Vinext 1.3.0, Vite 8.3.5 et Wrangler 4.151.0.
- `npm run lint` : réussi après les mises à jour.
- `npx tsc --noEmit --incremental false` : réussi après les mises à jour.
- `npm run build` : réussi avec les versions mises à jour; Vinext affiche encore des avertissements de source maps et de classification statique de routes.
- `npm audit --omit=dev` : 0 vulnérabilité.
- `npm audit` : 8 avis élevés propagés par `braces` dans les dépendances de développement; aucun correctif publié n’est disponible à la date du contrôle.
- `npx drizzle-kit check` : réussi après le passage de Drizzle Kit à 0.31.11 et l’override esbuild ciblé.
- Les quatre migrations SQL, y compris les triggers de scope de commande, ont été appliquées dans SQLite en mémoire. Vérifiés : création des sites Ronchin/Tourcoing, refus d’une nouvelle commande sans scope, et refus d’un couple tenant/site incohérent.
- `npm run db:migrate:local` : réussi; la migration `0003_multi_location.sql` a été appliquée à la base D1 locale. Le premier essai depuis le bac à sable était bloqué par son accès réseau local; la relance dans le contexte autorisé a abouti.
