# SMS « commande prête »

Le poste Expeditor crée un événement durable `order_ready` dans `notification_outbox`. Le consommateur interne transforme cet événement en un SMS de service, sans contenu commercial. Il fonctionne pour plusieurs organisations et établissements, à partir du périmètre porté par chaque événement. Il ne reçoit jamais de destinataire, de texte de SMS ou de périmètre depuis l'appelant.

## Conditions avant envoi

Le consommateur relit la commande, le ticket et l'établissement immédiatement avant l'appel au fournisseur. La commande et le ticket doivent être `ready`, appartenir à la même organisation et au même établissement que l'événement, et l'organisation et l'établissement doivent être actifs en France. Il faut une adresse complète et un numéro de ticket valide. L'événement doit dater de deux heures au maximum, avec une date ISO valide et non future : un arrêt prolongé du consommateur ne déclenche pas des notifications périmées à sa reprise (`skipped`, code `notification_expired`).

Seules les commandes directes à emporter (`web`, `phone`, `pos`, `kiosk`, `counter`) sont admissibles. Uber Eats, les autres canaux externes, les commandes annulées ou déjà retirées et les commandes sans mobile confirmé sont ignorés. Le consentement marketing ne conditionne pas cette notification de service.

Le mobile français 06/07 est capturé spécifiquement sur la commande, avec `notification_phone`, `notification_phone_basis` et `notification_phone_captured_at`. Les bases autorisées sont `account_otp` (numéro du compte authentifié par SMS à la commande) et `staff_confirmed` (case de confirmation explicite dans le POS ou le centre d’appel). Le numéro capturé doit correspondre à celui de la commande. Pour `account_otp`, le compte doit encore porter ce même numéro. Pour `staff_confirmed`, le personnel doit saisir un mobile français valide et confirmer l’accord du client dans l’écran de commande; une commande sans mobile ou sans confirmation reste sans SMS. Les anciennes commandes ne sont pas déclarées confirmées par migration.

Le texte inclut le nom, l'adresse et le numéro de ticket de l'établissement. Il ne contient ni le nom du client, ni les articles, ni une offre commerciale. Les champs établissement sont bornés et les caractères de contrôle sont refusés. Un SMS long ou Unicode peut être facturé en plusieurs segments : contrôler le texte de l'établissement et le tarif du compte avant activation.

## Configuration

Appliquer d'abord les migrations contenant les champs de contact de commande et les métadonnées d'outbox. Configurer, dans le gestionnaire de secrets du déploiement :

- `NOTIFICATION_DISPATCH_SECRET` : secret aléatoire de 32 à 256 caractères ASCII sans espace, distinct des autres secrets de l'application; une valeur aléatoire de 32 octets encodée en base64url convient.
- `BREVO_API_KEY` : clé du compte Brevo autorisé et approvisionné pour les SMS transactionnels.
- `SMS_SENDER` : identifiant alphanumérique accepté par le compte et les opérateurs, de 1 à 11 caractères, commençant par une lettre; valeur par défaut `DolcePizz`.
- `NOTIFICATION_SCHEDULER_CONFIGURED=1` : déclaration explicite, posée seulement après avoir installé et testé le cron ou le job qui appelle le relais HTTPS. La présence du secret seule ne prouve pas qu’un ordonnanceur fonctionne.

Le consommateur n'envoie rien sans clé fournisseur valide. Les options de simulation des campagnes marketing et le mode local ne simulent jamais un envoi réel de ce consommateur. Aucun secret ni aucune configuration de fournisseur n'est créé par le code ou par les tests.

## Vérifier sans envoyer de SMS

Après configuration du seul secret interne, appeler `POST /api/internal/notifications` avec l'en-tête `Authorization: Bearer <secret>` et `Content-Type: application/json`, puis le corps :

```json
{"dryRun":true}
```

Ce mode lit au maximum cinq événements en attente et renvoie seulement des compteurs. Il ne réclame aucun événement, ne modifie aucun statut et n'appelle pas Brevo; la clé fournisseur peut être absente. `eligible` indique le nombre qui satisfait les contrôles au moment de la lecture. Il ne valide ni le crédit, ni l'expéditeur, ni la délivrabilité opérateur. La réponse ne contient aucun téléphone, adresse ou identifiant de commande.

Pour vérifier le parcours, créer une commande de test avec un mobile de test confirmé, terminer Make Line, Four et Expeditor, puis contrôler le compteur `eligible` avec ce mode. Aucun SMS réel n'est envoyé par les tests automatiques : leur transport Brevo est injecté et fictif.

## Déclenchement en exploitation

Configurer un ordonnanceur serveur de confiance pour appeler toutes les minutes la même route HTTPS, avec le secret stocké dans son coffre de secrets et le corps `{}` ou `{"dryRun":false}`. Le relais fourni peut être utilisé par cron, systemd timer ou un job CI dédié :

