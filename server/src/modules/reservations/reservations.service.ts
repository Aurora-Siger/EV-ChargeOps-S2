import { AppError, ForbiddenError, NotFoundError } from '../../shared/errors.js'
import { startOfLocalHour } from '../../shared/time.js'
import { levelOf } from '../billing/domain/demand.js'
import { billingService } from '../billing/billing.service.js'
import { residentsService } from '../residents/residents.service.js'
import { sessionsRepository } from '../sessions/sessions.repository.js'
import { isOccupied, semsService } from '../sems/sems.service.js'
import { stationsService } from '../stations/stations.service.js'
import { workspacesRepository } from '../workspaces/workspaces.repository.js'
import { fitsOpening, parseOpeningHours } from './domain/opening.js'
import { cheapestWindow, hoursForBudget, startSlots, windowCostCents, type HourPrice } from './domain/scheduling.js'
import { reservationsRepository } from './reservations.repository.js'

const HOUR_MS = 3_600_000
/** Até quantos dias à frente dá pra pedir "pronto até" (horizonte da curva de preço). */
export const RESERVATION_HORIZON_DAYS = 7
/**
 * Reserva por horário de início: antes do carro plugar não há bateria lida, então a janela sai
 * do tamanho de uma carga a partir deste SOC até a meta, e é ajustada quando a telemetria
 * mostra a bateria real (`resolvePendingFor`).
 */
export const ASSUMED_START_SOC = 20
/** Folga do "agora": o morador leva um tempo entre ver a lista e tocar em Agendar. */
const START_TOLERANCE_MS = 10 * 60_000
/** Um plugue ajusta a reserva provisória que começa em até 12h (carro deixado na tomada à noite). */
const PROVISIONAL_LOOKAHEAD_MS = 12 * HOUR_MS

type Vehicle = { id: string; capacityKwh: string | number; maxChargeKw: string | number }
type Charger = { id: string; maxPowerKw: string | number }

const rateOf = (vehicle: Vehicle, charger: Charger) => Math.min(Number(vehicle.maxChargeKw), Number(charger.maxPowerKw))
const energyFor = (vehicle: Vehicle, fromSoc: number, targetSoc: number) =>
  Math.max(0, ((targetSoc - fromSoc) / 100) * Number(vehicle.capacityKwh))

/**
 * As três formas de pedir uma carga: até uma % da bateria, uma quantidade de kWh ou um valor
 * em reais. Quem chama manda uma delas; o Volt continua mandando só `targetSoc`.
 */
export type GoalReq = { targetSoc?: number; energyKwh?: number; budgetCents?: number }
type Goal = { kind: 'SOC'; targetSoc: number } | { kind: 'KWH'; energyKwh: number } | { kind: 'BRL'; budgetCents: number }

export function goalOf(req: GoalReq): Goal {
  if (req.energyKwh !== undefined) return { kind: 'KWH', energyKwh: req.energyKwh }
  if (req.budgetCents !== undefined) return { kind: 'BRL', budgetCents: req.budgetCents }
  if (req.targetSoc !== undefined) return { kind: 'SOC', targetSoc: req.targetSoc }
  throw new AppError('Diz quanto carregar: bateria, kWh ou valor', 400, 'VALIDATION')
}

/** Quanto ainda cabe na bateria a partir de `fromSoc`. */
const roomKwh = (vehicle: Vehicle, fromSoc: number) => Math.max(0, ((100 - fromSoc) / 100) * Number(vehicle.capacityKwh))
/** Onde a energia leva a bateria (a meta gravada nos pedidos por kWh e por valor). */
const socAfter = (vehicle: Vehicle, fromSoc: number, kwh: number) =>
  Math.min(100, Math.max(fromSoc + 1, Math.round(fromSoc + (kwh / Number(vehicle.capacityKwh)) * 100)))
