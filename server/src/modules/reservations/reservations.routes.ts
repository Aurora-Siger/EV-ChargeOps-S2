import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, type AuthVars } from '../../infra/auth/middleware.js'
import { reservationsService } from './reservations.service.js'

/**
 * Quanto carregar, numa das três formas: meta de bateria (%), energia (kWh) ou valor (centavos).
 * Exatamente uma delas.
 */
const goal = {
  targetSoc: z.coerce.number().int().min(1).max(100).optional(),
  energyKwh: z.coerce.number().min(1).max(200).optional(),
  budgetCents: z.coerce.number().int().min(100).max(100_000).optional(),
}
const oneGoal = (g: { targetSoc?: number; energyKwh?: number; budgetCents?: number }) =>
  [g.targetSoc, g.energyKwh, g.budgetCents].filter((v) => v !== undefined).length === 1
const GOAL_MSG = 'Escolha uma forma: bateria, kWh ou valor'

const nowBody = z.object({
  chargerId: z.string().min(1),
  vehicleId: z.string().min(1),
  ...goal,
  // sem prazo (a tela): começa agora; com prazo (o Volt): a janela mais barata até lá
  deadlineHours: z.number().min(0.5).max(24 * 7).optional(),
  // Só vale quando a telemetria não traz a bateria (ver scheduleNow).
  startSoc: z.number().int().min(0).max(99).optional(),
}).refine(oneGoal, GOAL_MSG)

const nowPreviewQuery = z.object({
  chargerId: z.string().min(1),
  vehicleId: z.string().min(1),
  ...goal,
}).refine(oneGoal, GOAL_MSG)

const laterBody = z.object({
  chargerId: z.string().min(1),
  vehicleId: z.string().min(1),
  targetSoc: z.number().int().min(1).max(100),
  deadlineAt: z.coerce.date(),
})

const slotsQuery = z
  .object({
    chargerId: z.string().min(1),
    vehicleId: z.string().min(1),
    ...goal,
    from: z.coerce.date(),
    to: z.coerce.date(),
    startSoc: z.coerce.number().int().min(0).max(99).optional(),
  })
  .refine(oneGoal, GOAL_MSG)
  .refine((q) => q.to > q.from && q.to.getTime() - q.from.getTime() <= 8 * 24 * 3_600_000, 'Intervalo inválido (até 8 dias)')

const atBody = z.object({
  chargerId: z.string().min(1),
  vehicleId: z.string().min(1),
  ...goal,
  startsAt: z.coerce.date(),
  // bateria informada pelo morador — só pra começar agora
  startSoc: z.number().int().min(0).max(99).optional(),
}).refine(oneGoal, GOAL_MSG)

export const reservationsRoutes = new Hono<{ Variables: AuthVars }>()
  .use(requireAuth)
  .get('/availability', async (c) => {
    const q = z
      .object({ chargerId: z.string().min(1), from: z.coerce.date(), to: z.coerce.date() })
      .parse(c.req.query())
    return c.json(await reservationsService.availability(c.get('user').id, q.chargerId, q.from, q.to))
  })
  // "Já plugado": zero pergunta de bateria, o servidor lê o SOC real e escolhe a janela sozinho.
  .post('/now', async (c) => {
    const body = nowBody.parse(await c.req.json())
    return c.json(await reservationsService.scheduleNow(c.get('user').id, body), 201)
  })
  // Prévia do "já plugado" pra uma meta: começa agora, quando fica pronto e quanto custa.
  .get('/now-preview', async (c) => {
    const q = nowPreviewQuery.parse(c.req.query())
    return c.json(await reservationsService.plugInPreview(c.get('user').id, q))
  })
  // "Agendar pra depois": só meta % + prazo — o horário é resolvido quando o carro pluga.
  .post('/later', async (c) => {
    const body = laterBody.parse(await c.req.json())
    return c.json(await reservationsService.scheduleLater(c.get('user').id, body), 201)
  })
  // Horários de início livres pra uma meta de bateria (tela de agendar).
  .get('/start-slots', async (c) => {
    const q = slotsQuery.parse(c.req.query())
    return c.json(await reservationsService.startSlots(c.get('user').id, q))
  })
  // Reserva por horário de início: bloqueia o carregador já; o fim é ajustado quando o carro pluga.
  .post('/at', async (c) => {
    const body = atBody.parse(await c.req.json())
    return c.json(await reservationsService.scheduleAt(c.get('user').id, body), 201)
  })
  .delete('/:id', async (c) => {
    await reservationsService.cancel(c.get('user'), c.req.param('id'))
    return c.body(null, 204)
  })
