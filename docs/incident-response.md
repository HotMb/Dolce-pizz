# Runbook d’incident — Dolce Pizz’

Ce runbook s’applique à une enseigne et à un établissement précis. Chaque intervention commence par noter l’heure, le site, le poste concerné, le numéro de ticket et l’identifiant de l’opérateur. Ne copiez jamais un numéro de téléphone client, un jeton appareil ou un secret dans un ticket de support.

## Règle de sécurité immédiate

Si un jeton de tablette, de borne ou de relais est perdu, copié ou suspecté compromis : ouvrir **Espace équipe → Appareils**, révoquer l’appareil, puis faire tourner son jeton après remplacement. Le jeton n’est jamais récupérable depuis le serveur. Vérifier ensuite le dernier contact et l’absence d’action inattendue dans l’audit.

Si un poste affiche « trop de tentatives » lors de son bootstrap, ne pas multiplier les rotations : le service limite les essais de jeton à 20 par heure et par adresse source. Attendre le délai `Retry-After`, vérifier que le poste utilise le bon réseau et que l’ancien jeton n’est pas réessayé par plusieurs onglets. Révoquer et recréer le credential uniquement si l’exposition est suspectée.

## Panne réseau ou écran KDS hors ligne

1. Vérifier l’alimentation, le Wi-Fi métier et l’heure de l’appareil.
2. Garder l’écran ouvert : le KDS conserve la dernière lecture validée et affiche clairement le mode hors ligne.
3. Les actions mises en file localement sont limitées et recontrôlées par la révision serveur au retour réseau. Ne pas saisir la même action sur un autre poste avant d’avoir vérifié l’état du ticket.
4. Si la file reste bloquée, actualiser après retour réseau et traiter les conflits un par un. Une action obsolète est retirée de la file et doit être confirmée visuellement.

## Ticket bloqué entre Make Line, Four et Expeditor

1. Vérifier le poste attendu et la dernière révision du ticket.
2. Contrôler le routage et les allergènes dans la fiche produit; un article inconnu reste volontairement bloqué.
3. Ne pas supprimer le ticket pour le débloquer. Utiliser l’action responsable prévue pour annuler ou rouvrir avec une raison; la réouverture réinitialise toute la progression.
4. Si la commande est déjà prête, l’Expeditor reste l’autorité pour la remise au comptoir et la notification client.

## Imprimante ou relais local

- Un job `pending` peut être réclamé par le relais; un job `failed` peut être relancé après vérification de l’imprimante et du réseau.
- Un résultat `unknown` ne doit pas être relancé automatiquement : vérifier le ticket physique et rapprocher le résultat avant toute nouvelle impression.
- Le relais démarre en simulation (`DRY_RUN=1`). Activer l’impression réelle seulement après un essai contrôlé et vérifier que le relais utilise HTTPS hors boucle locale.

## SMS « commande prête »

- Consulter **Espace équipe → Notifications**. Les événements `unknown` exigent un rapprochement manuel.
- `accepted` signifie que le fournisseur a accepté la requête, pas que le téléphone l’a affichée.
- Utiliser « accepter » uniquement après vérification externe; utiliser « remettre en file » seulement si le fournisseur a explicitement refusé par limitation de débit.
- Uber Eats ne reçoit jamais de SMS Dolce Pizz’ : le client est informé par l’agrégateur.

## Uber Eats ou intégration partenaire

1. Consulter **Intégrations** et **Santé** pour le magasin concerné.
2. Vérifier la signature, l’identifiant de magasin et l’état `pending`/`failed` de l’inbox.
3. Rejouer un événement uniquement depuis l’outil prévu, après correction de la cause. Ne pas modifier directement une commande importée pour contourner un SKU inconnu; corriger le mapping menu puis rejouer.

## TPE et paiement au retrait

- Tant qu’aucun adaptateur certifié n’est configuré, le terminal automatique est en échec fermé; enregistrer le paiement par le flux de caisse prévu après vérification du terminal.
- Si le TPE confirme la carte mais que le journal renvoie `terminal_capture_reconciliation_required`, ne pas encaisser une seconde fois. Conserver le ticket TPE, noter la référence fournisseur dans le support sécurisé et faire le rapprochement avant toute nouvelle tentative.
- Aucun PAN, CVV ou code secret ne doit être saisi dans Dolce Pizz’.

## Sauvegarde et restauration

1. Stopper les écritures non indispensables et identifier l’heure de la dernière sauvegarde valide.
2. Exporter avec `npm run db:backup` ou, après authentification Wrangler, `npm run db:backup -- --remote`.
3. Valider l’export avec `npm run db:verify-backup -- --file=backups/<export>.sql` avant toute restauration.
4. Restaurer dans une copie locale isolée avec `npm run db:restore-isolated -- --file=backups/<export>.sql --output=backups/restore-check.sqlite`, vérifier les migrations et les clés étrangères, puis exécuter un scénario de commande/KDS de contrôle.
5. Documenter l’heure de reprise, les commandes potentiellement touchées et la décision de remise en service. Ne jamais restaurer directement sur la base de production sans procédure Cloudflare validée.

## Compromission ou fuite de données

Révoquer les appareils et sessions concernés, préserver les journaux d’audit, désactiver l’intégration externe touchée et prévenir le responsable de l’enseigne. Ne pas effacer les événements ou les inbox pour masquer l’incident. L’analyse juridique et la notification éventuelle des personnes concernées relèvent du responsable de traitement.

## Clôture de l’incident

Le responsable note la cause, le début et la fin, les sites affectés, les commandes réconciliées, les jetons renouvelés, les sauvegardes testées et une action préventive. Un incident n’est pas clos sur la seule disparition du message d’erreur : il faut vérifier le flux de commande complet sur le site concerné.
