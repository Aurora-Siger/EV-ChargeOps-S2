import { aiClient } from '../../../infra/ai/aiClient.js'
import type { PricingContext, PricingStrategy } from '../domain/types.js'

/** Delega o cálculo ao modelo em Python. */
export const aiStrategy: PricingStrategy = {
  async price(ctx: PricingContext) {
    const r = await aiClient.quote({ ...ctx, now: ctx.now.toISOString() })
    return { multiplier: r.multiplier, applied: r.applied, strategy: r.model_version }
  },
}

/**
 * Se a IA cair ou demorar, cai para as regras locais: preço nunca fica indisponível.
 * A decisão registra qual estratégia realmente rodou.
 */
export function withFallback(primary: PricingStrategy, fallback: PricingStrategy): PricingStrategy {
  return {
    async price(ctx) {
      try {
        return await primary.price(ctx)
      } catch (err) {
        console.warn('Estratégia primária falhou, usando fallback:', err)
        return fallback.price(ctx)
      }
    },
  }
}
