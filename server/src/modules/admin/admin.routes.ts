import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../../infra/auth/middleware.js'
import { isPeriod, periodOf, periodRange } from '../../shared/time.js'
import { billingService } from '../billing/billing.service.js'
import { chargesService } from '../charges/charges.service.js'
import { pricingQueries } from '../pricing/pricing.service.js'
import { residentsService } from '../residents/residents.service.js'
import { sessionsService } from '../sessions/sessions.service.js'
import { settingsService } from '../settings/settings.service.js'
import { stationsService } from '../stations/stations.service.js'
import { unitsService } from '../units/units.service.js'
import { isSuperAdmin } from '../workspaces/domain/permissions.js'
import {
  actorOf, requireWorkspaceAdmin, withWorkspace, wsOf, type WorkspaceVars,
} from '../workspaces/workspace.middleware.js'
import { workspacesService } from '../workspaces/workspaces.service.js'
import { overviewService } from './overview.service.js'

const periodQ = z.object({ period: z.string().refine(isPeriod, 'período no formato AAAA-MM').optional() })
const periodOrNow = (p?: string) => p ?? periodOf(new Date())
const role = z.enum(['USER', 'ADMIN'])
const adminTitle = z.enum(['SINDICO', 'SUBSINDICO'])
const nullableId = z.string().min(1).nullable()
const chargeMethod = z.enum(['PIX', 'BOLETO'])

const stationBody = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(200).nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  kind: z.enum(['CONDOMINIO', 'PARCEIRO', 'PUBLICO']),
  openingHours: z.string().trim().max(120).nullish(),
  publicPriceCentsKwh: z.number().int().min(0).max(10_000).nullish(),
  // URL externa ou caminho de arquivo do próprio app (public/, ex.: /stations/fiap-paulista.jpg)
  imageUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => /^https?:\/\/\S+$/.test(v) || /^\/\S*$/.test(v), 'Use uma URL (https://…) ou um caminho do app (/…)')
    .nullish(),
  maxPowerKw: z.number().positive().max(400),
  // só o superadmin escolhe o condomínio dono; o síndico cadastra sempre no condomínio ativo
  workspaceId: z.string().min(1).nullish(),
})

const settingsBody = z.object({
  name: z.string().trim().min(1).max(120),
  fixedMonthlyCostCents: z.number().int().min(0).max(100_000_000),
  idleCentsPerMinute: z.number().int().min(0).max(10_000),
  idleGraceMinutes: z.number().int().min(0).max(240),
  dueDay: z.number().int().min(1).max(28),
  basePriceCentsKwh: z.number().int().positive().max(10_000),
})

const entryBody = z.object({
  kind: z.enum(['DESPESA', 'AJUSTE']),
  description: z.string().trim().min(1).max(120),
  amountCents: z.number().int().min(-10_000_000).max(10_000_000),
  userId: nullableId.default(null),
})

const stationScope = (c: Context<{ Variables: WorkspaceVars }>) => ({
  workspaceId: wsOf(c).id,
  superAdmin: isSuperAdmin(actorOf(c)),
})

/**
 * Painel do gestor de UM condomínio: o ativo (header X-Workspace-Id). Entram o superadmin e o
 * admin (síndico/subsíndico) dele; tudo aqui filtra por esse condomínio, e o que chega por id
 * é conferido contra ele. Quem cria quem: domain/permissions. Autorização aqui, não no front
 * (o front só esconde o menu).
 */
