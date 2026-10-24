# Contrat d’intégration Uber Eats

Le connecteur reçoit les commandes Uber Eats dans le KDS de l’établissement sans exposer de données de livraison maison ni envoyer de SMS client depuis Dolce Pizz’. Uber reste responsable de son transport et de ses notifications.

## Flux accepté

1. Le partenaire envoie un webhook HTTPS signé avec `X-Uber-Signature`.
2. Le Worker vérifie la signature HMAC-SHA256 sur le corps brut avant tout traitement JSON.
3. `storeId` est recherché dans `delivery_integrations` et doit être actif pour une organisation et un établissement précis.
4. `eventId` est idempotent : le même événement avec le même contenu peut être rejoué ; le même identifiant avec un autre contenu est refusé.
5. `order.created` crée une commande `uber_eats`, déjà payée par l’agrégateur, puis l’envoie au flux de production.
6. `order.status_updated` conserve le statut partenaire dans `orders.external_status` et dans l’audit sans avancer silencieusement le statut local du KDS.
7. `order.cancelled` annule la commande locale encore active et journalise l’événement.

## Conditions de sécurité

- Le secret du webhook reste dans le coffre serveur et n’est jamais saisi dans l’interface propriétaire.
- Le corps brut est limité en taille et validé par un schéma strict : type d’événement, magasin, commande, articles, quantités, prix et modificateurs.
- Un SKU absent du menu local ou sans allergènes/routage validés reste bloqué avant validation de production.
- Les commandes Uber ont `notification_phone=''` et `notification_phone_basis='none'` ; elles ne sont jamais ajoutées à la file SMS « commande prête ».
- Les requêtes, réponses et journaux ne doivent pas contenir le secret de signature.

## Recette partenaire

- [ ] Accès partenaire obtenu pour chaque magasin et `external_store_id` vérifié.
- [ ] Signature valide, signature absente et signature modifiée testées.
- [ ] Création, rejeu identique et conflit de contenu testés.
- [ ] SKU inconnu et allergènes non validés restent bloqués dans le KDS.
- [ ] Acceptation, préparation, prêt, retrait et annulation testés en sandbox.
- [ ] Une panne D1 ou un timeout permet le rejeu sans doublon.
- [ ] Montants Uber et paiements déjà réglés rapprochés avec le relevé partenaire.
- [ ] Aucune notification SMS client générée pour un événement Uber.

Tant que cette recette et l’autorisation partenaire ne sont pas signées, l’intégration reste `Connecteur préparé` dans la feuille de route et ne doit pas être vendue comme activée.