/** Energia do pedido, quando não depende do horário (no pedido por valor, depende: null). */
const fixedEnergy = (goal: Goal, vehicle: Vehicle, fromSoc: number) =>
  goal.kind === 'SOC' ? energyFor(vehicle, fromSoc, goal.targetSoc) : goal.kind === 'KWH' ? Math.min(goal.energyKwh, roomKwh(vehicle, fromSoc)) : null
/** Maior janela que o pedido pode ocupar (no pedido por valor, até encher a bateria). */
const spanHours = (goal: Goal, vehicle: Vehicle, charger: Charger, fromSoc: number) => {
  const fixed = fixedEnergy(goal, vehicle, fromSoc)
  return fixed !== null ? Math.max(0.5, fixed / rateOf(vehicle, charger)) : roomKwh(vehicle, fromSoc) / rateOf(vehicle, charger)
}
/** Duração da janela começando em `start`: fixa, ou o quanto o valor paga nessa curva. */
const goalHours = (goal: Goal, vehicle: Vehicle, charger: Charger, fromSoc: number, curve: HourPrice[], start: number) =>
  goal.kind === 'BRL'
    ? hoursForBudget(curve, start, goal.budgetCents, rateOf(vehicle, charger), spanHours(goal, vehicle, charger, fromSoc))
    : spanHours(goal, vehicle, charger, fromSoc)
/** Energia da janela e a meta de bateria que ela representa. */
const goalOutcome = (goal: Goal, vehicle: Vehicle, charger: Charger, fromSoc: number, hours: number) => {
  const energy = fixedEnergy(goal, vehicle, fromSoc) ?? hours * rateOf(vehicle, charger)
  return { energyKwh: energy, targetSoc: goal.kind === 'SOC' ? goal.targetSoc : socAfter(vehicle, fromSoc, energy) }
}
const checkGoal = (goal: Goal, vehicle: Vehicle, fromSoc: number) => {
  if (goal.kind === 'SOC' && goal.targetSoc <= fromSoc) throw new AppError('A meta precisa ser maior que a bateria atual', 400, 'VALIDATION')
  if (goal.kind !== 'SOC' && roomKwh(vehicle, fromSoc) < 0.1) throw new AppError('A bateria já está cheia', 400, 'VALIDATION')
}

/**
 * Onde o morador pode reservar pela tela de agendar: o carregador de um condomínio de que ele
 * participa (como morador ou convidado; tarifa base do rateio) ou o de um parceiro da rede
 * (preço informado vira a base). Nos dois, a base varia por hora com a demanda. Condomínio de
 * que ele não participa é só com pedido de acesso; ponto público não é da rede: não dá pra
 * segurar vaga.
 */
async function placeFor(userId: string, chargerId: string) {
  const row = await stationsService.chargerWithStation(chargerId)
  if (!row) throw new NotFoundError('Carregador')
  const { charger, station } = row
  const own = station.workspaceId !== null && (await workspacesRepository.member(station.workspaceId, userId)) !== null
  if (!own && station.kind === 'CONDOMINIO') {
    throw new AppError('Você ainda não participa deste condomínio: peça acesso pelo mapa', 403, 'NOT_A_MEMBER')
  }
  if (!own && station.kind !== 'PARCEIRO') throw new AppError('Esse carregador não aceita reserva pelo app', 400, 'VALIDATION')
  if (!own && station.publicPriceCentsKwh === null) throw new AppError('Esse parceiro ainda não tem preço cadastrado', 400, 'VALIDATION')
  return {
    charger,
    station,
    /** Só o carregador ligado à SEMS tem telemetria (ocupação e bateria ao vivo). */
    sems: stationsService.isSemsCharger(charger),
    partnerBaseCentsKwh: own ? null : station.publicPriceCentsKwh,
    opening: parseOpeningHours(station.openingHours),
  }
}

type Place = Awaited<ReturnType<typeof placeFor>>

