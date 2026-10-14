import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { AppError } from '../../shared/errors.js'
import { localHourLabel } from '../../shared/time.js'
import { billingService } from '../billing/billing.service.js'
import type { HourPrice } from '../billing/domain/demand.js'
import { residentsService } from '../residents/residents.service.js'
import { stationsService } from '../stations/stations.service.js'
import { workspacesService } from '../workspaces/workspaces.service.js'
import { pricingQueries } from './pricing.service.js'

const internalOnly = createMiddleware(async (c, next) => {
  if (c.req.header('X-Internal-Token') !== env.AI_INTERNAL_TOKEN) {
    throw new AppError('Não autorizado', 401, 'UNAUTHORIZED')
  }
  await next()
})

/**
 * Carregador "de casa" do usuário no condomínio padrão dele (igual a `/api/me` sem escolha);
 * visitante ou conta sem condomínio, o da SEMS.
 */
async function chargerFor(userId: string | undefined) {
  const ws = userId ? await workspacesService.defaultFor(userId) : null
  const home = ws && userId ? await residentsService.homeChargerId(userId, ws.id) : null
  return home ?? (await stationsService.semsChargerId())
}

const hourOut = (h: HourPrice) => ({
  at: h.at.toISOString(),
  local: localHourLabel(h.at),
  priceCentsKwh: h.priceCentsKwh,
  mult: h.mult,
  level: h.level,
})

/**
 * Preço para o agente. Tudo sai de `billingService.priceCurve`, a mesma regra que cobra a
 * sessão e que o app mostra (card "melhor horário" e Agendar): o que o Volt diz é o que vai
 * para a fatura. A previsão do modelo shadow (`/pricing/forecast`) fica só como comparação.
 */
export const pricingInternalRoutes = new Hono()
  .use(internalOnly)
  .get('/pricing/current', async (c) => {
    const chargerId = await chargerFor(c.req.query('userId'))
    const workspaceId = chargerId ? await stationsService.workspaceOfCharger(chargerId) : null
    const tariff = workspaceId ? await pricingQueries.activeTariff(workspaceId) : null
    if (!tariff) return c.json({ error: 'sem tarifa ativa cadastrada' }, 404)
    const now = chargerId ? (await billingService.priceCurve(chargerId, new Date(), 1)).hours[0] : undefined
    return c.json({
      tariff: { name: tariff.name, basePriceCentsKwh: tariff.basePriceCentsKwh },
      now: now ? hourOut(now) : null,
      rule: 'mult = 0,5 + demanda prevista do mesmo slot hora×dia (regressão linear das últimas 4 semanas), entre 0,5× e 1,5×',
    })
  })
  .get('/pricing/curve', async (c) => {
    const q = z
      .object({ userId: z.string().optional(), hours: z.coerce.number().int().min(1).max(48).default(24) })
      .parse(c.req.query())
    const chargerId = await chargerFor(q.userId)
    if (!chargerId) return c.json({ error: 'nenhum carregador com telemetria cadastrado' }, 404)
    const { basePriceCentsKwh, hours } = await billingService.priceCurve(chargerId, new Date(), q.hours)
    const cheapest = hours.reduce((a, b) => (b.priceCentsKwh < a.priceCentsKwh ? b : a))
    const peak = hours.reduce((a, b) => (b.priceCentsKwh > a.priceCentsKwh ? b : a))
    return c.json({
      basePriceCentsKwh,
      now: hourOut(hours[0]!),
      cheapest: hourOut(cheapest),
      peak: hourOut(peak),
      hours: hours.map(hourOut),
    })
  })
  /**
   * Previsão do modelo shadow do `ai/` (não decide preço). `available: false` quando ainda não
   * há modelo treinado com dado real suficiente — não inventa curva nenhuma nesse caso.
   */
  .get('/pricing/forecast', async (c) => {
    const hoursAhead = Number(c.req.query('hoursAhead') ?? 24)
    return c.json(await pricingQueries.forecast(hoursAhead))
  })
