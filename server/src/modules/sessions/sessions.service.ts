import { historyStartOf, levelOf, multFromDemand, predictDemand, type Interval } from '../billing/domain/demand.js'
import { priceSession } from '../billing/domain/rateio.js'
import { pricingQueries } from '../pricing/pricing.service.js'
import { reservationsService } from '../reservations/reservations.service.js'
import { semsRepository } from '../sems/sems.repository.js'
import { semsService } from '../sems/sems.service.js'
import { settingsService } from '../settings/settings.service.js'
import { stationsService } from '../stations/stations.service.js'
import { AppError, NotFoundError } from '../../shared/errors.js'
import { periodOf } from '../../shared/time.js'
import { billingRepository } from '../billing/billing.repository.js'
import { residentsRepository } from '../residents/residents.repository.js'
import { idleMinutes, pluggedFromTelemetry } from './domain/idle.js'
import { mapSemsChargeLog, type MappedSession } from './sessions.mapper.js'
import { sessionsRepository, type SessionFilter } from './sessions.repository.js'

const toInterval = (r: { start: Date; end: Date | null; durationMin: number | null }): Interval => ({
  start: r.start,
  end: r.end ?? new Date(r.start.getTime() + (r.durationMin ?? 0) * 60_000),
})

/** Sessão iniciada há menos disso conta como "carro acabou de plugar" pra tentar resolver agendamento. */
const RESOLVE_WINDOW_MS = 2 * 60 * 60 * 1000

type PricedRow = { startedAt: Date; priceCents: number | null }

/**
 * Sessão já precificada de um ciclo com fatura emitida: não muda mais. Mudar o valor do minuto
 * ocioso ou a carência depois não reescreve o que já foi faturado. Sessão que chega atrasada
 * num ciclo fechado ainda é precificada uma vez.
 */
async function frozenTest(chargerId: string) {
  const workspaceId = await stationsService.workspaceOfCharger(chargerId)
  const closed = workspaceId ? await billingRepository.closedPeriods(workspaceId) : new Set<string>()
  return (r: PricedRow) => r.priceCents !== null && closed.has(periodOf(r.startedAt))
}

let syncing: Promise<{ imported: number; priced: number }> | null = null

