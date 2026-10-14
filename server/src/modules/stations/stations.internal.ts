import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { env } from '../../config/env.js'
import { AppError } from '../../shared/errors.js'
import { stationsService } from './stations.service.js'

const internalOnly = createMiddleware(async (c, next) => {
  if (c.req.header('X-Internal-Token') !== env.AI_INTERNAL_TOKEN) {
    throw new AppError('Não autorizado', 401, 'UNAUTHORIZED')
  }
  await next()
})

/**
 * Endpoints que as TOOLS do agente Python chamam. Passam pelos mesmos services da API,
 * então o agente herda regras de negócio e validação em vez de ler o banco direto.
 */
export const internalRoutes = new Hono()
  .use(internalOnly)
  .get('/stations', async (c) => c.json(await stationsService.list()))
