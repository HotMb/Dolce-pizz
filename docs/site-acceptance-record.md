# Dossier de recette d’un établissement

Copier ce modèle dans le dossier privé de recette du site. Ne pas y mettre de secrets, de jetons complets, de données carte ou d’export client non nécessaire. Le dossier doit être conservé avec les preuves du déploiement et rester accessible uniquement aux personnes autorisées.

## 1. Identité du site

| Champ | Valeur |
|---|---|
| Enseigne / organisation |  |
| Établissement / `locationId` |  |
| Adresse et code postal |  |
| Domaine public vérifié |  |
| Version Git / date de déploiement |  |
| Responsable de recette |  |
| Décision | `Go` / `Go limité` / `No-Go` |
| Date de réexamen |  |

## 2. Configuration et isolation

- [ ] Organisation et établissement actifs dans la base attendue.
- [ ] Domaine vérifié par TXT et associé au bon tenant.
- [ ] Horaires, capacité, TVA, carte et allergènes validés par le responsable.
- [ ] Zones postales validées ; aucun routage n’est activé pour une adresse inconnue.
- [ ] Utilisateurs, rôles et appareils affectés au bon établissement.
- [ ] Une commande d’un autre tenant est refusée et n’apparaît pas dans le KDS ni les rapports.
- [ ] Les secrets sont dans le coffre, jamais dans ce dossier.

## 3. Parcours de commande

- [ ] Web à emporter : paiement au retrait, ticket et cycle complet de production.
- [ ] Téléphone / centre d’appel : établissement choisi selon l’adresse, confirmation du mobile et SMS optionnel.
- [ ] Comptoir / POS : cash, carte manuelle ou TPE certifié selon le périmètre autorisé.
- [ ] Borne : commande autonome, reçu et transmission au même KDS.
- [ ] Make Line → Four → Expeditor → Prête vérifié pour une pizza.
- [ ] Boisson ou dessert contrôlé par Expeditor avant « Prête ».
- [ ] Uber Eats, si activé : signature, rejeu, article inconnu et absence de SMS client vérifiés.

## 4. Matériel et pannes

- [ ] Make Line, Four, Expeditor, POS, bornes et relais imprimante enrôlés.
- [ ] Rotation d’un jeton puis révocation testées.
- [ ] Ticket cuisine et reçu client imprimés sur la bonne imprimante.
- [ ] Coupure réseau : le KDS reste consultable et une action obsolète est refusée.
- [ ] Panne imprimante : job `failed` ou `unknown` rapproché manuellement, sans double impression automatique.
- [ ] Panne SMS : file surveillée, aucun numéro ou contenu client dans les journaux.
- [ ] Sauvegarde créée puis restauration isolée vérifiée.

## 5. Encaissement et clôture

- [ ] Shift ouvert par un rôle autorisé.
- [ ] Paiement au retrait limité au solde exact et idempotent.
- [ ] Remboursement local documenté et rattaché au paiement d’origine.
- [ ] Si TPE activé : transaction, annulation, remboursement et rapprochement testés avec le prestataire.
- [ ] Clôture du shift et écart espèces approuvés par le responsable.

## 6. Preuves à conserver

| Preuve | Référence privée | Responsable | Date |
|---|---|---|---|
| Domaine vérifié |  |  |  |
| Migrations / restauration |  |  |  |
| Inventaire matériel |  |  |  |
| Ticket cuisine et reçu test |  |  |  |
| Résultats SMS / impression / Uber / TPE |  |  |  |
| Test d’isolation tenant/site |  |  |  |
| Incident ou anomalie ouverte |  |  |  |

## 7. Signatures

| Rôle | Nom | Signature / date |
|---|---|---|
| Responsable de l’établissement |  |  |
| Responsable technique |  |  |
| Propriétaire de l’enseigne |  |  |

Une décision `Go limité` doit préciser les scénarios exclus, le responsable qui les accepte et une date d’expiration. Une décision `No-Go` bloque l’ouverture du site jusqu’à la fermeture des anomalies critiques.
