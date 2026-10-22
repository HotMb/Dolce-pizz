# Revue de sécurité — état du prototype

Date de revue : 22 octobre 2026. Portée : revue ciblée des comptes, de l’API et des données KDS; correctifs du pilote; tests, lint, TypeScript, build et application des migrations dans SQLite en mémoire. Cette revue ne constitue pas une certification ni une garantie d’absence de failles.

## Correctifs appliqués

- Les codes de connexion par SMS ne sont plus renvoyés par l’API hébergée. En l’absence de fournisseur SMS, l’authentification hébergée échoue proprement; seul un appel local sur loopback peut afficher un code de test.
- Le script de publication ne met plus `SMS_DEMO=1` sur le Worker et n’affiche plus `ADMIN_SETUP_CODE` dans la sortie du déploiement. Il le conserve dans `.env.demo`, ignoré par Git.
- Les liens de désinscription des nouveaux SMS promotionnels portent une preuve HMAC opaque liée au numéro normalisé. Le navigateur reçoit un cookie `HttpOnly`, limité à l’endpoint STOP et valable 30 minutes; l’API compare le numéro à la preuve avant de retirer le consentement.
- La signature STOP a son secret dédié `MARKETING_STOP_SECRET`. Le code admin sert seulement de repli pour les environnements déjà configurés; le script de déploiement crée le secret dédié et le conserve stable entre les mises à jour.
- Le premier flux de commande web attribue explicitement chaque nouvelle commande au tenant `dolce-pizza`, au site actif `ronchin`, au canal `web`, à la livraison `pickup` et au paiement dû au retrait. Les commandes sont refusées si ce site n’est pas actif.
- La migration ajoute des triggers SQLite qui rejettent les nouvelles commandes sans scope ou avec un couple organisation/site invalide. Les listes de créneaux, l’espace équipe, le KDS existant et les modifications d’état sont bornés au site pilote.
- `/cuisine` redirige vers `/production`; l’API KDS exige toujours une session administrateur et impose le scope Dolce Pizz’/Ronchin côté serveur. Les transitions passent par un automate persistant Make Line/Four/Expeditor avec comparaison de révision. L’ancien endpoint admin refuse désormais `ready` et `completed` pour empêcher le contournement de l’Expeditor ou l’enregistrement d’un retrait sans paiement.
- Une revue a montré que les contrôles d’allergènes et de routage étaient initialement seulement visuels. L’API vérifie maintenant ces snapshots avant chaque action d’article et avant « prête ». Les anciennes commandes sans données confirmées restent bloquées pour revue menu; aucun contournement superviseur n’est encore fourni.
- Tickets, événements et outbox ont maintenant une clé étrangère composite vers la commande correspondant au même tenant et site; la base rejette les associations croisées même si une future route construit un mauvais scope.
- Le ticket KDS ne renvoie ni nom ni téléphone client. Les téléphones français et formats courants d’adresses sont masqués dans la note libre, mais cette détection reste heuristique. La notification SMS est seulement inscrite dans une outbox durable; aucun worker ne la consomme encore.

## Limites ouvertes avant une vraie exploitation

1. **Le SaaS multi-tenant n’est pas terminé.** Le schéma contient les organisations, les sites, les memberships et les appareils, mais les anciennes tables de menu, fidélité, utilisateurs, campagnes et réglages restent globales. Les routes ne sont pas toutes filtrées par tenant/site. La démo ne doit pas héberger plusieurs clients réels sur la même base avant de finir cette migration et d’ajouter des tests d’accès croisé.
2. **Les comptes du personnel ne sont pas séparés des comptes clients.** Le rôle admin actuel est global et les sessions sont longues. Il faut introduire des identités d’équipe nominatives, des rôles par établissement, une révocation d’appareil/session et des permissions contrôlées côté serveur avant d’ouvrir les écrans de production à une équipe.
3. **Les anciennes URL `/stop` ne possèdent pas de preuve liée au destinataire.** Les nouveaux SMS contiennent le lien signé; les anciens messages envoyés avec une URL générique ne pourront pas utiliser la validation anonyme sécurisée après le déploiement de ce changement. Prévoir une procédure de support pour les demandes issues d’anciens SMS.
4. **La caisse et le paiement ne sont pas implémentés.** Aucune donnée carte n’est traitée par le prototype. Avant de commercialiser l’encaissement, séparer commande et paiement, tester les annulations/remboursements, et valider la conformité de la version concernée.
5. **Le KDS est un pilote à un seul établissement, pas un produit fini.** L’identité admin est globale, pas rattachée à une adhésion active ni à un appareil/poste. Le POS, l’encaissement au retrait, le SMS transactionnel, le relais hors ligne, les bornes, le centre d’appels et Uber Eats restent à intégrer; leurs futurs contrôles d’accès, webhooks et synchronisation ne sont pas couverts.
6. **Dépendances : contrôle réseau indisponible pendant cette vérification.** Le dernier audit réussi du dépôt indiquait 0 avis dans les dépendances de production et 8 avis élevés propagés par `braces@3.0.3` dans ESLint/Vinext; aucun correctif publié n’était alors disponible. Les avis modérés liés à `esbuild` et `fflate` avaient été traités par des overrides ciblés. La nouvelle commande `npm audit --omit=dev` n’a pas pu interroger `registry.npmjs.org` (`ENOTFOUND`); elle ne confirme donc pas l’état actuel. Recontrôler depuis un environnement avec accès au registre avant mise en production.
7. **Aucun audit externe, test d’intrusion ou test complet de permissions multi-tenant n’a été réalisé.** Il reste à ajouter ces contrôles avec des données de test et une procédure de rotation des secrets. La revue de code n’est pas une garantie d’absence de failles.

## Vérifications exécutées

- `npm test` : 45 tests passés, 0 échec, dont les tests du flux de production, des snapshots et du contrôle allergènes/routage côté serveur.
- `npm run lint` : réussi après les mises à jour.
- `npx tsc --noEmit --incremental false` : réussi après les mises à jour.
- `npm run build` : réussi avec les versions mises à jour; Vinext affiche encore des avertissements de source maps et de classification statique de routes.
- `npm audit --omit=dev` : non vérifiable pendant cette passe, car le bac à sable n’a pas pu joindre le registre npm. Voir le dernier résultat connu au point 6.
- `npx drizzle-kit check` : réussi après le passage de Drizzle Kit à 0.31.11 et l’override esbuild ciblé.
- Les cinq migrations SQL ont été appliquées dans SQLite en mémoire. Vérifiés : intégrité des clés étrangères et rejet d’un ticket lié à une commande d’un autre site.
- `npm run db:migrate:local` : migration `0004_production.sql` appliquée à la base D1 locale de développement. Le premier lancement dans le bac à sable a échoué sur `fetch failed`; relancé dans le contexte local autorisé, il a réussi.