export const sessionsService = {
  /**
   * sems_charge_log (bruto) → charge_session (domínio) e recalcula demanda/mult/valor de cada
   * sessão. Idempotente; roda depois de cada coleta da SEMS, na subida do servidor e sob
   * demanda pelo gestor. Chamadas concorrentes reaproveitam a que já está rodando.
   */
  syncFromSems() {
    syncing ??= (async () => {
      try {
        const chargerId = await stationsService.ensureSemsCharger()
        const workspaceId = await stationsService.workspaceOfCharger(chargerId)
        const [logs, cards, tariff] = await Promise.all([
          semsService.chargeLog(),
          sessionsRepository.activeCards(),
          workspaceId ? pricingQueries.activeTariff(workspaceId) : null,
        ])
        const cardOwner = new Map(cards.map((c) => [c.cardNumber, c.userId]))
        const mapped = logs
          .map((l) => mapSemsChargeLog(l.serial, l.payload as Record<string, unknown>))
          .filter((m) => m !== null)
        await sessionsRepository.upsertFromSems(
          mapped.map((m) => ({
            ...m,
            chargerId,
            userId: m.cardNumber ? (cardOwner.get(m.cardNumber) ?? null) : null,
            tariffBaseCentsKwh: tariff?.basePriceCentsKwh ?? null,
          })),
        )
        await sessionsService.deriveIdle(chargerId)
        const priced = await sessionsService.repriceCharger(chargerId)
        await sessionsService.resolvePendingReservations(chargerId, mapped, cardOwner)
        return { imported: mapped.length, priced }
      } finally {
        syncing = null
      }
    })()
    return syncing
  },

  /**
   * Sessões recém-iniciadas (carro plugou de verdade) cujo dono tem uma regra "agendar pra
   * depois" pendente: tenta resolvê-la agora com o SOC real que acabou de chegar. Roda a cada
   * sync; barato e idempotente — uma vez resolvida, `pendingForUser` para de achá-la.
   */
  async resolvePendingReservations(chargerId: string, mapped: MappedSession[], cardOwner: Map<string, string>) {
    const now = new Date()
    await reservationsService.expireOverdue(now)
    const userIds = new Set(
      mapped
        .filter((m) => m.cardNumber && now.getTime() - m.startedAt.getTime() < RESOLVE_WINDOW_MS)
        .map((m) => cardOwner.get(m.cardNumber!))
        .filter((id): id is string => id !== undefined),
    )
    if (userIds.size === 0) return
    const live = await semsService.live()
    if (!live || live.soc === null) return
    const soc = live.soc
    await Promise.all([...userIds].map((userId) => reservationsService.resolvePendingFor(userId, chargerId, soc, now)))
  },

  /**
   * Ociosidade de cada sessão a partir da telemetria (ver domain/idle.ts): do fim da carga até o
   * cabo sair. Grava só o que mudou; roda antes do repriceCharger, que cobra a ociosidade.
   */
  async deriveIdle(chargerId: string) {
    const [rows, frozen] = await Promise.all([sessionsRepository.forPricing(chargerId), frozenTest(chargerId)])
    const open = rows.filter((r) => r.endedAt && !frozen(r))
    if (open.length === 0) return 0
    const since = open.reduce((min, r) => (r.endedAt! < min ? r.endedAt! : min), open[0]!.endedAt!)
    const states = await semsRepository.plugStates(since)
    const samples = states.map((st) => ({ at: st.collectedAt, plugged: pluggedFromTelemetry(st.workState, st.status, st.vehConnStu) }))
    let changed = 0
    for (const [i, r] of rows.entries()) {
      if (!r.endedAt || frozen(r)) continue
      const idle = idleMinutes(r.endedAt, rows[i + 1]?.startedAt ?? null, samples)
      if (idle !== r.idleMin) {
        await sessionsRepository.setIdle(r.id, idle)
        changed++
      }
    }
    return changed
  },

  /**
   * Demanda do slot → mult → valor de cada sessão do carregador, com a ociosidade do condomínio
   * dono dele. Grava só o que mudou.
   */
  async repriceCharger(chargerId: string) {
    const workspaceId = await stationsService.workspaceOfCharger(chargerId)
    if (!workspaceId) return 0
    const [rows, settings, frozen] = await Promise.all([
      sessionsRepository.forPricing(chargerId),
      settingsService.get(workspaceId),
      frozenTest(chargerId),
    ])
    const intervals = rows.map((r) => toInterval({ start: r.startedAt, end: r.endedAt, durationMin: r.durationMin }))
    const historyStart = historyStartOf(intervals)
    let changed = 0
    for (const r of rows) {
      if (frozen(r)) continue
      const demand = predictDemand(intervals, r.startedAt, historyStart)
      const mult = multFromDemand(demand)
      const price =
        r.tariffBaseCentsKwh === null
          ? null
          : priceSession({
              energyKwh: Number(r.energyKwh ?? 0),
              idleMin: r.idleMin,
              mult,
              tariffBaseCentsKwh: r.tariffBaseCentsKwh,
              idleCentsPerMinute: settings.idleCentsPerMinute,
              idleGraceMinutes: settings.idleGraceMinutes,
            })
      const next = { demand, mult, energyCostCents: price?.energyCostCents ?? null, priceCents: price?.chargedCents ?? null }
      if (
        Number(r.demand) !== next.demand ||
        Number(r.mult) !== next.mult ||
        r.energyCostCents !== next.energyCostCents ||
        r.priceCents !== next.priceCents
      ) {
        await sessionsRepository.updatePricing(r.id, next)
        changed++
      }
    }
    return changed
  },

  intervals: async (chargerId: string) => (await sessionsRepository.intervals(chargerId)).map(toInterval),

  async list(f: SessionFilter) {
    const rows = await sessionsRepository.list(f)
    return rows.map((r) => ({ ...r, level: r.mult === null ? null : levelOf(r.mult) }))
  },

  /** Gestor atribui a sessão a alguém do condomínio (ou tira de quem estava). */
  async assign(workspaceId: string, id: string, userId: string | null) {
    const found = await sessionsRepository.findById(id)
    if (!found || found.workspaceId !== workspaceId) throw new NotFoundError('Sessão')
    if (userId && !(await residentsRepository.findMember(workspaceId, userId))) {
      throw new AppError('Essa pessoa não participa deste condomínio', 400, 'VALIDATION')
    }
    await sessionsRepository.assign(id, userId)
  },
}
