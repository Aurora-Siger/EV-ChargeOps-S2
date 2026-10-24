import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { AppError } from '../../shared/errors.js'
import { isPeriod, localHourLabel, localStamp, periodOf } from '../../shared/time.js'
import { billingService } from '../billing/billing.service.js'
import { compareWithPrevious } from '../billing/domain/comparison.js'
import { residentsService } from '../residents/residents.service.js'
import { isOccupied, semsService } from '../sems/sems.service.js'
import { ASSUMED_START_SOC, RESERVATION_HORIZON_DAYS, reservationsService } from '../reservations/reservations.service.js'
import { recommendedForDeadline } from '../reservations/domain/scheduling.js'
import { sessionsService } from '../sessions/sessions.service.js'
import { stationsService } from '../stations/stations.service.js'
import { workspacesService } from '../workspaces/workspaces.service.js'

const internalOnly = createMiddleware(async (c, next) => {
  if (c.req.header('X-Internal-Token') !== env.AI_INTERNAL_TOKEN) {
    throw new AppError('Não autorizado', 401, 'UNAUTHORIZED')
  }
  await next()
})

type ListedSession = Awaited<ReturnType<typeof sessionsService.list>>[number]

/** Sessão enxuta para o agente: só o que explica o valor (quando, quanto, a que preço). */
const sessionOut = (s: ListedSession) => ({
  startedAt: s.startedAt.toISOString(),
  local: localHourLabel(s.startedAt),
  energyKwh: s.energyKwh,
  durationMin: s.durationMin,
  mult: s.mult,
  level: s.level,
  chargedCents: s.chargedCents,
})

/** Condomínio padrão do usuário (o agente não tem seletor): erro claro se ele não tem nenhum. */
async function workspaceOf(userId: string) {
  const ws = await workspacesService.defaultFor(userId)
  if (!ws) throw new AppError('Você ainda não participa de nenhum condomínio.', 400, 'NO_WORKSPACE')
  return ws.id
}

const HOUR_MS = 3_600_000
/** Pedido de início "às 7h" que chega 7h00min e uns segundos ainda pega o horário das 7h. */
const START_SNAP_MS = 10 * 60_000
/** Horários de início oferecidos a partir do pedido. */
const START_OPTIONS_HOURS = 4

// Início pode ser agora (0); prazo precisa de pelo menos meia hora.
const scheduleBody = z
  .object({
    // meta em % ou em km de autonomia do carro cadastrado; sem nenhuma, a do dia a dia
    targetSoc: z.number().int().min(1).max(100).optional(),
    targetKm: z.number().int().min(1).max(2000).optional(),
    hoursFromNow: z.number().min(0).max(24 * RESERVATION_HORIZON_DAYS),
    kind: z.enum(['deadline', 'start']).default('deadline'),
  })
  .refine((b) => b.kind === 'start' || b.hoursFromNow >= 0.5, { message: 'O prazo precisa ser de pelo menos 30 minutos' })

/**
 * Instante pedido pelo agente. `hoursFromNow` é relativo ao relógio do Python e vem
 * arredondado, então "22:00" chegava 21:59:59,8 — virava "21h59" e a primeira meia hora
 * caía na tarifa das 21h. O agente sempre fala em minuto cheio: arredonda pra ele ("agora" fica
 * exato).
 */
/**
 * "Começar agora" com o carro do próprio morador já na tomada: vai pelo "já plugado" da tela
 * (começa na hora), não pela reserva por horário — que veria o carregador ocupado pelo carro dele.
 */
async function startsNowPlugged(userId: string, body: { kind: 'deadline' | 'start'; hoursFromNow: number }) {
  if (body.kind !== 'start' || body.hoursFromNow > 0) return false
  const live = await semsService.live()
  if (!live || !isOccupied(live)) return false
  const occupant = await stationsService.occupant(userId)
  return !occupant || occupant.isMe
}

function requestedAt(now: number, hoursFromNow: number): Date {
  const at = now + hoursFromNow * HOUR_MS
  return new Date(hoursFromNow > 0 ? Math.round(at / 60_000) * 60_000 : at)
}

/** Meta quando o morador não diz quanto quer: a recomendação dos fabricantes pro dia a dia. */
const DAILY_TARGET_SOC = 80

/**
 * Meta em % a partir do que o morador pediu: % direto, ou km de autonomia convertidos pela
 * autonomia de carga cheia do carro (arredonda pra cima, de 5 em 5, até 100%).
 */
function resolveTarget(body: { targetSoc?: number; targetKm?: number }, rangeKm: number | null) {
  if (body.targetKm !== undefined) {
    if (!rangeKm) {
      throw new AppError('O carro não tem autonomia cadastrada (Perfil): use a meta em %, 80% é o dia a dia.', 400, 'NO_RANGE')
    }
    return Math.min(100, Math.ceil((body.targetKm / rangeKm) * 20) * 5)
  }
  return body.targetSoc ?? DAILY_TARGET_SOC
}

