# Dolce Pizz’ behavioral contract
## Scope and authority
User: pickup only, payment on collection, restaurant explicitly confirms orders. Flyers own recipe names/ingredients/prices. Google Maps verified address and phone on 2026-09-22. Hours are provisional pending owner setup. Loyalty defaults to 1 point per paid euro / 100 points for €5, configurable and disabled until activated by admin.
## Canonical UI Map
| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | components/ui/select | this contract | authored | keyboard popup |
| Date | slot buttons and labeled native date input | this contract | local date for closures, browser popup accepted | Paris midnight tests |
| Form | app/components.tsx Field, API zod schemas | this contract | checkout/settings | inline errors and persistence |
| Scrollbar | app/globals.css | DESIGN.md | global | narrow viewport |
| Toast | components/ui/sonner | this contract | French success/error | browser |
| CRUD | app/api/[...path]/route.ts | this contract | orders/menu/settings | integration checks |
## State and navigation
Real links for routes. Menu local search with clear button, category in URL. Temporary cart only in localStorage, no PII. Orders, wallet and settings in D1. Account and admin require dispatch authentication. Admin role is explicitly granted using a private, single-use installation code; no first-visitor trust.
## Order lifecycle
pending → confirmed → preparing → ready → completed. Admin may reject pending or cancel any uncompleted order with a reason. Customer may cancel pending only. Optimistic version required; conflict preserves screen and prompts refresh. No reopening or deleting financial history. Retrying creation uses the same idempotency key; all totals recomputed by server in integer cents.
## Scheduling
Europe/Paris with DST. Slots use UTC identity and French local display. Seven-day horizon, 15-minute intervals, configurable lead and cutoff, daily hours including midnight, exceptions, per-slot order capacity. Server revalidates on order creation. Pending orders reserve capacity. Hours setup gate and pause prevent new orders without altering existing ones.
## Loyalty
Opt-in account ledger; completed paid orders only. Earn rate and discount snapshot stored per order. Points reserved atomically on submission, restored on rejection/cancellation, credited exactly once on completion. No balance supplied by client. Wallet cannot become negative. One discount per order.
## Feedback and recovery
No native alerts/confirms. noValidate forms, own validation, persistent inline errors and first-invalid focus. Busy buttons prevent double submit without geometry change. Typed order draft retained if request fails. Polling ignores stale replies and pauses while hidden. No fake success on failed APIs. Updates never silently overwrite dirty settings.
## Accessibility and locale
fr-FR, EUR, Europe/Paris. Dialog focus trap, Escape, return focus; French close labels. Labels for every field; associated validation. 44px primary targets. 200% reflow, reduced motion, text contrast, live status, no color-only information. Z-index: header20, cart30, dialog50, toast100.
