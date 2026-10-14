import { AppError, NotFoundError } from '../../shared/errors.js'
import { chargesService } from '../charges/charges.service.js'
import { dueDateOf, localDate, periodOf, periodRange, shiftPeriod } from '../../shared/time.js'
import { pricingQueries } from '../pricing/pricing.service.js'
import { sessionsService } from '../sessions/sessions.service.js'
import { settingsService } from '../settings/settings.service.js'
import { stationsService } from '../stations/stations.service.js'
import { priceCurve } from './domain/demand.js'
import { computeCycle, type CycleRow } from './domain/rateio.js'
import { billingRepository } from './billing.repository.js'

export type InvoiceState = 'OPEN' | 'PENDING' | 'PAID' | 'OVERDUE' | 'EXEMPT'

export type CycleLine = CycleRow & {
  kind: 'MORADOR' | 'CONVIDADO' | null
  name: string
  email: string
  unitLabel: string | null
  status: InvoiceState
  invoiceId: string | null
  dueDate: string
}


function stateOf(status: 'PENDING' | 'PAID', dueDate: string): InvoiceState {
  if (status === 'PAID') return 'PAID'
  return dueDate < localDate() ? 'OVERDUE' : 'PENDING'
}

export const billingService = {
  /**
   * Rateio do ciclo `period` ("2026-09") do condomínio. Com faturas já fechadas, devolve o que
   * foi emitido (congelado); com o ciclo aberto, calcula na hora a partir das sessões atribuídas.
   * Sessão de quem não participa do condomínio fica fora do rateio, como as sem dono.
   */
  async cycle(workspaceId: string, period: string, opts: { ignoreInvoices?: boolean } = {}) {
    const [settings, people, invoices, sessions, entries] = await Promise.all([
      settingsService.get(workspaceId),
      billingRepository.people(workspaceId),
      opts.ignoreInvoices ? Promise.resolve([]) : billingRepository.invoicesOf(workspaceId, period),
      sessionsService.list({ ...periodRange(period), workspaceId }),
      billingRepository.entriesOf(workspaceId, period),
    ])
    // despesas extras do mês somam ao custo fixo; ajustes vão para a fatura de cada um
    const expensesCents = entries.filter((e) => e.kind === 'DESPESA').reduce((t, e) => t + e.amountCents, 0)
    const adjustments = new Map<string, number>()
    for (const e of entries) {
      if (e.kind === 'AJUSTE' && e.userId) adjustments.set(e.userId, (adjustments.get(e.userId) ?? 0) + e.amountCents)
    }
    const dueDate = dueDateOf(period, settings.dueDay)
    const members = new Set(people.map((p) => p.userId))
    const assigned = sessions.filter((s) => s.userId && members.has(s.userId))
    const unassigned = sessions.filter((s) => !s.userId || !members.has(s.userId))

    let lines: CycleLine[]
    if (invoices.length) {
      const byUser = new Map(invoices.map((i) => [i.userId, i]))
      lines = people.map((p) => {
        const inv = byUser.get(p.userId)
        const base = { kind: p.kind, name: p.name, email: p.email, unitLabel: inv?.unitLabel ?? p.unitLabel, dueDate }
        if (!inv) {
          return { ...base, ...emptyRow(p.userId), status: 'EXEMPT', invoiceId: null }
        }
        return {
          ...base,
          userId: p.userId,
          active: inv.sessionsCount > 0,
          sessionsCount: inv.sessionsCount,
          energyKwh: Number(inv.energyKwh),
          energyCostCents: inv.energyCostCents,
          chargedCents: inv.chargedCents,
          surplusCents: inv.surplusCents,
          fixedShareCents: inv.fixedShareCents,
          creditCents: inv.creditCents,
          adjustmentCents: inv.adjustmentCents,
          totalCents: inv.totalCents,
          status: stateOf(inv.status, inv.dueDate),
          invoiceId: inv.id,
          dueDate: inv.dueDate,
        }
      })
    } else {
      const rows = computeCycle(
        people.map((p) => ({
          userId: p.userId,
          guest: p.kind === 'CONVIDADO',
          sessions: assigned
            .filter((s) => s.userId === p.userId)
            .map((s) => ({ energyKwh: s.energyKwh, energyCostCents: s.energyCostCents ?? 0, chargedCents: s.chargedCents ?? 0 })),
          adjustmentCents: adjustments.get(p.userId) ?? 0,
        })),
        settings.fixedMonthlyCostCents + expensesCents,
      )
      const byUser = new Map(people.map((p) => [p.userId, p]))
      lines = rows.map((r) => {
        const p = byUser.get(r.userId)!
        return {
          ...r,
          kind: p.kind,
          name: p.name,
          email: p.email,
          unitLabel: p.unitLabel,
          status: r.active || r.adjustmentCents !== 0 ? 'OPEN' : 'EXEMPT',
          invoiceId: null,
          dueDate,
        }
      })
    }

    // recargas atribuídas que não estão em nenhuma fatura emitida (chegaram depois do fechamento)
    const invoiced = invoices.reduce((n, i) => n + i.sessionsCount, 0)
    const notInvoiced = invoices.length ? Math.max(0, assigned.length - invoiced) : 0

    lines.sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name))
    const sum = (k: keyof CycleRow) => lines.reduce((s, l) => s + (l[k] as number), 0)
    return {
      period,
      closed: invoices.length > 0,
      dueDate,
      fixedMonthlyCostCents: settings.fixedMonthlyCostCents,
      // despesas extras lançadas pelo gestor neste ciclo (rateadas junto com o custo fixo)
      expensesCents,
      entries,
      // o que de fato foi dividido: custo fixo menos o excedente pago por convidados
      fixedSplitCents: lines.reduce((s, l) => s + l.fixedShareCents, 0),
      // quem divide o custo fixo: moradores que carregaram (convidado não entra)
      activeUsers: lines.filter((l) => l.active && l.kind !== 'CONVIDADO').length,
      registeredUsers: lines.length,
      lines,
      totals: {
        energyKwh: Math.round(sum('energyKwh') * 1000) / 1000,
        energyCostCents: sum('energyCostCents'),
        chargedCents: sum('chargedCents'),
        creditCents: sum('creditCents'),
        adjustmentCents: sum('adjustmentCents'),
        fixedShareCents: sum('fixedShareCents'),
        totalCents: sum('totalCents'),
      },
      notInvoiced,
      unassigned: {
        count: unassigned.length,
        energyKwh: Math.round(unassigned.reduce((s, x) => s + x.energyKwh, 0) * 1000) / 1000,
      },
    }
  },

  /**
   * Fecha o ciclo: grava as faturas dos ativos. Só depois que o mês terminou, para nenhuma
   * recarga do mês ficar de fora da fatura. Refazível enquanto nenhuma foi paga.
   */
  async close(workspaceId: string, period: string) {
    if (period >= periodOf(new Date())) {
      throw new AppError('O ciclo só pode ser fechado depois que o mês terminar', 400, 'VALIDATION')
    }
    const existing = await billingRepository.invoicesOf(workspaceId, period)
    if (existing.some((i) => i.status === 'PAID')) {
      throw new AppError('Este ciclo já tem fatura paga; não pode ser refeito', 409, 'CONFLICT')
    }
    // as faturas pendentes vão ser refeitas: cobranças emitidas para elas são canceladas antes
    await chargesService.cancelOpenOf(existing.map((i) => i.id))
    // recalcula do zero; replacePending troca as pendentes numa transação só
    const live = await billingService.cycle(workspaceId, period, { ignoreInvoices: true })
    await billingRepository.replacePending(
      workspaceId,
      period,
      live.lines
        .filter((l) => l.active || l.adjustmentCents !== 0)
        .map((l) => ({
          workspaceId,
          userId: l.userId,
          unitLabel: l.unitLabel,
          period,
          sessionsCount: l.sessionsCount,
          energyKwh: String(l.energyKwh),
          energyCostCents: l.energyCostCents,
          chargedCents: l.chargedCents,
          surplusCents: l.surplusCents,
          fixedShareCents: l.fixedShareCents,
          creditCents: l.creditCents,
          adjustmentCents: l.adjustmentCents,
          totalCents: l.totalCents,
          dueDate: l.dueDate,
        })),
    )
    return billingService.cycle(workspaceId, period)
  },

  /**
   * Lança uma despesa extra do mês ou um ajuste para uma pessoa. Não mexe em ciclo com fatura
   * paga; num ciclo já fechado, refaz as faturas na hora para elas já saírem com o lançamento.
   */
  async addEntry(
    workspaceId: string,
    period: string,
    entry: { kind: 'DESPESA' | 'AJUSTE'; description: string; amountCents: number; userId: string | null },
    createdBy: string,
  ) {
    if (entry.kind === 'DESPESA' && entry.amountCents <= 0) {
      throw new AppError('A despesa precisa ter valor maior que zero', 400, 'VALIDATION')
    }
    if (entry.kind === 'AJUSTE') {
      if (entry.amountCents === 0) throw new AppError('O ajuste precisa ter valor', 400, 'VALIDATION')
      const people = await billingRepository.people(workspaceId)
      if (!entry.userId || !people.some((p) => p.userId === entry.userId)) {
        throw new AppError('Essa pessoa não participa deste condomínio', 400, 'VALIDATION')
      }
    }
    const closed = await billingService.assertEntriesEditable(workspaceId, period)
    await billingRepository.insertEntry({
      workspaceId,
      period,
      kind: entry.kind,
      description: entry.description,
      amountCents: entry.amountCents,
      userId: entry.kind === 'AJUSTE' ? entry.userId : null,
      createdBy,
    })
    return closed ? billingService.close(workspaceId, period) : billingService.cycle(workspaceId, period)
  },

  async removeEntry(workspaceId: string, period: string, id: string) {
    const found = await billingRepository.findEntry(id)
    if (!found || found.workspaceId !== workspaceId || found.period !== period) throw new NotFoundError('Lançamento')
    const closed = await billingService.assertEntriesEditable(workspaceId, period)
    await billingRepository.deleteEntry(id)
    return closed ? billingService.close(workspaceId, period) : billingService.cycle(workspaceId, period)
  },

  /** Ciclo com fatura paga não aceita lançamento; devolve se o ciclo já está fechado. */
  async assertEntriesEditable(workspaceId: string, period: string) {
    const invoices = await billingRepository.invoicesOf(workspaceId, period)
    if (invoices.some((i) => i.status === 'PAID')) {
      throw new AppError('Este ciclo já tem fatura paga; os lançamentos não podem mais mudar', 409, 'CONFLICT')
    }
    return invoices.length > 0
  },

  async setInvoiceStatus(workspaceId: string, id: string, status: 'PENDING' | 'PAID') {
    const inv = await billingRepository.findInvoice(id)
    if (!inv || inv.workspaceId !== workspaceId) throw new NotFoundError('Fatura')
    await chargesService.onManualStatus(id, status)
    const [row] = await billingRepository.setStatus(id, status)
    return row
  },

  /**
   * Fatura da pessoa no ciclo do condomínio, com as sessões que a compõem, o total do ciclo
   * anterior e as cobranças (Pix/boleto) já emitidas para ela.
   */
  async userInvoice(workspaceId: string, userId: string, period: string) {
    const [cycle, prev, sessions] = await Promise.all([
      billingService.cycle(workspaceId, period),
      billingService.cycle(workspaceId, shiftPeriod(period, -1)),
      sessionsService.list({ ...periodRange(period), userId, workspaceId }),
    ])
    const line = cycle.lines.find((l) => l.userId === userId) ?? null
    const prevLine = prev.lines.find((l) => l.userId === userId) ?? null
    const charges = line?.invoiceId ? await chargesService.ofInvoice(line.invoiceId) : []
    return {
      period,
      closed: cycle.closed,
      activeUsers: cycle.activeUsers,
      fixedMonthlyCostCents: cycle.fixedMonthlyCostCents,
      fixedSplitCents: cycle.fixedSplitCents,
      expensesCents: cycle.expensesCents,
      // o que aparece na fatura da pessoa: as despesas do condomínio e os ajustes dela
      entries: cycle.entries
        .filter((e) => e.kind === 'DESPESA' || e.userId === userId)
        .map(({ id, kind, description, amountCents, createdAt }) => ({ id, kind, description, amountCents, createdAt })),
      line,
      previousTotalCents: prevLine && prevLine.active ? prevLine.totalCents : null,
      sessions,
      charges,
    }
  },

  /**
   * Curva de preço (tarifa base × mult) do carregador nas próximas `hours` horas, com a tarifa
   * do condomínio dono dele.
   */
  async priceCurve(chargerId: string, from: Date, hours: number) {
    const workspaceId = await stationsService.workspaceOfCharger(chargerId)
    const [intervals, tariff] = await Promise.all([
      sessionsService.intervals(chargerId),
      workspaceId ? pricingQueries.activeTariff(workspaceId) : null,
    ])
    if (!tariff) throw new NotFoundError('Tarifa ativa')
    return {
      basePriceCentsKwh: tariff.basePriceCentsKwh,
      hours: priceCurve(intervals, from, hours, tariff.basePriceCentsKwh),
    }
  },

  /** Preço agora no carregador da SEMS (o do condomínio), ou null sem tarifa/carregador. */
  async priceNow() {
    const chargerId = await stationsService.semsChargerId()
    if (!chargerId) return null
    try {
      const { hours } = await billingService.priceCurve(chargerId, new Date(), 1)
      return { chargerId, ...hours[0]! }
    } catch {
      return null
    }
  },
}

function emptyRow(userId: string): CycleRow {
  return {
    userId,
    active: false,
    sessionsCount: 0,
    energyKwh: 0,
    energyCostCents: 0,
    chargedCents: 0,
    surplusCents: 0,
    fixedShareCents: 0,
    creditCents: 0,
    adjustmentCents: 0,
    totalCents: 0,
  }
}
