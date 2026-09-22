---
version: alpha
colors:
  primary: "#ef3024"
  background: "#151412"
  surface: "#211f1c"
  foreground: "#faf7ef"
  muted: "#b9b4aa"
  accent: "#f5cd63"
typography:
  display:
    fontFamily: "Impact, Arial Narrow, sans-serif"
  body:
    fontFamily: "Arial, Helvetica, sans-serif"
rounded:
  control: "6px"
  panel: "12px"
spacing:
  unit: "8px"
components:
  button: { }
  card: { }
  dialog: { }
---
# Dolce Pizz’
## Overview
Hybrid: a dramatic neighborhood pizzeria storefront and quiet operational screens. Supplied flyers are the visual authority: charcoal, tomato red, white brush lettering, rustic wood and generously photographed pizza. Signature: enormous condensed typography intersecting a cinematic pizza photograph and an offset red price stamp. The ordering menu is immediately accessible; admin prioritizes ticket clarity.
## Colors
Runtime ownership model B: app/globals.css :root owns semantic values above. DESIGN mirrors them. Primary → --primary, background → --background, surface → --card, foreground → --foreground, muted → --muted-foreground, accent → --accent. These feed both Tailwind adapter and custom classes. Gold means cream/loyalty; red means brand, not solely error.
## Typography
Display → --font-display; body → --font-body. Main body 16px, utility 14px. Oversized headings only on marketing. French text, EUR and Europe/Paris time. No false claims, fabricated reviews or delivery promises.
## Layout
Maximum width 1280px. 8px rhythm. Hero split 46/54, menu category controls and two-column product list. Narrow layouts below 760px use one column, horizontal category controls, and a reachable cart action. No fixed-height content panels.
## Elevation & Depth
Low contrast surfaces and fine borders. Shadows reserved for floating dialogs and cart. Photography supplies richness, restrained texture supplies atmosphere.
## Shapes
6px controls, 12px panels. Red price stamp is the expressive exception. Shared Radix/Shadcn controls own focus and dialogs.
## Components
Dialogs, sheets, tabs, select, radio-group, checkbox, table, progress, alert-dialog and toasts reuse components/ui. Business wrappers in app/components.tsx localize and style them. No changes to vendor primitives. Single dark theme for consistent brand and no flash.
## Do's and Don'ts
Preserve all flyer prices. Treat generated photography as illustrative. Keep forms calm. Never use menu imagery as evidence of exact toppings. Respect reduced motion, visible focus, stable scrollbars and 44px major touch targets.
