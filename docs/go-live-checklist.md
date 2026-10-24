# Checklist de mise en production — POS/KDS Dolce Pizz’

Cette checklist doit être remplie pour **chaque enseigne et chaque établissement**. Une case cochée doit renvoyer à une preuve conservée dans le dossier de recette : sortie de commande, capture, export ou signature du responsable.

## 1. Tenant et données

- [ ] L’organisation possède un identifiant stable et un propriétaire confirmé.
- [ ] Chaque établissement possède une adresse, un téléphone, un statut actif et un code postal vérifié.
- [ ] Les codes postaux de retrait et le routage du centre d’appels sont validés par le responsable.
- [ ] Le domaine public est vérifié par TXT DNS puis présent dans `TENANT_HOSTS_JSON` ou `tenant_domains` avec le statut `verified`.
- [ ] `npm run db:verify` est vert et une sauvegarde D1 distante a été exportée puis vérifiée avec `npm run db:verify-backup`.
- [ ] Une commande de test confirme qu’aucun catalogue, client, point ou rapport d’un autre tenant n’est visible.

## 2. Comptes, appareils et postes

- [ ] Chaque membre du personnel utilise son propre compte et son rôle est limité à l’établissement nécessaire.
- [ ] Les appareils Make Line, Four, Expeditor, POS, bornes et relais imprimante sont enrôlés dans le bon établissement.
- [ ] Chaque jeton a été copié une seule fois, rangé hors ticket et testé avec `bootstrap` puis `heartbeat`.
- [ ] Les appareils sont verrouillés par MDM ou navigateur dédié quand ils sont en libre-service.
- [ ] Une révocation et une rotation ont été testées sur un appareil de recette.
- [ ] Aucun appareil n’apparaît comme expiré, bientôt expiré ou hors ligne dans `/equipe/sante`.

## 3. Parcours métier

- [ ] Une commande web, téléphone, comptoir, POS et borne suit le même cycle Make Line → Four → Expeditor → Prête.
- [ ] Les boissons et desserts convergent bien vers l’Expeditor.
- [ ] Une commande Uber Eats de test reste séparée du parcours SMS client.
- [ ] Une commande sans numéro n’envoie aucune notification et imprime le ticket prévu.
- [ ] Le paiement au retrait accepte cash et carte, refuse le dépassement du solde et reste idempotent.
- [ ] Un remboursement local est audité et son rapprochement avec le TPE est documenté.
- [ ] Une coupure réseau affiche la dernière vue KDS sans autoriser une écriture locale non vérifiée.

## 4. Fournisseurs et matériel

- [ ] Le compte SMS Brevo, l’expéditeur, les quotas, l’ordonnanceur et le webhook de statut sont configurés.
- [ ] Le TPE certifié, son adaptateur, les captures, erreurs, remboursements et rapprochements ont été testés avec le prestataire.
- [ ] L’imprimante et le relais ESC/POS ont été testés avec un ticket réel et une panne réseau simulée.
- [ ] Les accès partenaire Uber Eats, les accusés, acceptations/refus, statuts et rapprochements financiers sont validés.
- [ ] Les bornes et tablettes ont une alimentation, un réseau et un plan de remplacement documentés.

## 5. Sécurité et exploitation

- [ ] `npm run security:scan` et `npm run db:verify` sont verts.
- [ ] `npm run preflight:production` est exécuté dans un checkout propre avec les secrets du coffre.
- [ ] `npm run security:http -- --url=https://<domaine>` confirme les en-têtes HTTP sur le domaine public; un résultat négatif signifie que le Worker servi n’est pas synchronisé avec la branche et doit être republié avant toute ouverture.
- [ ] Les procédures de perte de jeton, panne SMS, panne imprimante, panne TPE et indisponibilité D1 ont été répétées.
- [ ] Le responsable sait clôturer un shift, exporter les agrégats et ouvrir un incident sans copier de PII ou de secret.
- [ ] Les objectifs de reprise, la fréquence des sauvegardes et le contact d’astreinte sont écrits et acceptés.

## Décision

- **Go** : toutes les cases critiques des sections 1, 2, 3 et 5 sont prouvées; les fournisseurs de la section 4 sont certifiés ou explicitement hors périmètre.
- **Go limité** : uniquement pilote interne, sans argent réel ni SMS réel, avec date d’expiration et responsable désigné.
- **No-Go** : domaine non vérifié, appareil sans credential valide, isolation tenant non prouvée, paiement réel non rapproché ou sauvegarde non restaurable.
