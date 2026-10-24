# Accès du personnel par organisation et établissement

L’identité authentifiée est l’identifiant `users.id` fourni par la session SMS existante. Une ligne explicite active dans `organization_memberships` accorde un accès. Le rôle historique global `roles.admin` ne donne aucun accès implicite au KDS. Les organisations et établissements suspendus ou non configurés ne sont jamais exposés par cette API.

| Rôle | Portée valide | Consultation KDS | Actions KDS | Gérer les accès |
| --- | --- | --- | --- | --- |
| `owner` | Organisation, `location_id IS NULL` | Tous les postes | Tous, dont « prête » | Oui |
| `manager` | Établissement | Tous les postes | Tous, dont « prête » | Non |
| `call_center` | Organisation ou établissement | Tous les postes | Aucune | Non |
| `pos`, `viewer` | Établissement | Tous les postes | Aucune | Non |
| `make_line` | Établissement | Préparation | Préparation | Non |
| `oven` | Établissement | Four | Four | Non |
| `expeditor` | Établissement | Expédition | Expédition et « prête » | Non |

Des rôles se cumulent, sans traverser une organisation ou un établissement. Un rôle `manager` à Ronchin n’accorde rien à Tourcoing. Un rôle `owner` attaché à un établissement est invalide. Une attribution de rôle station sans établissement est invalide. Le centre d’appels partagé peut être attribué au niveau organisation par une procédure administrateur; la nouvelle interface accorde uniquement des accès à un établissement.

## Découvrir ses accès

`GET /api/staff`, session requise, réponse `Cache-Control: no-store` :

```json
{
  "account": {"id": "identifiant-du-compte", "name": "Prénom"},
  "scopes": [{
    "organizationId": "dolce-pizza", "organizationName": "Dolce Pizz’",
    "locationId": "ronchin", "locationName": "Ronchin",
    "roles": ["oven"], "stations": ["oven"], "writeStations": ["oven"],
    "canMarkReady": false, "canManageStaff": false
  }],
  "roles": [{"id": "oven", "label": "Four"}]
}
```

La liste `roles` contient tous les choix accordables (`manager`, `call_center`, `pos`, `make_line`, `oven`, `expeditor`, `viewer`). Une personne connectée sans attribution reçoit `scopes: []` et son propre identifiant; elle peut le communiquer au propriétaire sans exposer de numéro de téléphone. Cette route ne recherche pas de compte par téléphone et n’expose aucun téléphone.

`GET /api/staff?organizationId=dolce-pizza&locationId=ronchin&members=1` nécessite le rôle propriétaire actif de cette organisation et un établissement actif. La réponse ajoute `members: [{id, principalId, name, role, status, locationId}]`, avec les accès de cet établissement et les accès partagés `owner`/`call_center` de l’organisation (`locationId: null`). Ces derniers sont protégés et ne sont pas révocables par cette route. `truncated: true` signale une limite de 500 résultats. Les autres organisations et établissements sont exclus.

## Accorder et retirer un rôle

`POST /api/staff`, JSON, en-tête `Origin` égal à celui du site, corps maximal de 4 000 octets, propriétaire actif uniquement. Aucun paramètre de recherche n’est accepté.

```json
{"action":"grant","organizationId":"dolce-pizza","locationId":"ronchin","principalId":"identifiant-du-compte","role":"oven"}
```

Le compte cible doit déjà exister. Aucun propriétaire ni rôle au niveau organisation ne peut être accordé par cette route. L’identifiant d’attribution `staff:<sha256>` dérive des quatre valeurs organisation, établissement, principal et rôle sérialisées en JSON, ce qui rend les répétitions idempotentes et évite les ambiguïtés de séparateurs. Les attributions historiques déjà présentes sont réutilisées. Une attribution révoquée peut être réactivée.

```json
{"action":"revoke","organizationId":"dolce-pizza","locationId":"ronchin","membershipId":"identifiant-de-l-attribution"}
```

Seuls les accès à cet établissement peuvent être révoqués. Les propriétaires et accès partagés sont protégés. Répéter une révocation laisse l’accès révoqué. Chaque demande autorisée laisse une trace dans `staff_audit`, sans téléphone ni nom. Le contrôle du propriétaire et des statuts actifs est répété dans le lot transactionnel D1 avant la mutation et son audit. L’échec de la trace annule la mutation.

## Production

`GET /api/production?organizationId=…&locationId=…&station=oven` renvoie `{orders, scope}` après vérification du droit de lecture sur ce poste. `POST /api/production?organizationId=…&locationId=…` conserve le corps strict existant (`action`, `orderId`, `itemId` selon action, `station`, `expectedRevision`). La portée n’est jamais acceptée dans ce corps. Lorsque les deux identifiants de portée sont absents, la portée historique `dolce-pizza/ronchin` est utilisée, avec les mêmes exigences de rôle explicite. Fournir un seul identifiant ou des identifiants répétés est invalide.

Les actions de station et « prête » exigent leur droit distinct. Le contrôle d’accès figure également dans le `UPDATE` atomique du ticket pour empêcher une écriture mise en attente après révocation d’accès ou suspension d’établissement. La commande et le ticket sont toujours recherchés par organisation ET établissement. Les conflits de révision restent retournés en `409`.

## Migration requise

Le schéma de trace ci-dessous doit être présent avant d’utiliser les mutations. Il ne modifie aucun compte automatiquement. L’initialisation du propriétaire Dolce Pizz’ est une migration unique distincte, revue et versionnée; elle ne doit pas devenir une règle d’autorisation dynamique fondée sur `roles.admin`.

```sql
CREATE TABLE staff_audit (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  actor_principal_id TEXT NOT NULL,
  target_principal_id TEXT NOT NULL,
  role TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, location_id)
    REFERENCES locations(organization_id, id)
);
CREATE INDEX staff_audit_scope_created
  ON staff_audit(organization_id, location_id, created_at);
```

La session SMS actuelle reste une session de compte. `POST /api/staff/sessions` permet au propriétaire de révoquer immédiatement toutes les sessions navigateur d’un compte actif dans son établissement (`organizationId`, `locationId`, `principalId`). La cible doit être un accès local ou centre d’appels actif; le propriétaire ne peut pas révoquer sa propre session par cette route. La mutation est enregistrée dans `staff_audit` et ne supprime aucun compte ni aucune attribution. La distinction des durées client/personnel et l’authentification renforcée restent des travaux d’exploitation distincts. L’ancien back-office global ne constitue pas une interface SaaS isolée; ses accès doivent rester réservés au pilote tant que son propre cloisonnement n’est pas livré.

## Établissements

`GET /api/admin/locations?organizationId=…` liste les sites de l’enseigne du propriétaire connecté. `POST /api/admin/locations` ajoute un site actif avec `organizationId`, `locationId`, `locationCode`, nom, adresse, code postal français, localité et téléphone français. La route crée aussi la configuration locale par défaut; elle ne crée pas de nouveau tenant et ne rend pas automatiquement une zone de livraison éligible. `GET /api/staff/routing?organizationId=…&locationId=…` lit les zones du site ciblé; `POST /api/staff/routing` remplace atomiquement sa liste de codes postaux et sa priorité. Les codes sont donc configurés séparément, avec la même portée organisation/site.
