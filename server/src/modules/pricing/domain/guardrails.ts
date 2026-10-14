import type { Guardrails } from './types.js'

/**
 * Última barreira, aplicada a QUALQUER estratégia (regras, ML ou LLM).
 * Garante piso/teto e limita o salto entre decisões consecutivas.
 */
export function applyGuardrails(
  raw: number,
  g: Guardrails,
  previous?: number,
): { price: number; clamped: boolean } {
  let price = raw
  if (previous !== undefined) {
    const maxUp = previous * (1 + g.maxStepPercent / 100)
    const maxDown = previous * (1 - g.maxStepPercent / 100)
    price = Math.min(Math.max(price, maxDown), maxUp)
  }
  price = Math.min(Math.max(price, g.minPriceCentsKwh), g.maxPriceCentsKwh)
  const rounded = Math.round(price)
  return { price: rounded, clamped: rounded !== Math.round(raw) }
}
