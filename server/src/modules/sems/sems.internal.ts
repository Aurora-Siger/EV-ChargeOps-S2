import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { env } from '../../config/env.js'
import { AppError } from '../../shared/errors.js'
import { semsRepository } from './sems.repository.js'

const internalOnly = createMiddleware(async (c, next) => {
  if (c.req.header('X-Internal-Token') !== env.AI_INTERNAL_TOKEN) {
    throw new AppError('Não autorizado', 401, 'UNAUTHORIZED')
  }
  await next()
})

/**
 * Endpoints que a tool `get_charger_status`/`get_recent_charge_sessions` do agente Python
 * chamam. Mesmos dados que `src/lib/api.ts` expõe via `/api/sems-proxy` (snapshots
 * coletados por `sems.collector.ts`) — aqui só sem o proxy público, direto para o agente.
 */
export const semsInternalRoutes = new Hono()
  .use(internalOnly)
  .get('/sems/status', async (c) => {
    const [detail, lastCharge] = await Promise.all([
      semsRepository.latestSnapshot('detail'),
      semsRepository.latestSnapshot('last_charge'),
    ])
    if (!detail && !lastCharge) return c.json({ error: 'sem dados coletados ainda' }, 404)
    return c.json({
      status: detail ? { collectedAt: detail.collectedAt.toISOString(), data: detail.payload } : null,
      lastCharge: lastCharge ? { collectedAt: lastCharge.collectedAt.toISOString(), data: lastCharge.payload } : null,
    })
  })
  .get('/sems/charge-log', async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? '5') || 5, 20)
    const rows = await semsRepository.chargeLog(limit)
    return c.json({ sessions: rows.map((r) => r.payload) })
  })
