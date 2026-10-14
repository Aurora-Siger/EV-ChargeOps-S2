import { periodRange, shiftPeriod } from '../../shared/time.js'
import { historyStartOf, observedMatrix, predictedMatrix } from '../billing/domain/demand.js'
import { billingService } from '../billing/billing.service.js'
import { semsService } from '../sems/sems.service.js'
import { sessionsService } from '../sessions/sessions.service.js'
import { stationsService } from '../stations/stations.service.js'

const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
const STALE_MS = 30 * 60_000

type Alert = { tone: 'warn' | 'ok' | 'info'; title: string; detail: string }

const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`
const kwh = (v: number) => `${v.toFixed(1).replace('.', ',')} kWh`

export const overviewService = {
  /** Matriz de demanda 24×7 do carregador do condomínio: observada (últimas semanas) e prevista (tarifa). */
  async demand(workspaceId: string) {
    const chargerId = await stationsService.homeChargerOf(workspaceId)
    const intervals = chargerId ? await sessionsService.intervals(chargerId) : []
    const now = new Date()
    return {
      historyStart: historyStartOf(intervals),
      sessions: intervals.length,
      observed: observedMatrix(intervals, now),
      predicted: predictedMatrix(intervals, now),
    }
  },

  /** KPIs e alertas do mês do condomínio, todos derivados de sessões, faturas e do coletor — nada fixo. */
  async overview(workspaceId: string, period: string) {
    const [cycle, sessions, prevSessions, demand, detail, semsWorkspace] = await Promise.all([
      billingService.cycle(workspaceId, period),
      sessionsService.list({ ...periodRange(period), workspaceId }),
      sessionsService.list({ ...periodRange(shiftPeriod(period, -1)), workspaceId }),
      overviewService.demand(workspaceId),
      semsService.latestDetail(),
      stationsService.semsChargerId().then((id) => (id ? stationsService.workspaceOfCharger(id) : null)),
    ])
    // telemetria da SEMS só é assunto do condomínio onde o carregador dela está
    const hasTelemetry = semsWorkspace === workspaceId
    const collector = semsService.collectorState()
    const sumKwh = (xs: { energyKwh: number }[]) => xs.reduce((s, x) => s + x.energyKwh, 0)
    const energyKwh = sumKwh(sessions)
    const prevEnergyKwh = sumKwh(prevSessions)
    const peakKwh = sumKwh(sessions.filter((s) => s.level === 'peak'))
    const green = sessions.reduce((s, x) => s + (x.greenKwh ?? 0), 0)

    const alerts: Alert[] = []
    const lastCollect = detail?.collectedAt ?? null
    if (hasTelemetry && collector.captchaBlocked) {
      alerts.push({ tone: 'warn', title: 'Login da SEMS bloqueado por captcha', detail: 'Troque o token manualmente em /admin/sems/token.' })
    } else if (hasTelemetry && (!lastCollect || Date.now() - lastCollect.getTime() > STALE_MS)) {
      alerts.push({
        tone: 'warn',
        title: 'Telemetria do carregador parada',
        detail: lastCollect
          ? `Última coleta em ${lastCollect.toISOString()}${collector.lastError ? ` · ${collector.lastError}` : ''}`
          : 'Nenhuma coleta da SEMS salva ainda.',
      })
    }
    if (cycle.unassigned.count > 0) {
      alerts.push({
        tone: 'warn',
        title: `${cycle.unassigned.count} ${cycle.unassigned.count === 1 ? 'sessão sem morador' : 'sessões sem morador'}`,
        detail: `${kwh(cycle.unassigned.energyKwh)} fora do rateio. Cadastre o cartão RFID ou atribua em Operação.`,
      })
    }
    const active = cycle.lines.filter((l) => l.active)
    if (active.length >= 2) {
      const avg = active.reduce((s, l) => s + l.energyKwh, 0) / active.length
      const top = active.reduce((a, b) => (b.energyKwh > a.energyKwh ? b : a))
      if (avg > 0 && top.energyKwh >= 2 * avg) {
        alerts.push({
          tone: 'info',
          title: `${top.unitLabel ?? top.name} acima do padrão`,
          detail: `${kwh(top.energyKwh)}, ${(top.energyKwh / avg).toFixed(1).replace('.', ',')}× a média do prédio.`,
        })
      }
    }
    const overdue = cycle.lines.filter((l) => l.status === 'OVERDUE')
    if (overdue.length) {
      alerts.push({
        tone: 'warn',
        title: `${overdue.length} ${overdue.length === 1 ? 'fatura vencida' : 'faturas vencidas'}`,
        detail: overdue.map((l) => `${l.unitLabel ?? l.name} (${brl(l.totalCents)})`).join(', '),
      })
    } else if (cycle.closed && cycle.lines.every((l) => l.status === 'PAID' || l.status === 'EXEMPT')) {
      alerts.push({ tone: 'ok', title: 'Faturas do ciclo 100% pagas', detail: `${active.length} de ${active.length} moradores ativos.` })
    }
    let busiest: { weekday: string; hour: number; demand: number } | null = null
    demand.predicted.forEach((row, d) =>
      row.forEach((v, h) => {
        if (!busiest || v > busiest.demand) busiest = { weekday: WEEKDAYS[d]!, hour: h, demand: v }
      }),
    )
    const b = busiest as { weekday: string; hour: number; demand: number } | null
    if (b && demand.sessions > 0 && b.demand >= 0.5) {
      alerts.push({
        tone: 'info',
        title: `Horário mais disputado: ${b.weekday} ${String(b.hour).padStart(2, '0')}h`,
        detail: `Demanda prevista de ${Math.round(b.demand * 100)}% → mult ${(0.5 + b.demand).toFixed(2).replace('.', ',')}× nessa hora.`,
      })
    }

    return {
      period,
      energyKwh: Math.round(energyKwh * 1000) / 1000,
      prevEnergyKwh: Math.round(prevEnergyKwh * 1000) / 1000,
      sessionsCount: sessions.length,
      peakShare: energyKwh ? peakKwh / energyKwh : 0,
      greenShare: energyKwh ? Math.min(1, green / energyKwh) : null,
      activeUsers: cycle.activeUsers,
      registeredUsers: cycle.registeredUsers,
      billedCents: cycle.totals.totalCents,
      closed: cycle.closed,
      openInvoices: cycle.lines.filter((l) => l.status === 'PENDING' || l.status === 'OVERDUE').length,
      unassigned: cycle.unassigned,
      collector: { ...collector, lastCollect: lastCollect?.toISOString() ?? null },
      alerts,
    }
  },
}