/**
 * Curva de preço do local. No condomínio, a do rateio. No parceiro, o preço informado vezes o
 * mesmo multiplicador de demanda: parceiro não tem telemetria, então o padrão de demanda vem do
 * carregador do condomínio (o único com histórico) como estimativa da rede. Sem ele, preço
 * informado em toda hora.
 */
async function curveFor(place: Place, from: Date, hours: number): Promise<HourPrice[]> {
  if (place.partnerBaseCentsKwh === null) return (await billingService.priceCurve(place.charger.id, from, hours)).hours
  const base = place.partnerBaseCentsKwh
  const networkId = await stationsService.semsChargerId()
  if (networkId) {
    const { hours: network } = await billingService.priceCurve(networkId, from, hours)
    return network.map((h) => ({ at: h.at, priceCentsKwh: Math.round(base * h.mult), level: h.level }))
  }
  const start = startOfLocalHour(from).getTime()
  return Array.from({ length: hours }, (_, i) => ({ at: new Date(start + i * HOUR_MS), priceCentsKwh: base, level: 'mid' as const }))
}

const checkDeadline = (deadlineAt: Date, now: Date) => {
  if (deadlineAt.getTime() <= now.getTime()) throw new AppError('O prazo precisa ser no futuro', 400, 'VALIDATION')
  if (deadlineAt.getTime() > now.getTime() + RESERVATION_HORIZON_DAYS * 24 * HOUR_MS) {
    throw new AppError(`Só dá pra pedir "pronto até" dentro de ${RESERVATION_HORIZON_DAYS} dias`, 400, 'VALIDATION')
  }
}

/** Carga começando agora (carro já plugado): a janela que termina assim que a energia entra. */
async function asapWindow(chargerId: string, ctx: { now: Date; energyKwh: number; rateKw: number }) {
  const end = new Date(ctx.now.getTime() + (ctx.energyKwh / ctx.rateKw) * HOUR_MS)
  const [{ hours: curve }, busy] = await Promise.all([
    billingService.priceCurve(chargerId, ctx.now, Math.ceil((end.getTime() - ctx.now.getTime()) / HOUR_MS) + 1),
    reservationsRepository.overlapping(chargerId, ctx.now, end),
  ])
  return cheapestWindow({ curve, earliest: ctx.now, deadline: end, energyKwh: ctx.energyKwh, rateKw: ctx.rateKw, busy })
}