export const adminRoutes = new Hono<{ Variables: WorkspaceVars }>()
  .use(requireAuth, withWorkspace, requireWorkspaceAdmin)

  // ---------- visão geral e operação ----------
  .get('/overview', async (c) =>
    c.json(await overviewService.overview(wsOf(c).id, periodOrNow(periodQ.parse(c.req.query()).period))),
  )
  .get('/demand', async (c) => c.json(await overviewService.demand(wsOf(c).id)))
  .get('/sessions', async (c) => {
    const q = periodQ.extend({ unassigned: z.enum(['0', '1']).optional() }).parse(c.req.query())
    return c.json(
      await sessionsService.list({
        ...periodRange(periodOrNow(q.period)),
        unassigned: q.unassigned === '1',
        workspaceId: wsOf(c).id,
      }),
    )
  })
  .patch('/sessions/:id', async (c) => {
    const body = z.object({ userId: nullableId }).parse(await c.req.json())
    await sessionsService.assign(wsOf(c).id, c.req.param('id'), body.userId)
    return c.body(null, 204)
  })
  .post('/sessions/sync', async (c) => c.json(await sessionsService.syncFromSems()))

  // ---------- rateio e faturas ----------
  .get('/billing', async (c) =>
    c.json(await billingService.cycle(wsOf(c).id, periodOrNow(periodQ.parse(c.req.query()).period))),
  )
  // composição detalhada da fatura de um morador (mesma visão do app dele, com as sessões)
  .get('/users/:id/invoice', async (c) =>
    c.json(
      await billingService.userInvoice(wsOf(c).id, c.req.param('id'), periodOrNow(periodQ.parse(c.req.query()).period)),
    ),
  )
  .post('/billing/:period/close', async (c) => {
    const period = z.string().refine(isPeriod).parse(c.req.param('period'))
    return c.json(await billingService.close(wsOf(c).id, period))
  })
  // lançamentos do gestor no ciclo: despesa extra (rateada) ou ajuste de uma pessoa
  .post('/billing/:period/entries', async (c) => {
    const period = z.string().refine(isPeriod).parse(c.req.param('period'))
    const body = entryBody.parse(await c.req.json())
    return c.json(await billingService.addEntry(wsOf(c).id, period, body, c.get('user').id), 201)
  })
  .delete('/billing/:period/entries/:id', async (c) => {
    const period = z.string().refine(isPeriod).parse(c.req.param('period'))
    return c.json(await billingService.removeEntry(wsOf(c).id, period, c.req.param('id')))
  })
  .patch('/invoices/:id', async (c) => {
    const body = z.object({ status: z.enum(['PENDING', 'PAID']) }).parse(await c.req.json())
    return c.json(await billingService.setInvoiceStatus(wsOf(c).id, c.req.param('id'), body.status))
  })

  // ---------- cobranças (Pix/boleto no gateway) ----------
  .get('/charges', async (c) =>
    c.json(await chargesService.ofPeriod(wsOf(c).id, periodOrNow(periodQ.parse(c.req.query()).period))),
  )
  .post('/billing/:period/charges', async (c) => {
    const period = z.string().refine(isPeriod).parse(c.req.param('period'))
    const body = z.object({ method: chargeMethod }).parse(await c.req.json())
    return c.json(await chargesService.issueForCycle(wsOf(c).id, period, body.method))
  })
  .post('/invoices/:id/charges', async (c) => {
    const body = z.object({ method: chargeMethod }).parse(await c.req.json())
    return c.json(await chargesService.issue(c.req.param('id'), body.method, { workspaceId: wsOf(c).id }), 201)
  })
  .get('/invoices/:id/charges', async (c) =>
    c.json(await chargesService.ofInvoice(c.req.param('id'), { workspaceId: wsOf(c).id })),
  )
  .post('/charges/:id/cancel', async (c) =>
    c.json(await chargesService.cancel(c.req.param('id'), { workspaceId: wsOf(c).id })),
  )
  .post('/charges/:id/simulate-payment', async (c) =>
    c.json(await chargesService.simulatePayment(c.req.param('id'), { workspaceId: wsOf(c).id })),
  )

  // ---------- configurações (rateio + tarifa base) ----------
  .get('/settings', async (c) => {
    const ws = wsOf(c).id
    const [settings, tariff] = await Promise.all([settingsService.get(ws), pricingQueries.activeTariff(ws)])
    return c.json({ ...settings, basePriceCentsKwh: tariff?.basePriceCentsKwh ?? null, tariff })
  })
  .put('/settings', async (c) => {
    const ws = wsOf(c).id
    const { basePriceCentsKwh, ...rest } = settingsBody.parse(await c.req.json())
    const [settings, tariff] = await Promise.all([
      settingsService.update(ws, rest),
      pricingQueries.setBasePrice(ws, basePriceCentsKwh),
    ])
    // a tarifa nova vale para sessões que ainda vão entrar; ociosidade reprecifica o ciclo aberto
    const chargerId = await stationsService.homeChargerOf(ws)
    if (chargerId) await sessionsService.repriceCharger(chargerId)
    return c.json({ ...settings, basePriceCentsKwh: tariff.basePriceCentsKwh, tariff })
  })

  // ---------- unidades ----------
  .get('/units', async (c) => c.json(await unitsService.list(wsOf(c).id)))
  .post('/units', async (c) => {
    const body = z.object({ label: z.string().trim().min(1).max(60), stationId: nullableId.optional() }).parse(await c.req.json())
    return c.json(await unitsService.create(wsOf(c).id, body), 201)
  })
  .patch('/units/:id', async (c) => {
    const body = z
      .object({ label: z.string().trim().min(1).max(60), stationId: nullableId })
      .partial()
      .parse(await c.req.json())
    return c.json(await unitsService.update(wsOf(c).id, c.req.param('id'), body))
  })
  .delete('/units/:id', async (c) => {
    await unitsService.remove(wsOf(c).id, c.req.param('id'))
    return c.body(null, 204)
  })

  // ---------- pessoas do condomínio ----------
  .get('/users', async (c) => c.json(await residentsService.listUsers(wsOf(c).id)))
  .post('/users', async (c) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        email: z.string().email(),
        password: z.string().min(8).max(128),
        role: role.default('USER'),
        adminTitle: adminTitle.nullish(),
        unitId: nullableId.optional(),
      })
      .parse(await c.req.json())
    return c.json(await residentsService.createUser(actorOf(c), wsOf(c).id, body), 201)
  })
  .patch('/users/:id', async (c) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        role,
        adminTitle: adminTitle.nullable(),
        kind: z.enum(['MORADOR', 'CONVIDADO']),
        unitId: nullableId,
        password: z.string().min(8).max(128),
        cpfCnpj: z.string().min(11).max(18),
      })
      .partial()
      .parse(await c.req.json())
    await residentsService.updateUser(actorOf(c), wsOf(c).id, c.req.param('id'), body)
    return c.body(null, 204)
  })
  .delete('/users/:id', async (c) => {
    await residentsService.removeUser(actorOf(c), wsOf(c).id, c.req.param('id'))
    return c.body(null, 204)
  })

  // ---------- pedidos de acesso (convidados) ----------
  .get('/join-requests', async (c) => c.json(await workspacesService.requestsFor(wsOf(c).id)))
  .post('/join-requests/:id/approve', async (c) =>
    c.json(await workspacesService.decide(wsOf(c).id, c.get('user').id, c.req.param('id'), true)),
  )
  .post('/join-requests/:id/reject', async (c) =>
    c.json(await workspacesService.decide(wsOf(c).id, c.get('user').id, c.req.param('id'), false)),
  )

  // ---------- cartões RFID ----------
  .get('/cards', async (c) => c.json(await residentsService.listCards(wsOf(c).id)))
  .post('/cards', async (c) => {
    const body = z
      .object({ cardNumber: z.string().trim().min(3).max(64), userId: z.string().min(1), label: z.string().max(60).nullish() })
      .parse(await c.req.json())
    const card = await residentsService.createCard(wsOf(c).id, body)
    await sessionsService.syncFromSems() // sessões antigas desse cartão já caem no morador
    return c.json(card, 201)
  })
  .patch('/cards/:id', async (c) => {
    const body = z
      .object({ userId: z.string().min(1), label: z.string().max(60).nullable(), active: z.boolean() })
      .partial()
      .parse(await c.req.json())
    return c.json(await residentsService.updateCard(wsOf(c).id, c.req.param('id'), body))
  })
  .delete('/cards/:id', async (c) => {
    await residentsService.removeCard(wsOf(c).id, c.req.param('id'))
    return c.body(null, 204)
  })

  // ---------- estações (mapa) ----------
  // a do condomínio ativo; parceiros e pontos públicos (da rede) só o superadmin
  .post('/stations', async (c) => {
    const { maxPowerKw, ...s } = stationBody.parse(await c.req.json())
    return c.json(await stationsService.create(stationScope(c), s, maxPowerKw), 201)
  })
  .patch('/stations/:id', async (c) => {
    const { maxPowerKw, ...s } = stationBody.partial().parse(await c.req.json())
    return c.json(await stationsService.update(stationScope(c), c.req.param('id'), s, maxPowerKw))
  })
  .delete('/stations/:id', async (c) => {
    await stationsService.remove(stationScope(c), c.req.param('id'))
    return c.body(null, 204)
  })
