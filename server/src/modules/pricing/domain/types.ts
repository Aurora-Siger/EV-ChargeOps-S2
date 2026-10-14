/** Tudo em centavos por kWh (inteiros): nunca float para dinheiro. */
export interface PricingContext {
  chargerId: string
  now: Date
  basePriceCentsKwh: number
  occupancy: number        // 0..1 das tomadas da estação em uso
  gridLoad: number         // 0..1 carga atual / capacidade
  recentDemandKwh: number  // demanda na última hora
  previousPriceCentsKwh?: number
}

export interface Guardrails {
  minPriceCentsKwh: number
  maxPriceCentsKwh: number
  maxStepPercent: number
}

export interface AppliedRule {
  rule: string
  multiplier: number
  reason: string
}

export interface StrategyOutput {
  multiplier: number
  applied: AppliedRule[]
  /** Nome da estratégia que de fato produziu o resultado (relevante no fallback). */
  strategy: string
}

export interface PricingResult {
  priceCentsKwh: number
  strategy: string
  applied: AppliedRule[]
  clamped: boolean
}

/** Contrato que qualquer motor (regras locais, modelo de IA em Python) precisa cumprir. */
export interface PricingStrategy {
  price(ctx: PricingContext): Promise<StrategyOutput>
}
