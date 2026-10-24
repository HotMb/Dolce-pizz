# Plan de test commercial POS/KDS

Ce plan sert à valider une nouvelle pizzeria avant son ouverture. Les tests automatisés ne remplacent pas la recette sur les appareils, les paiements et les fournisseurs réels.

## 1. Vérifications automatiques

Depuis un checkout propre avec Node 22 ou supérieur :

```text
npm ci
npm test
npx tsc --noEmit --pretty false --incremental false
npm run db:verify
npm run security:scan
npm audit --omit=dev --audit-level=high
npm run build
git diff --check
```

Résultats attendus : tests verts, aucune erreur TypeScript, migrations cohérentes, aucun secret détecté, aucune vulnérabilité de production de niveau high ou critical et build terminé.

## 2. Isolation multi-tenant

Créer deux organisations de test et deux établissements distincts. Vérifier :

- une commande d’un tenant n’apparaît pas dans le KDS, les clients, la fidélité, les campagnes, les rapports ou les audits de l’autre tenant ;
- un membre d’un établissement ne peut pas lire ou modifier l’autre établissement ;
- un jeton d’appareil, un domaine, un SKU, une photo, une zone postale, un paiement, un shift et un job d’impression restent dans leur scope ;
- les rapports consolidés sont réservés au propriétaire et ne contiennent pas de téléphone ou de nom client ;
- la révocation d’un membre ou d’un appareil prend effet à la prochaine requête.

Conserver la sortie de `tests/staff-order-integration.test.ts`, `tests/staff-access.test.ts` et `tests/tenant-context.test.ts` dans la preuve de recette.

## 3. Parcours de commande

Pour chaque canal — web, téléphone, comptoir/POS, borne et Uber Eats si activé — exécuter :

1. créer une commande à emporter avec un créneau valide ;
2. vérifier le prix serveur, les modificateurs, allergènes et le contact SMS confirmé ;
3. suivre **Make Line → Four → Expeditor → Prête** ;
4. confirmer qu’une boisson ou un dessert bloque « Prête » jusqu’à validation Expeditor ;
5. vérifier le ticket cuisine et le reçu client ;
6. encaisser exactement le solde au retrait ;
7. clôturer le shift et rapprocher les espèces.

Une commande Uber ne doit jamais déclencher le SMS Dolce. Un client sans numéro ne reçoit aucun SMS et conserve son ticket papier.

## 4. Pannes et reprises

- couper le réseau d’une tablette : la dernière vue reste disponible en lecture seule ; une action obsolète est refusée ;
- couper l’imprimante : le job passe en erreur ou résultat inconnu, sans double impression automatique ;
- arrêter le relais SMS : la notification reste dans l’outbox et est réconciliable ;
- expirer un bail de notification ou d’impression : la ligne est récupérée sans renvoi aveugle ;
- restaurer une sauvegarde dans une base isolée et vérifier `PRAGMA foreign_key_check` ;
- révoquer puis renouveler un jeton d’appareil.

## 5. Fournisseurs réels

### SMS

Utiliser un numéro interne de test, vérifier le contenu, le STOP, le journal sans PII et l’absence d’envoi pour Uber ou sans contact.

### TPE

Tester capture, timeout, résultat inconnu, annulation, remboursement et rapprochement. Le POS ne reçoit jamais PAN ou CVV.

### Uber Eats

Tester signature, rejeu, SKU inconnu, acceptation/refus, statut externe, annulation et rapprochement. Utiliser le [runbook de rétablissement](./uber-recovery-runbook.md) si la fiche est visible mais que les commandes ne sont plus acceptées.

## 6. Critère de décision

- **Go** : tous les tests critiques sont prouvés sur le déploiement et les appareils réels.
- **Go limité** : pilote interne avec fournisseurs simulés, responsable et date d’expiration.
- **No-Go** : isolation non prouvée, sauvegarde non restaurable, paiement ambigu non rapproché, appareil non révocable ou commande non visible dans le KDS.

Archiver les résultats dans [site-acceptance-record.md](./site-acceptance-record.md), sans secrets, PAN/CVV, jetons complets ni export client inutile.