```powershell
$env:PUBLIC_BASE_URL='https://restaurant.exemple.fr'
$env:NOTIFICATION_DISPATCH_SECRET='<secret du coffre>'
npm run notifications:dispatch
```

Pour une recette sans envoi, ajouter `--dry-run`. Ne jamais placer le secret dans l'URL, le code navigateur, un dépôt Git, un journal ou une capture d'écran. L'ordonnanceur ne doit pas enregistrer l'en-tête d'autorisation. Prévoir un délai d'appel supérieur à 75 secondes et éviter de relancer aveuglément une requête interrompue; l'appel suivant utilise les états persistés.

Les méthodes autres que POST, les cookies de session seuls, les paramètres d'URL et tout champ autre que `dryRun` sont refusés. L'accès compare les condensats SHA-256 du secret attendu et du bearer par une boucle à longueur fixe. Le corps est limité à 128 octets.

Chaque appel traite au maximum cinq événements. Un volume supérieur demande une fréquence adaptée et une surveillance du retard de l'outbox; aucune augmentation de lot n'est pilotable depuis la requête. Ne pas appeler directement Brevo depuis les tablettes.

## Concurrence, reprise et résultat incertain

Une mise à jour atomique réclame chaque événement par son identifiant : `pending` devient `sending`, le nombre d'essais augmente, et un jeton de bail est conservé pendant deux minutes. Deux consommateurs concurrents ne peuvent pas réclamer la même ligne. La finalisation compare à nouveau le jeton. Un arrêt du processus laisse le bail; après expiration, le prochain appel place cet événement en `unknown` au lieu de l'envoyer de nouveau.

| Résultat | État conservé | Suite |
| --- | --- | --- |
| Réponse de succès avec identifiant Brevo valide | `sent`, identifiant et heure | Aucun nouvel envoi automatique; `sent` signifie accepté par le fournisseur, pas livré au téléphone |
| Refus HTTP 429 de Brevo | `pending` | Nouvel essai après 1, 2, 4 puis 8 minutes, cinq essais au total, puis `failed` |
| Refus explicite HTTP 4xx sauf 408, 425 et 429 | `failed` | Corriger la cause puis décision opérateur; aucun essai automatique |
| Timeout, exception réseau, HTTP 408/425/5xx, succès sans identifiant exploitable | `unknown` | Réconciliation manuelle, jamais de renvoi automatique |
| Bail expiré, y compris après arrêt brutal | `unknown` | Même réconciliation |
| Commande, contact ou périmètre inadmissible | `skipped` | Aucun envoi |

La reprise automatique d'un refus 429 repose sur la [documentation officielle des limites Brevo](https://developers.brevo.com/docs/api-limits), qui présente ce statut comme la réponse aux requêtes dépassant la limite. Les autres erreurs transitoires sont traitées avec prudence, car le fournisseur a pu accepter le SMS avant la coupure. Le format de requête et l'identifiant de succès suivent la [documentation officielle SMS transactionnels](https://developers.brevo.com/docs/transactional-sms-endpoints).

Le jeton empêche une double réclamation de la même ligne; il n'impose pas l'idempotence à Brevo. Pour les campagnes marketing, l'identifiant de message renvoyé par Brevo est maintenant conservé dans `campaign_recipients.provider_message_id` lorsqu'il est disponible. Un résultat inconnu reste terminal et n'est jamais renvoyé automatiquement. La route SMS documentée ne fournit donc pas une garantie d'envoi exactement une fois. Une modification ou annulation peut aussi survenir entre la dernière lecture et l'acceptation réseau; ce bref intervalle ne peut être rendu atomique avec une API externe.

## Surveillance et réconciliation

Surveiller les compteurs `unknown`, `failed`, `recovered`, le nombre d'événements `pending` et l'âge du plus ancien. Alerter si l'ordonnanceur reçoit une réponse 401/503 ou si le retard augmente. Les codes d'erreur enregistrés sont fixes; aucune erreur brute du fournisseur et aucun numéro de téléphone ne sont journalisés ou retournés par ce consommateur.

Pour un événement `unknown`, un opérateur autorisé consulte les journaux transactionnels Brevo et les preuves métier dans un environnement restreint. S'il confirme une acceptation, enregistrer la référence fournisseur et conserver la preuve. S'il ne peut pas déterminer le résultat, conserver `unknown` et prévenir le personnel via le parcours d'exploitation. Un renvoi doit être une décision explicite et tracée après vérification; ne pas remettre automatiquement ces lignes en `pending`. La supervision propriétaire `/equipe/notifications` et `POST /api/admin/notifications` permettent maintenant de clôturer explicitement ou de remettre en file une ligne `unknown`; l'action est réservée au propriétaire, atomique avec un audit et n'envoie jamais directement de SMS.

Les événements `sent` ne sont pas une preuve de délivrance opérateur. Un futur webhook signé et contrôlé pourra distinguer accepté, livré, rejeté et expiré sans refaire l'envoi. La conservation des numéros et des journaux fournisseur doit suivre la politique de conservation de l'établissement.
