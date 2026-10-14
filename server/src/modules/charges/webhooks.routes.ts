import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { AppError } from '../../shared/errors.js'
import { chargesService } from './charges.service.js'

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

const event = z.object({
  id: z.string(),
  event: z.string(),
  payment: z.object({ id: z.string(), value: z.number() }).optional(),
})

/** Notificações do provedor de cobrança. Fora de /api/me: não tem sessão, autentica por token. */
export const webhookRoutes = new Hono().post('/asaas', async (c) => {
  const token = c.req.header('asaas-access-token') ?? ''
  if (!env.ASAAS_WEBHOOK_TOKEN || !same(token, env.ASAAS_WEBHOOK_TOKEN)) {
    throw new AppError('Não autorizado', 401, 'UNAUTHENTICATED')
  }
  const body = event.safeParse(await c.req.json().catch(() => null))
  // Evento que não conhecemos também responde 200: o Asaas pausa a fila após falhas seguidas.
  if (body.success && body.data.payment) {
    const { id, event: name, payment } = body.data
    await chargesService.onProviderEvent('asaas', id, name, payment.id, Math.round(payment.value * 100))
  }
  return c.json({ received: true })
})
