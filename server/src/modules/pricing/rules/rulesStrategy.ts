import type { AppliedRule, PricingContext, PricingStrategy } from '../domain/types.js'

type Rule = (ctx: PricingContext) => AppliedRule | null

// Cada regra é uma função pura: testável sem banco, sem rede, sem IA.
const peakHours: Rule = ({ now }) => {
  const h = now.getHours()
  return h >= 18 && h < 21
    ? { rule: 'peak-hours', multiplier: 1.2, reason: 'Horário de pico (18h–21h)' }
    : null
}

const offPeak: Rule = ({ now }) => {
  const h = now.getHours()
  return h >= 0 && h < 6
    ? { rule: 'off-peak', multiplier: 0.85, reason: 'Madrugada com ociosidade' }
    : null
}

const highOccupancy: Rule = ({ occupancy }) =>
  occupancy >= 0.8
    ? { rule: 'high-occupancy', multiplier: 1.15, reason: `Ocupação em ${Math.round(occupancy * 100)}%` }
    : null

const gridStress: Rule = ({ gridLoad }) =>
  gridLoad >= 0.9
    ? { rule: 'grid-stress', multiplier: 1.25, reason: 'Rede próxima da capacidade' }
    : null

export const rulesStrategy: PricingStrategy = {
  async price(ctx) {
    const applied = [peakHours, offPeak, highOccupancy, gridStress]
      .map((rule) => rule(ctx))
      .filter((r): r is AppliedRule => r !== null)
    const multiplier = applied.reduce((acc, r) => acc * r.multiplier, 1)
    return { multiplier, applied, strategy: 'rules-v1' }
  },
}
