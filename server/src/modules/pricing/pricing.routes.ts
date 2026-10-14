import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, type AuthVars } from '../../infra/auth/middleware.js'
import { AppError, ForbiddenError, NotFoundError } from '../../shared/errors.js'
import { billingService } from '../billing/billing.service.js'
import { stationsService } from '../stations/stations.service.js'
import { workspacesRepository } from '../workspaces/workspaces.repository.js'
import { pricingQueries, pricingService } from './pricing.service.js'

const quoteBody = z.object({
  chargerId: z.string(),
  basePriceCentsKwh: z.number().int().positive(),
  occupancy: z.number().min(0).max(1),
  gridLoad: z.number().min(0).max(1),
  recentDemandKwh: z.number().nonnegative(),
  previousPriceCentsKwh: z.number().int().optional(),
})

export const pricingRoutes = new Hono<{ Variables: AuthVars }>()
  .use(requireAuth)
  // superadmin ou admin do condomínio dono do carregador (a tarifa é a dele)
  .post('/quote', async (c) => {
    const body = quoteBody.parse(await c.req.json())
    const workspaceId = await stationsService.workspaceOfCharger(body.chargerId)
    if (!workspaceId) throw new NotFoundError('Carregador')
    const user = c.get('user')
    if (user.role !== 'SUPER_ADMIN' && (await workspacesRepository.member(workspaceId, user.id))?.role !== 'ADMIN') {
      throw new ForbiddenError()
    }
    return c.json(await pricingService.quote({ ...body, now: new Date() }, workspaceId))
  })
  /**
   * Curva de preço por hora (tarifa base × mult da matriz de demanda) — a MESMA regra que
   * cobra a sessão, então o que o morador vê ao agendar é o que vai para a fatura.
   */
  .get('/curve', async (c) => {
    const q = z
      .object({ chargerId: z.string().min(1), hours: z.coerce.number().int().min(1).max(24 * 8).default(48) })
      .parse(c.req.query())
    return c.json(await billingService.priceCurve(q.chargerId, new Date(), q.hours))
  })
  /** Previsão do modelo shadow do `ai/` (comparação no painel do gestor, não decide preço). */
  .get('/forecast', async (c) => {
    const hoursAhead = z.coerce.number().int().min(1).max(48).default(24).parse(c.req.query('hoursAhead'))
    try {
      return c.json(await pricingQueries.forecast(hoursAhead))
    } catch (e) {
      const reason = e instanceof AppError ? e.message : 'serviço de IA indisponível'
      return c.json({ available: false, reason, hours: [], cheapest_at: null, model_version: null })
    }
  })
