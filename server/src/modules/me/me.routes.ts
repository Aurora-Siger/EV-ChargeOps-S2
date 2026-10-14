import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../../infra/auth/middleware.js'
import { isPeriod, periodOf, periodRange } from '../../shared/time.js'
import { billingService } from '../billing/billing.service.js'
import { chargesService } from '../charges/charges.service.js'
import { residentsService } from '../residents/residents.service.js'
import { reservationsService } from '../reservations/reservations.service.js'
import { sessionsService } from '../sessions/sessions.service.js'
import { stationsService } from '../stations/stations.service.js'
import { withWorkspace, wsOf, type WorkspaceVars } from '../workspaces/workspace.middleware.js'
import { workspacesService } from '../workspaces/workspaces.service.js'

// Aceita placa antiga (ABC1234) e Mercosul (ABC1D23) — mesmo formato de 7 caracteres,
// só a posição 5 que vira letra na Mercosul. Normaliza (maiúsculo, sem traço/espaço) antes.
const PLATE_RE = /^[A-Z]{3}\d[A-Z\d]\d{2}$/
const plate = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/[^A-Z0-9]/g, ''))
  .refine((v) => v === '' || PLATE_RE.test(v), 'placa inválida')
  .transform((v) => v || null)
  .nullish()

const vehicleBody = z.object({
  model: z.string().trim().min(1).max(80),
  plate,
  capacityKwh: z.number().positive().max(300),
  rangeKm: z.number().int().positive().max(2000).nullish(),
  maxChargeKw: z.number().positive().max(350),
})

const period = z.string().refine(isPeriod, 'período no formato AAAA-MM').optional()

/**
 * Tudo que é do próprio usuário logado: perfil, condomínios, casa, veículos, sessões e fatura.
 * Casa, sessões e fatura são do condomínio ativo (header X-Workspace-Id).
 */
export const meRoutes = new Hono<{ Variables: WorkspaceVars }>()
  .use(requireAuth, withWorkspace)
  // Quem está carregando agora no carregador do condomínio (pelo RFID), pro morador saber por que está ocupado.
  .get('/charger-occupant', async (c) => c.json(await stationsService.occupant(c.get('user').id)))
  .get('/', async (c) => {
    const { id, role, name, email } = c.get('user')
    const ws = c.get('ws')
    const [home, vehicles, cards, memberships, joinRequests] = await Promise.all([
      ws ? residentsService.home(id, ws.id) : null,
      residentsService.listVehicles(id),
      residentsService.cardsOf(id),
      workspacesService.memberships(id),
      workspacesService.myRequests(id),
    ])
    // Sem unidade vinculada (ou convidado), o carregador "de casa" é o do condomínio ativo.
    const chargerId = home?.chargerId ?? (ws ? await stationsService.homeChargerOf(ws.id) : null)
    const charger = chargerId ? await stationsService.chargerById(chargerId) : null
    return c.json({
      user: { id, role, name, email, hasDocument: await residentsService.hasDocument(id) },
      workspace: ws,
      memberships,
      joinRequests,
      unit: home ? { id: home.unitId, label: home.unitLabel } : null,
      station: home?.stationId ? { id: home.stationId, name: home.stationName, address: home.stationAddress } : null,
      charger: charger ? { id: charger.id, maxPowerKw: Number(charger.maxPowerKw), telemetry: charger.externalId !== null } : null,
      vehicles,
      cards: cards.map(({ id, cardNumber, label, active }) => ({ id, cardNumber, label, active })),
    })
  })
  // CPF/CNPJ do pagador: o Asaas exige para emitir Pix/boleto
  .put('/document', async (c) => {
    const body = z.object({ cpfCnpj: z.string() }).parse(await c.req.json())
    await residentsService.setDocument(c.get('user').id, body.cpfCnpj)
    return c.body(null, 204)
  })
  .get('/sessions', async (c) => {
    const q = z.object({ period, limit: z.coerce.number().int().min(1).max(200).optional() }).parse(c.req.query())
    const range = q.period ? periodRange(q.period) : {}
    const ws = c.get('ws')
    if (!ws) return c.json([])
    return c.json(await sessionsService.list({ ...range, userId: c.get('user').id, workspaceId: ws.id, limit: q.limit ?? 50 }))
  })
  .get('/invoice', async (c) => {
    const q = z.object({ period }).parse(c.req.query())
    return c.json(await billingService.userInvoice(wsOf(c).id, c.get('user').id, q.period ?? periodOf(new Date())))
  })
  // cobrança da própria fatura: o service confere que a fatura/cobrança é de quem está logado
  .post('/invoices/:id/charges', async (c) => {
    const body = z.object({ method: z.enum(['PIX', 'BOLETO']) }).parse(await c.req.json())
    return c.json(await chargesService.issue(c.req.param('id'), body.method, { ownerId: c.get('user').id }), 201)
  })
  .post('/charges/:id/simulate-payment', async (c) =>
    c.json(await chargesService.simulatePayment(c.req.param('id'), { ownerId: c.get('user').id })),
  )
  // ---------- pedidos de acesso a outros condomínios ----------
  .post('/join-requests', async (c) => {
    const body = z
      .object({ workspaceId: z.string().min(1), message: z.string().trim().max(300).nullish() })
      .parse(await c.req.json())
    return c.json(await workspacesService.request(c.get('user').id, body.workspaceId, body.message), 201)
  })
  .delete('/join-requests/:id', async (c) => {
    await workspacesService.cancelMine(c.get('user').id, c.req.param('id'))
    return c.body(null, 204)
  })
  .get('/reservations', async (c) => c.json(await reservationsService.mine(c.get('user').id)))
  .get('/vehicles', async (c) => c.json(await residentsService.listVehicles(c.get('user').id)))
  .post('/vehicles', async (c) => {
    const body = vehicleBody.parse(await c.req.json())
    return c.json(await residentsService.createVehicle(c.get('user').id, body), 201)
  })
  .patch('/vehicles/:id', async (c) => {
    const body = vehicleBody.partial().parse(await c.req.json())
    return c.json(await residentsService.updateVehicle(c.get('user').id, c.req.param('id'), body))
  })
  .delete('/vehicles/:id', async (c) => {
    await residentsService.removeVehicle(c.get('user').id, c.req.param('id'))
    return c.body(null, 204)
  })
