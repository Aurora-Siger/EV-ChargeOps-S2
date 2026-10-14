import { and, desc, eq } from 'drizzle-orm'
import { aiClient } from '../../infra/ai/aiClient.js'
import { db } from '../../infra/db/client.js'
import { pricingDecision, tariff } from '../../infra/db/schema.js'
import { NotFoundError } from '../../shared/errors.js'
import { aiStrategy, withFallback } from './ai/aiStrategy.js'
import { applyGuardrails } from './domain/guardrails.js'
import type { PricingContext, PricingResult, PricingStrategy } from './domain/types.js'
import { rulesStrategy } from './rules/rulesStrategy.js'

export class PricingService {
  // Estratégia injetada: trocar de motor não muda quem chama.
  constructor(private readonly strategy: PricingStrategy) {}

  /** `workspaceId`: condomínio dono do carregador (a tarifa é de cada condomínio). */
  async quote(ctx: PricingContext, workspaceId: string): Promise<PricingResult> {
    const active = await pricingQueries.activeTariff(workspaceId)
    if (!active) throw new NotFoundError('Tarifa ativa')

    const { multiplier, applied, strategy } = await this.strategy.price(ctx)
    const { price, clamped } = applyGuardrails(
      ctx.basePriceCentsKwh * multiplier,
      {
        minPriceCentsKwh: active.minPriceCentsKwh,
        maxPriceCentsKwh: active.maxPriceCentsKwh,
        maxStepPercent: active.maxStepPercent,
      },
      ctx.previousPriceCentsKwh,
    )

    // Persistir sempre: auditoria hoje, dataset de treino amanhã.
    await db.insert(pricingDecision).values({
      chargerId: ctx.chargerId,
      tariffId: active.id,
      priceCentsKwh: price,
      basePriceCentsKwh: ctx.basePriceCentsKwh,
      strategy,
      features: { ...ctx, now: ctx.now.toISOString() },
      explanation: { applied, clamped },
    })

    return { priceCentsKwh: price, strategy, applied, clamped }
  }
}

export const pricingService = new PricingService(withFallback(aiStrategy, rulesStrategy))

// Leitura simples para a tool `get_current_price` do agente: tarifa vigente (piso/teto/base)
// e, se houver, a última decisão registrada para o carregador — nunca recalcula, só relata.
export const pricingQueries = {
  activeTariff: async (workspaceId: string) => {
    const [active] = await db
      .select()
      .from(tariff)
      .where(and(eq(tariff.workspaceId, workspaceId), eq(tariff.active, true)))
      .limit(1)
    return active ?? null
  },
  latestDecision: async (chargerId: string) => {
    const [row] = await db
      .select()
      .from(pricingDecision)
      .where(eq(pricingDecision.chargerId, chargerId))
      .orderBy(desc(pricingDecision.createdAt))
      .limit(1)
    return row ?? null
  },
  /** Tarifa base (custo da concessionária) editada pelo gestor. Cria a tarifa se não houver. */
  setBasePrice: async (workspaceId: string, basePriceCentsKwh: number) => {
    const floor = Math.floor(basePriceCentsKwh * 0.5)
    const ceil = Math.ceil(basePriceCentsKwh * 1.5)
    const active = await pricingQueries.activeTariff(workspaceId)
    if (!active) {
      const [created] = await db
        .insert(tariff)
        .values({ workspaceId, name: 'Tarifa Padrão', basePriceCentsKwh, minPriceCentsKwh: floor, maxPriceCentsKwh: ceil })
        .returning()
      return created!
    }
    // piso/teto do motor de preço acompanham a faixa do mult (0,5×–1,5×) se a base sair deles
    const [updated] = await db
      .update(tariff)
      .set({
        basePriceCentsKwh,
        minPriceCentsKwh: Math.min(active.minPriceCentsKwh, floor),
        maxPriceCentsKwh: Math.max(active.maxPriceCentsKwh, ceil),
      })
      .where(eq(tariff.id, active.id))
      .returning()
    return updated!
  },
  // Previsão do motor shadow pras próximas horas — não recalcula preço nenhum,
  // só repassa o que o `ai/` já sabe (ver ai/app/pricing/engine.py::predict_curve).
  forecast: (hoursAhead?: number) => aiClient.forecast(hoursAhead),
}