/** Carro e carregador do agendamento pelo Volt: o primeiro veículo e o carregador da unidade. */
async function scheduleTarget(userId: string, body: { targetSoc?: number; targetKm?: number }) {
  const workspaceId = await workspaceOf(userId)
  const [chargerId, vehicles] = await Promise.all([
    residentsService.homeChargerId(userId, workspaceId),
    residentsService.listVehicles(userId),
  ])
  const vehicle = vehicles[0]
  if (!vehicle) throw new AppError('Você ainda não tem um carro cadastrado no app — cadastra em Perfil antes de agendar.', 400, 'NO_VEHICLE')
  if (!chargerId) throw new AppError('Nenhum carregador vinculado à sua unidade — fala com o gestor do condomínio.', 400, 'NO_CHARGER')
  const targetSoc = resolveTarget(body, vehicle.rangeKm)
  const km = (pct: number) => (vehicle.rangeKm ? Math.round((vehicle.rangeKm * pct) / 100) : null)
  return {
    req: { chargerId, vehicleId: vehicle.id, targetSoc },
    // o Volt fala da meta em km do carro (como a tela), com o % entre parênteses
    goal: {
      vehicleModel: vehicle.model,
      targetSoc,
      targetKm: km(targetSoc),
      fullRangeKm: km(100),
      defaultTarget: body.targetSoc === undefined && body.targetKm === undefined,
    },
  }
}

/**
 * Dados do PRÓPRIO usuário para as tools do agente, no condomínio padrão dele. O `userId` vem do backend (sessão do Better
 * Auth repassada em /api/agent/chat), nunca do texto do LLM. Mesmos services de `/api/me`.
 */
