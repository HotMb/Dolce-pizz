export type ProductionPriorityBand = 'urgent' | 'a_surveille' | 'normal' | 'pret';

export type ProductionPriority = {
  band: ProductionPriorityBand;
  score: number;
  estimatedMinutes: number;
  minutesUntilSlot: number;
  reason: string;
};

type PriorityInput = {
  slot: string;
  status: 'in_progress' | 'ready' | 'cancelled' | 'completed';
  itemCount: number;
  pizzaCount: number;
  now?: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const frenchTime = (iso: string) => {
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('fr-FR', {timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit'}).format(date)
    : 'l’heure prévue';
};

/**
 * Explainable baseline used to order active KDS tickets. It never accepts or
 * rejects an order and intentionally avoids a permanent channel multiplier.
 */
export function productionPriority(input: PriorityInput): ProductionPriority {
  if (input.status === 'ready' || input.status === 'completed') {
    return {band: 'pret', score: 0, estimatedMinutes: 0, minutesUntilSlot: 0, reason: 'Commande prête'};
  }
  const slotAt = Date.parse(input.slot);
  const now = input.now ?? Date.now();
  const minutesUntilSlot = Number.isFinite(slotAt) ? (slotAt - now) / 60000 : 0;
  // Standard de départ explicable : chaque unité ajoute du travail, une pizza
  // ajoute la préparation et la cuisson. Les temps réels pourront remplacer
  // ces constantes après collecte de mesures, sans changer le contrat API.
  const estimatedMinutes = clamp(6 + Math.max(0, input.itemCount) * 2 + Math.max(0, input.pizzaCount) * 2, 8, 90);
  const risk = estimatedMinutes - minutesUntilSlot;
  if (!Number.isFinite(minutesUntilSlot) || risk >= 15) {
    const delay = Number.isFinite(risk) ? Math.max(0, Math.ceil(risk)) : estimatedMinutes;
    return {band: 'urgent', score: 300 + clamp(delay, 0, 90), estimatedMinutes, minutesUntilSlot, reason: `Risque de retard d’environ ${delay} min`};
  }
  if (risk > 0) {
    return {band: 'a_surveille', score: 200 + clamp(Math.ceil(risk), 1, 14), estimatedMinutes, minutesUntilSlot, reason: `À surveiller pour ${frenchTime(input.slot)}`};
  }
  return {band: 'normal', score: 100, estimatedMinutes, minutesUntilSlot, reason: `À préparer pour ${frenchTime(input.slot)}`};
}

export function compareProductionPriority(a: ProductionPriority, b: ProductionPriority): number {
  if (a.score !== b.score) return b.score - a.score;
  return a.minutesUntilSlot - b.minutesUntilSlot;
}
