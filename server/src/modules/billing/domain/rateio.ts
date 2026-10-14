/**
 * Rateio mensal (README do ev-chargeops-s1, "Modelo de rateio proposto"). Funções puras.
 *
 *   Custo_sessão = mult × [ kWh × tarifa_base + ocioso_cobrável × valor_minuto ]
 *   ocioso_cobrável = max(0, min_ocioso − carência)
 *
 * Custo fixo da infraestrutura: dividido igualmente entre os moradores ATIVOS no ciclo (quem
 * recarregou ao menos uma vez); quem não carregou fica isento. O que o morador pagou além do
 * custo real de energia (excedente do mult) volta como crédito na parcela fixa — nunca vira
 * reembolso nem receita: trava em zero e no valor da própria parcela.
 *
 * Convidado (mora em outro condomínio): paga só o que consumiu, sem parcela fixa e sem crédito.
 * O excedente positivo dele abate o custo fixo antes da divisão entre os moradores ativos.
 *
 * Lançamentos do gestor: despesas extras do mês entram no custo fixo que chega aqui (quem chama
 * soma); o ajuste de uma pessoa (crédito negativo, débito positivo) vai direto na fatura dela,
 * depois do crédito do excedente. A fatura nunca fica negativa.
 */

export type SessionPriceInput = {
  energyKwh: number
  idleMin: number
  mult: number
  tariffBaseCentsKwh: number
  idleCentsPerMinute: number
  idleGraceMinutes: number
}

export type SessionPrice = {
  /** kWh × tarifa base: o custo real de energia, sem multiplicador */
  energyCostCents: number
  idleChargeableMin: number
  /** o que a sessão efetivamente cobra (com mult) */
  chargedCents: number
}

export function priceSession(i: SessionPriceInput): SessionPrice {
  const idleChargeableMin = Math.max(0, i.idleMin - i.idleGraceMinutes)
  const energy = i.energyKwh * i.tariffBaseCentsKwh
  return {
    energyCostCents: Math.round(energy),
    idleChargeableMin,
    chargedCents: Math.round(i.mult * (energy + idleChargeableMin * i.idleCentsPerMinute)),
  }
}

export type CycleUserInput = {
  userId: string
  guest?: boolean
  sessions: { energyKwh: number; energyCostCents: number; chargedCents: number }[]
  /** soma dos ajustes do gestor para esta pessoa no ciclo */
  adjustmentCents?: number
}

export type CycleRow = {
  userId: string
  active: boolean
  sessionsCount: number
  energyKwh: number
  energyCostCents: number
  chargedCents: number
  /** cobrado − custo real (negativo quando o morador carregou em horário de desconto) */
  surplusCents: number
  fixedShareCents: number
  creditCents: number
  adjustmentCents: number
  totalCents: number
}

/** Divide `total` centavos em `n` partes inteiras que somam exatamente `total`. */
export function splitEvenly(total: number, n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(total / n)
  const rest = total - base * n
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0))
}

const surplusOf = (u: CycleUserInput) => u.sessions.reduce((s, x) => s + x.chargedCents - x.energyCostCents, 0)

export function computeCycle(users: CycleUserInput[], fixedMonthlyCostCents: number): CycleRow[] {
  const active = users
    .filter((u) => !u.guest && u.sessions.length > 0)
    .sort((a, b) => a.userId.localeCompare(b.userId))
  const guestSurplus = users.filter((u) => u.guest).reduce((s, u) => s + Math.max(0, surplusOf(u)), 0)
  const parts = splitEvenly(Math.max(0, fixedMonthlyCostCents - guestSurplus), active.length)
  const shares = new Map(active.map((u, i) => [u.userId, parts[i]!]))

  return users.map((u) => {
    const energyKwh = Math.round(u.sessions.reduce((s, x) => s + x.energyKwh, 0) * 1000) / 1000
    const energyCostCents = u.sessions.reduce((s, x) => s + x.energyCostCents, 0)
    const chargedCents = u.sessions.reduce((s, x) => s + x.chargedCents, 0)
    const surplusCents = chargedCents - energyCostCents
    const fixedShareCents = shares.get(u.userId) ?? 0
    const creditCents = u.guest ? 0 : Math.max(0, Math.min(surplusCents, fixedShareCents))
    const adjustmentCents = u.adjustmentCents ?? 0
    return {
      userId: u.userId,
      active: u.sessions.length > 0,
      sessionsCount: u.sessions.length,
      energyKwh,
      energyCostCents,
      chargedCents,
      surplusCents,
      fixedShareCents,
      creditCents,
      adjustmentCents,
      totalCents: Math.max(0, chargedCents + fixedShareCents - creditCents + adjustmentCents),
    }
  })
}