export const meInternalRoutes = new Hono()
  .use(internalOnly)
  .get('/users/:id/invoice', async (c) => {
    const period = z.string().refine(isPeriod).optional().parse(c.req.query('period')) ?? periodOf(new Date())
    const userId = c.req.param('id')
    const inv = await billingService.userInvoice(await workspaceOf(userId), userId, period)
    const peak = inv.sessions.filter((s) => s.level === 'peak')
    return c.json({
      period: inv.period,
      closed: inv.closed,
      activeUsers: inv.activeUsers,
      fixedMonthlyCostCents: inv.fixedMonthlyCostCents,
      // despesas extras do mês (rateadas) e ajustes do gestor nesta fatura, com a descrição dele
      entries: inv.entries.map((e) => ({ kind: e.kind, description: e.description, amountCents: e.amountCents })),
      line: inv.line && {
        sessionsCount: inv.line.sessionsCount,
        energyKwh: inv.line.energyKwh,
        energyCostCents: inv.line.energyCostCents,
        chargedCents: inv.line.chargedCents,
        surplusCents: inv.line.surplusCents,
        fixedShareCents: inv.line.fixedShareCents,
        creditCents: inv.line.creditCents,
        adjustmentCents: inv.line.adjustmentCents,
        totalCents: inv.line.totalCents,
        status: inv.line.status,
        dueDate: inv.line.dueDate,
      },
      // diferença para o mês anterior já calculada e escrita: com os dois totais crus o modelo
      // errava a conta e a direção
      comparison: compareWithPrevious({
        period: inv.period,
        totalCents: inv.line?.totalCents ?? null,
        previousTotalCents: inv.previousTotalCents,
        closed: inv.closed,
      }),
      // o agente só precisa saber se já tem cobrança e em que situação; QR/linha ficam na tela
      charges: inv.charges.map((ch) => ({
        method: ch.method,
        status: ch.status,
        amountCents: ch.amountCents,
        dueDate: ch.dueDate,
        paidAt: ch.paidAt,
      })),
      peakSessions: { count: peak.length, energyKwh: Math.round(peak.reduce((a, s) => a + s.energyKwh, 0) * 100) / 100 },
      sessions: inv.sessions.map(sessionOut),
    })
  })
  .get('/users/:id/sessions', async (c) => {
    const limit = z.coerce.number().int().min(1).max(20).default(5).parse(c.req.query('limit'))
    const userId = c.req.param('id')
    const sessions = await sessionsService.list({ userId, workspaceId: await workspaceOf(userId), limit })
    return c.json({ sessions: sessions.map(sessionOut) })
  })
  /**
   * Primeira etapa do agendamento pelo Volt (nada é gravado). Com prazo e carro plugado, o
   * servidor escolhe a janela mais barata na confirmação. Fora da tomada, a carga só começa
   * quando o morador plugar, então o horário é dele: com prazo, devolvemos os horários livres
   * que terminam no prazo (o mais cedo e os mais baratos); com início, os horários livres a
   * partir dele. Cada opção traz `horario` (local) pra confirmar exatamente aquele início.
   */
  .post('/users/:id/schedule-charge/preview', async (c) => {
    const userId = c.req.param('id')
    const body = scheduleBody.parse(await c.req.json())
    const { req, goal } = await scheduleTarget(userId, body)
    const now = Date.now()
    if (await startsNowPlugged(userId, body)) {
      const p = await reservationsService.plugInPreview(userId, req)
      // sem janela agora (a carga bate na reserva seguinte): cai na busca do próximo horário livre
      if (p.window) return c.json({
        ...goal,
        pluggedIn: true,
        kind: 'start',
        fromLocal: localHourLabel(new Date(now)),
        assumedStartSoc: p.assumedStartSoc,
        options: [
          {
            horario: 'agora',
            startsLocal: 'agora',
            endsLocal: localHourLabel(p.window.end),
            level: p.window.level,
            estimatedCostCents: p.window.costCents,
            recommended: true,
          },
        ],
      })
    }
    const at = requestedAt(now, body.hoursFromNow)
    const live = await semsService.live()
    const pluggedIn = !!live && isOccupied(live) && live.soc !== null
    if (body.kind === 'deadline' && pluggedIn) {
      return c.json({ ...goal, pluggedIn, currentSoc: live!.soc, deadlineLocal: localHourLabel(at) })
    }

    const window =
      body.kind === 'deadline'
        ? { from: new Date(now), to: at }
        : { from: new Date(at.getTime() - START_SNAP_MS), to: new Date(at.getTime() + START_OPTIONS_HOURS * HOUR_MS) }
    const { slots } = await reservationsService.startSlots(userId, { ...req, ...window })
    let usable = slots.filter((s) => s.free && s.costCents !== null && (body.kind === 'start' || s.endsAt <= at))
    // Início sem nenhum horário livre perto do pedido (carregador reservado, fora do
    // funcionamento): em vez de devolver nada, procura a primeira vaga no horizonte inteiro.
    const widened = body.kind === 'start' && usable.length === 0
    if (widened) {
      const wide = await reservationsService.startSlots(userId, {
        ...req,
        from: window.from,
        to: new Date(now + RESERVATION_HORIZON_DAYS * 24 * HOUR_MS),
      })
      usable = wide.slots.filter((s) => s.free && s.costCents !== null)
    }
    // Prazo: a recomendada (início realista, com folga antes do prazo) e o mais cedo possível.
    const recommended = body.kind === 'start' ? usable[0] : recommendedForDeadline(usable, at)
    const options =
      body.kind === 'start'
        ? usable.slice(0, 4)
        : [...new Set([usable[0], recommended])]
            .filter((s) => s !== undefined)
            .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime())
    return c.json({
      ...goal,
      pluggedIn,
      kind: body.kind,
      ...(body.kind === 'deadline' ? { deadlineLocal: localHourLabel(at) } : { fromLocal: localHourLabel(at) }),
      widened,
      assumedStartSoc: ASSUMED_START_SOC,
      options: options.map((s) => ({
        horario: s.now ? 'agora' : localStamp(s.startsAt),
        startsLocal: s.now ? 'agora' : localHourLabel(s.startsAt),
        endsLocal: localHourLabel(s.endsAt),
        level: s.level,
        estimatedCostCents: s.costCents,
        recommended: s === recommended,
      })),
    })
  })
  /**
   * Única tool de escrita do agente: o Volt já pediu confirmação explícita ao usuário antes de
   * chamar isso (ver `schedule_charge` em ai/app/agent/tools.py) — aqui só reaplicamos as
   * mesmas regras de negócio que a tela de Agendar usa (POST /api/reservations/{now,at}).
   *
   * `kind` diz o que `hoursFromNow` significa: `deadline` é o prazo pra terminar ("pronto até as
   * 7h") e só vale com o carro plugado, quando o servidor escolhe a janela pela bateria real;
   * `start` é quando o morador vai plugar, e a janela parte da bateria assumida até a telemetria
   * mostrar a real.
   *
   * A resposta só traz horários já no fuso do condomínio: com o ISO em UTC o modelo lia
   * "06:09Z" como 6h09 e anunciava a reserva 3h depois do que ficou gravado.
   */
  .post('/users/:id/schedule-charge', async (c) => {
    const userId = c.req.param('id')
    const body = scheduleBody.parse(await c.req.json())
    const { req, goal } = await scheduleTarget(userId, body)
    const at = requestedAt(Date.now(), body.hoursFromNow)
    const r = (await startsNowPlugged(userId, body))
      ? await reservationsService.scheduleNow(userId, req)
      : body.kind === 'start'
        ? await reservationsService.scheduleAt(userId, { ...req, startsAt: at })
        : await reservationsService.scheduleNow(userId, { ...req, deadlineHours: body.hoursFromNow })
    return c.json({
      status: r.status,
      startsLocal: r.startsAt && localHourLabel(r.startsAt),
      endsLocal: r.endsAt && localHourLabel(r.endsAt),
      // sem carro plugado a duração parte da bateria assumida; o fim muda quando ele plugar
      ...(r.startSoc === null && { assumedStartSoc: ASSUMED_START_SOC }),
      targetSoc: r.targetSoc,
      targetKm: goal.targetKm,
      estimatedCostCents: r.estimatedCostCents,
    })
  })
