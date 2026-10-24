# Déploiement matériel et recette terrain

Cette fiche est à remplir pour chaque établissement. Elle ne remplace pas le choix d’un fournisseur certifié pour le TPE ni la validation du réseau par l’exploitant.

## Matrice des postes

| Poste | Matériel conseillé | Rôle enrôlé | Emplacement | Critère d’acceptation |
|---|---|---|---|---|
| Make Line | tablette 10 pouces, support mural, coque lavable | `make_line` | zone de montage | chaque article affiche recette, modifications et allergènes |
| Four | tablette 10 pouces, support hors chaleur directe | `oven` | devant le four | minuteur lisible, validation de sortie et reprise réseau testées |
| Expeditor | tablette 10 pouces ou écran tactile plus grand | `expeditor` | passe / comptoir | tous les articles de la commande sont visibles et la validation prête déclenche l’outbox prévue |
| POS comptoir | tablette ou terminal fixe avec imprimante locale | `pos` | comptoir | commande, shift, paiement manuel et reçu testés |
| Bornes | deux tablettes verrouillées en mode kiosque | `kiosk` | entrée / salle | panier isolé, prix serveur, remise à zéro et révocation testées |
| Relais imprimante | mini-PC ou boîtier réseau dédié | `printer_gateway` | réseau local | simulation puis ticket test sans secret dans les journaux |
| TPE | terminal du prestataire retenu | fournisseur certifié | comptoir | transaction test, annulation et rapprochement validés hors application |

## Réseau et sécurité

1. Créer un SSID ou VLAN métier séparé du Wi-Fi invité.
2. Autoriser uniquement les sorties HTTPS vers le domaine de l’application et les services du fournisseur TPE/SMS nécessaires.
3. Ne pas exposer l’imprimante, le relais ou les tablettes sur Internet avec une redirection de port.
4. Activer le verrouillage écran, le chiffrement et les mises à jour du système via le MDM choisi.
5. Enrôler chaque appareil séparément depuis **Espace équipe → Appareils**, noter son libellé physique et conserver le jeton uniquement dans le coffre prévu. Ne jamais le transmettre dans un ticket ou une URL.
6. Tester la révocation de chaque appareil avant l’ouverture au public.

## Procédure de recette

### Préparation

- vérifier l’adresse, le téléphone, le fuseau `Europe/Paris`, les horaires et les codes postaux du site ;
- vérifier la carte locale, les prix, les disponibilités, le routage et les allergènes ;
- ouvrir un shift de test et vérifier l’imprimante en simulation ;
- vérifier que l’établissement apparaît bien sous le bon domaine tenant.

### Scénario complet

1. Créer une commande web avec une pizza modifiée, une boisson et un numéro mobile de test.
2. Créer une commande comptoir et une commande borne avec la même carte.
3. Vérifier que les tickets apparaissent sur Make Line, puis Four, puis Expeditor.
4. Marquer la commande prête et vérifier l’outbox SMS; utiliser un numéro de test autorisé, jamais un fichier de contacts réel.
5. Vérifier l’apparition dans la caisse, le paiement partiel, le paiement final et la clôture du shift.
6. Vérifier le ticket imprimé et le comportement d’un job `failed` puis `unknown`.
7. Couper le réseau pendant une action KDS, le rétablir et vérifier le rejeu ou le conflit de révision.
8. Révoquer le jeton d’un appareil et confirmer que ses lectures et validations sont refusées immédiatement.

### Critères de non-ouverture

Ne pas ouvrir le site si un appareil peut lire un autre établissement, si une commande peut être marquée prête sans Expeditor, si un paiement est confirmé sans preuve du TPE, si un ticket imprimante inconnu est relancé automatiquement, ou si une clé secrète apparaît dans les journaux.

## Dossier de remise

Conserver pour le site : identifiant de l’organisation et du site, inventaire matériel, versions système, fournisseur TPE, date de recette, opérateur ayant validé chaque scénario, anomalies ouvertes et date de la prochaine rotation des jetons. Les secrets restent dans le gestionnaire de secrets et ne figurent pas dans ce dossier.
