# Contrat d’adaptateur TPE

Le POS ne reçoit jamais de PAN, de CVV ou de données de carte. Le terminal reste le système qui saisit et autorise la carte. L’adaptateur serveur traduit uniquement le résultat du prestataire vers le ledger local.

## Contrat logiciel

L’adaptateur implémente `PaymentTerminalAdapter` dans [`lib/payment-terminal.ts`](../lib/payment-terminal.ts) :

- `capture(request)` pour un paiement au retrait ;
- `refund(request)` pour un remboursement ;
- résultat `captured`, `pending` ou `failed` ;
- référence fournisseur facultative mais conservée lorsqu’elle est fournie ;
- clé d’idempotence stable pour toute nouvelle tentative.

La requête contient uniquement l’organisation, l’établissement, la commande, le montant en centimes, la devise `EUR` et une clé d’idempotence. Elle ne contient aucune donnée de carte.

## Règles obligatoires d’un fournisseur

1. L’appel fournisseur est exécuté côté serveur avec un secret dans le coffre.
2. Le montant et la devise sont recalculés depuis la commande et le solde restant ; le navigateur ne fournit jamais une référence fournisseur.
3. Une même clé d’idempotence doit retourner le même résultat métier, sans seconde capture.
4. Une réponse `captured` doit être accompagnée d’une preuve fournisseur exploitable ou d’un mécanisme de consultation ultérieure.
5. Un timeout ou une réponse ambiguë devient `pending` et ne doit jamais être retenté automatiquement comme une nouvelle capture.
6. Si le TPE confirme mais que l’écriture du ledger échoue, l’API crée `payment_reconciliation_required` et bloque toute prétention de solde à jour.
7. Les remboursements doivent référencer le paiement local d’origine, rester inférieurs au montant remboursable et conserver la référence fournisseur.

## Mise en production

- Choisir un prestataire autorisé en France et obtenir sa documentation d’intégration, son mode de test et son engagement de support.
- Implémenter l’adaptateur sans modifier la route POS ni les règles du ledger.
- Tester capture, double soumission, timeout, refus, annulation, remboursement et reprise après panne.
- Enregistrer les références et résultats dans le dossier de recette, jamais les secrets ou les données carte.
- Valider le rapprochement avec le relevé du prestataire avant de passer le contrôle `payment_terminal` à `ok`.

Tant qu’un adaptateur certifié n’est pas installé, `paymentTerminalAdapter()` utilise `missingTerminalAdapter()` : toute tentative carte automatique est refusée avec `terminal_not_configured` et aucune écriture de caisse n’est créée.
