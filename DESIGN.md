---
version: alpha
colors:
  primary: "#e31d4b"
  background: "#050505"
  surface: "#121212"
  foreground: "#f6f3ef"
  muted: "#aaa5a7"
  accent: "#f4c542"
typography:
  display:
    fontFamily: "Anton, Impact, Arial Narrow, sans-serif"
  hand:
    fontFamily: "Permanent Marker, Segoe Print, cursive"
  body:
    fontFamily: "Arial, Helvetica, sans-serif"
rounded:
  control: "999px"
  panel: "16px"
spacing:
  unit: "8px"
components:
  button: { }
  card: { }
  dialog: { }
---
# Dolce Pizz’
## Overview
Hybrid: a dramatic neighborhood pizzeria storefront and quiet operational screens. Inspired by a “pizza slider” reference: pure black stage with a soft grey glow, crimson accent, white condensed titles and marker-style captions, floating basil leaves. Signature: the home wheel (app/pizza-wheel.tsx) — “J’ai envie d’une [PIZZA]” with the name in crimson over a dotted underline, the current slice framed by a white rounded-V outline, neighbours on an arc, round white arrows and a handwritten tagline. Slices are cut from real top-view photos (clip-path wedge with the crust arc); the wheel is driven by a spring with drag inertia (app/pizza-wheel.tsx), with an ambient glow taken from the current photo. Motion lives in app/experience.css and always yields to prefers-reduced-motion. Flyers stay the authority for names, ingredients and prices. The ordering menu is immediately accessible; admin prioritizes ticket clarity.
## Colors
Runtime ownership model B: app/globals.css :root owns semantic values above. DESIGN mirrors them. Primary → --primary, background → --background, surface → --card, foreground → --foreground, muted → --muted-foreground, accent → --accent. These feed both Tailwind adapter and custom classes. Crimson means brand and primary actions; yellow marks free items and loyalty; greens are basil decoration only.
## Typography
Display → --font-display (Anton, self-hosted via @fontsource, uppercase); captions → --font-hand (Permanent Marker, self-hosted); body → --font-body. Main body 16px, utility 14px. Oversized headings only on marketing. French text, EUR and Europe/Paris time. No false claims, fabricated reviews or delivery promises.
## Layout
Maximum width 1280px. 8px rhythm. Full-height wheel hero, pill category controls and a two-column product list with slice thumbnails. Narrow layouts below 760px use one column, horizontal category controls, and a reachable cart action. No fixed-height content panels.
## Elevation & Depth
Low contrast surfaces and fine borders. Shadows reserved for floating dialogs and cart. Photography supplies richness, restrained texture supplies atmosphere.
## Shapes
Pill buttons and chips, 16–26px panels and bands. The wheel frame and “2e offerte” sticker are the expressive exceptions. Shared Radix/Shadcn controls own focus and dialogs.
## Components
Dialogs, sheets, tabs, select, radio-group, checkbox, table, progress, alert-dialog and toasts reuse components/ui. Business wrappers in app/components.tsx localize and style them. No changes to vendor primitives. Single dark theme for consistent brand and no flash.
## Do's and Don'ts
Preserve all flyer prices. Treat generated photography as illustrative. Keep forms calm. Never use menu imagery as evidence of exact toppings. Respect reduced motion, visible focus, stable scrollbars and 44px major touch targets.

## KDS operational screens
The kitchen is a high-attention, noisy, touch-first work surface used on a tablet. The internal console is a separate light surface from the public storefront: no public header, footer, marketing photography, or decorative brand shell. Use a readable system sans-serif for controls and ticket content, with orange for primary actions, teal for confirmed operational states, and slate for neutral structure. Keep pickup times in 24-hour `Europe/Paris` time and use tabular numerals for timers.

Operational states may use their own accessible colors: red for waiting or overdue, amber for in progress, and green for completed. Every state must also have a written label and, where useful, an icon; color alone never carries meaning. A blank allergen list is not proof of no allergens: unknown or unverified recipe data must be called out in text.

The Make Line sees only items currently assigned to preparation; the Oven sees items whose preparation is complete and whose oven step is active; Expeditor sees the full ticket and can mark the order ready only after every item route is complete. Actions wait for server confirmation and use the order revision; a conflict refreshes the ticket and explains the change. Offline status is visible and production actions remain blocked until the server confirms them; the KDS does not claim local work is synced.

## Staff workspace
`/interne`, `/equipe`, `/production`, `/borne` and `/admin` use an internal console shell that is intentionally separate from the public storefront. The main workspace shows only service actions; owner-only settings are grouped under one administration block. Each site card names the restaurant, station and whether access is read only. Capability-aware controls are backed by server authorization; stale or offline capabilities cannot enable mutations. Account identifiers are displayed only in the authenticated workspace, with a copy action and a selectable fallback. Permission changes use the shared alert-dialog, explicitly naming the account, site and role and restoring focus after confirmation.
