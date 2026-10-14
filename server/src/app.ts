import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { ZodError } from 'zod'
import { env } from './config/env.js'
import { auth } from './infra/auth/auth.js'
import { adminRoutes } from './modules/admin/admin.routes.js'
import { webhookRoutes } from './modules/charges/webhooks.routes.js'
import { agentRoutes } from './modules/agent/agent.routes.js'
import { meRoutes } from './modules/me/me.routes.js'
import { reservationsRoutes } from './modules/reservations/reservations.routes.js'
import { pricingRoutes } from './modules/pricing/pricing.routes.js'
import { stationsRoutes } from './modules/stations/stations.routes.js'
import { internalRoutes } from './modules/stations/stations.internal.js'
import { semsRoutes } from './modules/sems/sems.routes.js'
import { semsAdminRoutes } from './modules/sems/sems.admin.routes.js'
import { semsInternalRoutes } from './modules/sems/sems.internal.js'
import { superRoutes } from './modules/workspaces/workspaces.routes.js'
import { pricingInternalRoutes } from './modules/pricing/pricing.internal.js'
import { meInternalRoutes } from './modules/me/me.internal.js'
import { mountFrontend } from './static.js'
import { AppError } from './shared/errors.js'

export const app = new Hono()

app.use('/api/*', cors({ origin: env.WEB_ORIGIN, credentials: true }))

app.get('/healthz', (c) => c.text('ok'))
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

app.route('/api/stations', stationsRoutes)
app.route('/api/pricing', pricingRoutes)
app.route('/api/agent', agentRoutes)
app.route('/api/me', meRoutes)
app.route('/api/reservations', reservationsRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api/super', superRoutes)
app.route('/api/webhooks', webhookRoutes)
app.route('/api/sems-proxy', semsRoutes)
// /internal/* e /admin/* NÃO devem ser expostos no domínio público (ver docs/ARCHITECTURE.md §8)
app.route('/internal', internalRoutes)
app.route('/internal', semsInternalRoutes)
app.route('/internal', pricingInternalRoutes)
app.route('/internal', meInternalRoutes)
app.route('/admin/sems', semsAdminRoutes)

// Front por último: rotas de API têm prioridade sobre o fallback do SPA.
mountFrontend(app)

app.onError((err, c) => {
  if (err instanceof ZodError) return c.json({ error: 'VALIDATION', issues: err.issues }, 400)
  if (err instanceof AppError) return c.json({ error: err.code, message: err.message }, err.status as 400)
  const pgCode = (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code
  if (pgCode === '23505') return c.json({ error: 'CONFLICT', message: 'Já existe um registro com esse valor' }, 409)
  if (pgCode === '23503') return c.json({ error: 'CONFLICT', message: 'Registro em uso por outro cadastro' }, 409)
  if (pgCode === '40001') return c.json({ error: 'CONFLICT', message: 'Conflito ao salvar, tente de novo' }, 409)
  console.error(err)
  return c.json({ error: 'INTERNAL' }, 500)
})