export const reservationsService = {
  /** Janelas já ocupadas no carregador (pra evitar duplo agendamento, hoje sem uso na UI nova). */
  async availability(userId: string, chargerId: string, from: Date, to: Date) {
    const rows = await reservationsRepository.overlapping(chargerId, from, to)
    return rows.map((r) => ({ startsAt: r.startsAt, endsAt: r.endsAt, mine: r.userId === userId }))
  },

  mine: (userId: string) => reservationsRepository.ofUser(userId),

  /**
   * Horários em que o morador pode começar a carregar entre `from` e `to`, pra uma meta de
   * bateria: cada um com o nível da tarifa, o custo estimado da janela e se o carregador está
   * livre nela inteira. `startSoc` é a bateria que o morador informou pra começar agora; sem
   * ela, a conta parte de ASSUMED_START_SOC.
   */
  async startSlots(
    userId: string,
    req: GoalReq & { chargerId: string; vehicleId: string; from: Date; to: Date; startSoc?: number },
  ) {
    const now = new Date()
    const goal = goalOf(req)
    const [vehicle, place] = await Promise.all([residentsService.ownVehicle(userId, req.vehicleId), placeFor(userId, req.chargerId)])
    const fromSoc = req.startSoc ?? ASSUMED_START_SOC
    const hours = spanHours(goal, vehicle, place.charger, fromSoc)
    const empty = {
      hours,
      assumedStartSoc: fromSoc,
      socDeclared: req.startSoc !== undefined,
      telemetry: place.sems,
      partnerBaseCentsKwh: place.partnerBaseCentsKwh,
      slots: [],
    }
    const to = new Date(Math.min(req.to.getTime(), now.getTime() + RESERVATION_HORIZON_DAYS * 24 * HOUR_MS))
    if (to.getTime() <= Math.max(req.from.getTime(), now.getTime())) return empty

    const lastEnd = to.getTime() + hours * HOUR_MS
    const [curve, busy, live] = await Promise.all([
      curveFor(place, now, Math.ceil((lastEnd - now.getTime()) / HOUR_MS) + 1),
      reservationsRepository.overlapping(req.chargerId, new Date(Math.max(req.from.getTime(), now.getTime())), new Date(lastEnd)),
      place.sems ? semsService.live() : null,
    ])
    const slots = startSlots({
      curve,
      now,
      from: req.from,
      to,
      hours: goal.kind === 'BRL' ? (s) => goalHours(goal, vehicle, place.charger, fromSoc, curve, s) : hours,
      rateKw: rateOf(vehicle, place.charger),
      busy,
      occupiedNow: live !== null && isOccupied(live),
      opening: place.opening,
    })
    return { ...empty, slots }
  },

  /**
   * Reserva por horário de início (tela de agendar), no condomínio ou num parceiro da rede: o
   * morador escolhe quando começa e a janela já bloqueia o carregador (SCHEDULED), com
   * `startSoc` nulo. No condomínio, quando o carro pluga e a telemetria mostra a bateria real,
   * `resolvePendingFor` ajusta o fim e o custo; no parceiro (sem telemetria) fica a estimativa.
   * O custo sai da curva do local (`curveFor`), a mesma que classificou os horários.
   *
   * Pra começar agora, o morador pode informar a bateria atual (`startSoc`): aí a janela e o
   * custo saem dela e a reserva já nasce com `startSoc` (não é mais provisória). Horário futuro
   * não aceita — a bateria até lá muda.
   */
  async scheduleAt(
    userId: string,
    req: GoalReq & { chargerId: string; vehicleId: string; startsAt: Date; startSoc?: number },
  ) {
    const goal = goalOf(req)
    const now = new Date()
    if (req.startsAt.getTime() < now.getTime() - START_TOLERANCE_MS) {
      throw new AppError('Esse horário já passou — escolhe outro', 400, 'VALIDATION')
    }
    if (req.startsAt.getTime() > now.getTime() + RESERVATION_HORIZON_DAYS * 24 * HOUR_MS) {
      throw new AppError(`Só dá pra agendar dentro de ${RESERVATION_HORIZON_DAYS} dias`, 400, 'VALIDATION')
    }
    if (req.startSoc !== undefined) {
      if (req.startsAt.getTime() > now.getTime()) {
        throw new AppError('A bateria atual só vale pra começar agora', 400, 'VALIDATION')
      }
    }
    const fromSoc = req.startSoc ?? ASSUMED_START_SOC
    const [vehicle, place] = await Promise.all([residentsService.ownVehicle(userId, req.vehicleId), placeFor(userId, req.chargerId)])
    checkGoal(goal, vehicle, fromSoc)
    const live = place.sems ? await semsService.live() : null
    const occupiedNow = live !== null && isOccupied(live)
    // "Agora" chega com o instante da listagem, sempre no passado; hora cheia futura não entra aqui.
    if (req.startsAt.getTime() <= now.getTime() && occupiedNow) {
      throw new AppError('O carregador está em uso agora — escolhe um horário mais tarde', 409, 'CONFLICT')
    }

    const rateKw = rateOf(vehicle, place.charger)
    const start = new Date(Math.max(req.startsAt.getTime(), now.getTime()))
    const span = spanHours(goal, vehicle, place.charger, fromSoc)
    const curve = await curveFor(place, now, Math.ceil((start.getTime() + span * HOUR_MS - now.getTime()) / HOUR_MS) + 1)
    const hours = goalHours(goal, vehicle, place.charger, fromSoc, curve, start.getTime())
    if (hours === null || hours <= 0) throw new AppError('Sem tarifa pra esse horário — escolhe outro', 400, 'VALIDATION')
    const end = new Date(start.getTime() + hours * HOUR_MS)
    if (!fitsOpening(place.opening, start, end)) {
      throw new AppError(`Fora do horário de funcionamento (${place.station.openingHours}) — escolhe outro`, 400, 'VALIDATION')
    }
    const outcome = goalOutcome(goal, vehicle, place.charger, fromSoc, hours)

    const created = await reservationsRepository.createIfFree({
      userId,
      chargerId: req.chargerId,
      vehicleId: vehicle.id,
      startsAt: start,
      endsAt: end,
      // Carro já plugado esperando um horário futuro: bloqueia o carregador pros outros desde já,
      // não só a partir de `start` — senão o carregador aparece "livre" pra outro morador reservar
      // enquanto o carro de quem agendou já está fisicamente na tomada.
      occupiedFromAt: occupiedNow && start.getTime() > now.getTime() ? now : null,
      startSoc: req.startSoc ?? null,
      targetSoc: outcome.targetSoc,
      goal: goal.kind,
      budgetCents: goal.kind === 'BRL' ? goal.budgetCents : null,
      energyKwh: outcome.energyKwh.toFixed(3),
      estimatedCostCents: windowCostCents(curve, start.getTime(), hours, rateKw),
      deadlineAt: end,
      status: 'SCHEDULED',
    })
    if (!created) throw new AppError('Esse horário acabou de ser ocupado — escolhe outro', 409, 'CONFLICT')
    return created
  },

  /**
   * Base do "já plugado": exige o carro plugado agora (e não ser de outro morador), lê o SOC da
   * telemetria e calcula energia e potência. Sem SOC na telemetria (a série de potência acusou
   * carga e o `detail` não), a conta parte de ASSUMED_START_SOC e a reserva nasce provisória
   * (`startSoc` nulo) — o `refineProvisional` ajusta o fim quando a bateria real aparecer.
   */
  async plugInContext(userId: string, req: GoalReq & { chargerId: string; vehicleId: string; startSoc?: number }) {
    const now = new Date()
    const goal = goalOf(req)
    const [vehicle, { charger }, live] = await Promise.all([
      residentsService.ownVehicle(userId, req.vehicleId),
      placeFor(userId, req.chargerId),
      semsService.live(),
    ])
    if (!live || !isOccupied(live)) {
      throw new AppError('O carregador precisa estar com o carro plugado pra usar esse modo', 409, 'NOT_PLUGGED_IN')
    }
    const occupant = await stationsService.occupant(userId)
    if (occupant && !occupant.isMe) {
      throw new AppError(`${occupant.name} está carregando agora — agende um horário`, 409, 'OCCUPIED_BY_OTHER')
    }
    const startSoc = live.soc ?? req.startSoc ?? null
    const fromSoc = startSoc ?? ASSUMED_START_SOC
    checkGoal(goal, vehicle, fromSoc)
    const rateKw = rateOf(vehicle, charger)
    let energyKwh = fixedEnergy(goal, vehicle, fromSoc)
    if (energyKwh === null) {
      // por valor: começa agora, então a energia sai da curva a partir de agora
      const span = spanHours(goal, vehicle, charger, fromSoc)
      const { hours: curve } = await billingService.priceCurve(req.chargerId, now, Math.ceil(span) + 2)
      const h = goalHours(goal, vehicle, charger, fromSoc, curve, now.getTime())
      if (h === null || h <= 0) throw new AppError('Sem tarifa pra calcular esse valor agora', 400, 'VALIDATION')
      energyKwh = h * rateKw
    }
    const { targetSoc } = goalOutcome(goal, vehicle, charger, fromSoc, energyKwh / rateKw)
    return { now, goal, vehicle, charger, startSoc, fromSoc, rateKw, energyKwh, targetSoc }
  },

  /**
   * Prévia do "já plugado" pra uma meta: o carro já está na tomada, então começa agora — a tela
   * mostra quando fica pronto e quanto custa, sem prazo pra ajustar. `window` é null se a carga
   * bate com a reserva seguinte de outro morador.
   */
  async plugInPreview(userId: string, req: GoalReq & { chargerId: string; vehicleId: string }) {
    const ctx = await reservationsService.plugInContext(userId, req)
    return {
      soc: ctx.startSoc,
      assumedStartSoc: ctx.fromSoc,
      energyKwh: ctx.energyKwh,
      targetSoc: ctx.targetSoc,
      window: await asapWindow(req.chargerId, ctx),
    }
  },

  /**
   * Fluxo "já plugado": zero pergunta de bateria — lê o SOC real da telemetria agora. Sem
   * `deadlineHours` (a tela) começa na hora; com ele (o Volt, "pronto até"), o servidor escolhe
   * a janela mais barata dentro do prazo.
   */
  async scheduleNow(
    userId: string,
    req: GoalReq & { chargerId: string; vehicleId: string; deadlineHours?: number; startSoc?: number },
  ) {
    const ctx = await reservationsService.plugInContext(userId, req)
    const { now, goal, vehicle, startSoc, rateKw, energyKwh, targetSoc } = ctx
    let win
    if (req.deadlineHours === undefined) {
      win = await asapWindow(req.chargerId, ctx)
      if (!win) throw new AppError('O carregador está reservado logo em seguida — tenta uma meta menor', 409, 'CONFLICT')
    } else {
      const deadline = new Date(now.getTime() + req.deadlineHours * HOUR_MS)
      const [{ hours: curve }, busy] = await Promise.all([
        billingService.priceCurve(req.chargerId, now, Math.ceil(req.deadlineHours) + 1),
        reservationsRepository.overlapping(req.chargerId, now, deadline),
      ])
      win = cheapestWindow({ curve, earliest: now, deadline, energyKwh, rateKw, busy })
      if (!win) throw new AppError(`Não dá pra chegar a ${targetSoc}% a tempo — tenta uma meta menor ou mais prazo`, 400, 'VALIDATION')
    }
    const deadlineAt = req.deadlineHours === undefined ? win.end : new Date(now.getTime() + req.deadlineHours * HOUR_MS)

    const created = await reservationsRepository.createIfFree({
      userId,
      chargerId: req.chargerId,
      vehicleId: vehicle.id,
      startsAt: win.start,
      endsAt: win.end,
      // Carro já plugado (exigido acima); se a janela mais barata só começa mais tarde, bloqueia
      // o carregador desde já — mesmo raciocínio do `scheduleAt` (ver comentário lá).
      occupiedFromAt: win.start.getTime() > now.getTime() ? now : null,
      startSoc,
      targetSoc,
      goal: goal.kind,
      budgetCents: goal.kind === 'BRL' ? goal.budgetCents : null,
      energyKwh: energyKwh.toFixed(3),
      estimatedCostCents: win.costCents,
      deadlineAt,
      status: 'SCHEDULED',
    })
    if (!created) throw new AppError('Esse horário acabou de ser ocupado — tenta de novo', 409, 'CONFLICT')
    return created
  },

  /**
   * Fluxo "agendar pra depois": sem telemetria ainda, então sem SOC — só meta % + prazo. Vira
   * uma regra (PENDING_PLUGIN); o horário só é decidido quando o carro pluga de verdade
   * (`resolvePendingFor`, chamado pelo sync de sessões a cada coleta da SEMS).
   */
  async scheduleLater(userId: string, req: { chargerId: string; vehicleId: string; targetSoc: number; deadlineAt: Date }) {
    const now = new Date()
    checkDeadline(req.deadlineAt, now)
    const [vehicle] = await Promise.all([
      residentsService.ownVehicle(userId, req.vehicleId),
      placeFor(userId, req.chargerId),
    ])
    return reservationsRepository.createPending({
      userId,
      chargerId: req.chargerId,
      vehicleId: vehicle.id,
      targetSoc: req.targetSoc,
      deadlineAt: req.deadlineAt,
    })
  },

  /**
   * Resolve a regra pendente mais antiga do usuário nesse carregador com o SOC real que acabou
   * de aparecer na telemetria — chamado pelo `sessions.service` assim que uma sessão nova é
   * atribuída a um usuário. Sem janela que caiba no prazo, não faz nada (tenta de novo no próximo
   * poll — a curva muda a cada hora). Sem regra pendente, ajusta a reserva por horário, se houver.
   */
  async resolvePendingFor(userId: string, chargerId: string, soc: number, now: Date) {
    const pending = await reservationsRepository.pendingForUser(userId, chargerId)
    if (!pending) return reservationsService.refineProvisional(userId, chargerId, soc, now)
    if (!pending.vehicleId || pending.deadlineAt.getTime() <= now.getTime() || pending.targetSoc <= soc) {
      // Sem veículo (apagado depois), prazo já vencido ou meta já atingida: nada a resolver.
      await reservationsRepository.expire(pending.id)
      return
    }
    const [vehicleRow, charger] = await Promise.all([
      residentsService.ownVehicle(userId, pending.vehicleId),
      stationsService.chargerById(chargerId),
    ])
    if (!charger) return
    const rateKw = rateOf(vehicleRow, charger)
    const energyKwh = energyFor(vehicleRow, soc, pending.targetSoc)
    const hoursSpan = Math.ceil((pending.deadlineAt.getTime() - now.getTime()) / HOUR_MS) + 1
    const [{ hours: curve }, busy] = await Promise.all([
      billingService.priceCurve(chargerId, now, hoursSpan),
      reservationsRepository.overlapping(chargerId, now, pending.deadlineAt, pending.id),
    ])
    const win = cheapestWindow({ curve, earliest: now, deadline: pending.deadlineAt, energyKwh, rateKw, busy })
    if (!win) return
    await reservationsRepository.resolve(pending.id, chargerId, {
      startsAt: win.start,
      endsAt: win.end,
      startSoc: soc,
      energyKwh: energyKwh.toFixed(3),
      estimatedCostCents: win.costCents,
    })
  },

  /**
   * Reserva por horário (`scheduleAt`) com a bateria real que acabou de chegar: recalcula fim,
   * energia e custo a partir do SOC lido. Mantém o início escolhido — ou agora, se o carro
   * plugou atrasado. Se o novo fim invadir a reserva seguinte, fica como estava.
   */
  async refineProvisional(userId: string, chargerId: string, soc: number, now: Date) {
    const r = await reservationsRepository.provisionalForUser(userId, chargerId, now, PROVISIONAL_LOOKAHEAD_MS)
    if (!r) return
    if (!r.vehicleId || (r.goal === 'SOC' ? r.targetSoc <= soc : soc >= 99)) {
      // Sem veículo (apagado depois) ou meta já atingida: libera o carregador.
      await reservationsRepository.expire(r.id)
      return
    }
    const [vehicleRow, charger] = await Promise.all([
      residentsService.ownVehicle(userId, r.vehicleId),
      stationsService.chargerById(chargerId),
    ])
    if (!charger) return
    const rateKw = rateOf(vehicleRow, charger)
    // kWh pedido continua o mesmo (até onde cabe); valor pedido rende o que a curva paga desde o início
    const goal: Goal =
      r.goal === 'KWH' ? { kind: 'KWH', energyKwh: Number(r.energyKwh ?? 0) }
      : r.goal === 'BRL' && r.budgetCents !== null ? { kind: 'BRL', budgetCents: r.budgetCents }
      : { kind: 'SOC', targetSoc: r.targetSoc }
    const start = new Date(Math.max(r.startsAt!.getTime(), now.getTime()))
    const span = goal.kind === 'BRL' ? spanHours(goal, vehicleRow, charger, soc) : 0
    const { hours: curve } = await billingService.priceCurve(
      chargerId,
      now,
      Math.ceil((start.getTime() + Math.max(span, energyFor(vehicleRow, soc, 100) / rateKw) * HOUR_MS - now.getTime()) / HOUR_MS) + 1,
    )
    const energyKwh =
      goal.kind === 'BRL'
        ? (hoursForBudget(curve, start.getTime(), goal.budgetCents, rateKw, span) ?? 0) * rateKw
        : (fixedEnergy(goal, vehicleRow, soc) ?? 0)
    if (energyKwh <= 0) return
    const hours = energyKwh / rateKw
    const end = new Date(start.getTime() + hours * HOUR_MS)
    await reservationsRepository.resolve(r.id, chargerId, {
      startsAt: start,
      endsAt: end,
      startSoc: soc,
      targetSoc: goal.kind === 'SOC' ? goal.targetSoc : socAfter(vehicleRow, soc, energyKwh),
      energyKwh: energyKwh.toFixed(3),
      estimatedCostCents: windowCostCents(curve, start.getTime(), hours, rateKw),
      deadlineAt: end,
    })
  },

  expireOverdue: (now = new Date()) => reservationsRepository.expireOverdue(now),

  /** Dono da reserva, superadmin ou admin do condomínio do carregador. */
  /**
   * Grade de agendamentos do condomínio (painel do gestor): os carregadores dele, as reservas
   * no intervalo e as sessões reais de recarga no mesmo intervalo, pra comparar agendado × feito.
   */
  async agenda(workspaceId: string, from: Date, to: Date, withCancelled = false) {
    const homeCharger = await stationsService.homeChargerOf(workspaceId)
    const hours = Math.ceil((to.getTime() - from.getTime()) / HOUR_MS)
    const [chargers, reservations, sessions, curve] = await Promise.all([
      reservationsRepository.chargersOfWorkspace(workspaceId),
      reservationsRepository.ofWorkspace(workspaceId, from, to, withCancelled),
      // sessão que começou na véspera ainda pode estar no ar no começo do intervalo
      sessionsRepository.list({ workspaceId, start: new Date(from.getTime() - 24 * HOUR_MS), end: to }),
      // barato/normal/pico de cada hora: a mesma curva que precifica a sessão (sem tarifa ativa, sem curva)
      homeCharger ? billingService.priceCurve(homeCharger, from, hours).catch(() => null) : null,
    ])
    return {
      chargers,
      prices: (curve?.hours ?? []).map((h) => ({ at: h.at, level: h.level, priceCentsKwh: h.priceCentsKwh })),
      reservations,
      sessions: sessions
        .filter((s) => (s.endedAt ?? new Date()) > from)
        .map((s) => ({
          id: s.id,
          chargerId: s.chargerId,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          energyKwh: s.energyKwh,
          durationMin: s.durationMin,
          idleMin: s.idleMin,
          chargedCents: s.chargedCents,
          level: s.mult === null ? null : levelOf(Number(s.mult)),
          userId: s.userId,
          userName: s.userName,
          unitLabel: s.unitLabel,
        })),
    }
  },

  async cancel(user: { id: string; role: 'SUPER_ADMIN' | 'USER' }, id: string) {
    const r = await reservationsRepository.findById(id)
    if (!r) throw new NotFoundError('Reserva')
    if (r.userId !== user.id && user.role !== 'SUPER_ADMIN') {
      const ws = await stationsService.workspaceOfCharger(r.chargerId)
      const member = ws ? await workspacesRepository.member(ws, user.id) : null
      if (member?.role !== 'ADMIN') throw new ForbiddenError()
    }
    await reservationsRepository.cancel(id)
  },
}
