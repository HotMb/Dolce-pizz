# Runbook de rétablissement Uber Eats

Ce runbook traite le cas où la fiche d’un établissement reste visible mais où les commandes ne peuvent plus être acceptées. Il s’applique établissement par établissement : une fermeture de Roubaix ne doit jamais désactiver Ronchin.

## Diagnostic rapide

1. Vérifier l’adresse et l’établissement dans Uber Eats Manager, pas seulement la fiche publique.
2. Vérifier que le magasin est **ouvert à la commande**, que le menu est publié et qu’aucune pause manuelle n’est active.
3. Vérifier les horaires, les jours fériés, la zone de livraison et la disponibilité des coursiers.
4. Vérifier que la tablette Uber Eats Orders ou le poste Order Manager est alimenté, connecté et connecté au bon magasin.
5. Vérifier l’imprimante ou le système de réception configuré par Uber. Une fiche visible ne prouve pas qu’un poste de prise de commande fonctionne.
6. Vérifier l’état de l’intégration POS/API et les identifiants du magasin. Un ancien terminal supprimé ou une intégration expirée peut laisser le menu visible sans livrer les commandes au restaurant.

La fiche publique consultée le 24 octobre 2026 pour Ronchin affiche l’adresse `191 Avenue Jean Jaurès, 59790 Ronchin`, indique « Livraison indisponible » et expose une plage de menu `12:00 – 23:30`. Cela doit être traité comme un signal de disponibilité partielle, pas comme une preuve que le restaurant est fermé : [fiche Uber Eats](https://www.ubereats.com/fr/store/dolce-pizz/tjs4PNSNTmq8jd0IQHJN1A).

## Remise en service immédiate

- Réactiver le magasin et le menu dans Uber Eats Manager après avoir vérifié les horaires.
- Reconnecter ou remplacer la tablette Uber Eats Orders. Tant que le système Dolce n’est pas relié à l’API officielle, cette tablette est le filet de secours qui reçoit les commandes.
- Faire une commande de test à faible montant depuis une adresse de la zone.
- Confirmer que le restaurant accepte la commande, que le ticket est visible et que le statut est transmis au client/coursier.
- Annuler et rembourser le test selon la procédure Uber si le magasin n’est pas encore prêt.

Ne jamais ouvrir automatiquement un magasin ou accepter une commande réelle uniquement parce qu’un webhook arrive : un responsable doit confirmer la capacité de production et la disponibilité du menu.

## Intégration dans Dolce Pizz’

Pour chaque établissement, enregistrer séparément :

- l’identifiant du magasin Uber ;
- le secret de webhook dans le coffre ;
- la table de correspondance SKU Uber → article local ;
- le statut d’activation et le dernier événement reçu ;
- le responsable et la date de validation terrain.

Le webhook doit rester signé et idempotent. Une commande Uber est importée dans `delivery_inbox`, contrôlée pour son SKU, ses allergènes et son routage, puis envoyée au même cycle **Make Line → Four → Expeditor**. Elle ne déclenche jamais le SMS client Dolce. Un SKU inconnu ou un article sans routage validé reste bloqué et apparaît dans la supervision.

## Critères de sortie

- [ ] Ronchin et Roubaix ont des identifiants Uber distincts.
- [ ] L’établissement fermé est désactivé sans modifier l’autre.
- [ ] Le poste de réception de secours est opérationnel.
- [ ] Une commande test est acceptée, produite, remise au coursier et rapprochée.
- [ ] Le rejeu du même événement ne crée pas de seconde commande.
- [ ] Un article inconnu est refusé avant production.
- [ ] Les statuts Uber et locaux restent séparés.

L’accès partenaire officiel et la validation Uber en sandbox restent nécessaires avant de commercialiser le connecteur comme activé.
