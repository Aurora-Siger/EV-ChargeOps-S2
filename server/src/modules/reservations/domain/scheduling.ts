/**
 * Escolhe a janela mais barata para uma recarga, dado quanto falta (kWh), a potência efetiva
 * e um prazo. Funções puras: sem banco, sem rede. Mesma conta usada tanto pro fluxo "já
 * plugado" (resolve na hora) quanto pra resolver uma regra "agendar pra depois" quando o carro
 * pluga de verdade (ver reservations.service). `startSlots` lista os horários de início que o
 * morador escolhe na tela de agendar.
 */
import { fitsOpening, type OpeningHours } from './opening.js'

const HOUR_MS = 3_600_000

export type PriceLevel = 'cheap' | 'mid' | 'peak'
export type HourPrice = { at: Date; priceCentsKwh: number; level: PriceLevel }
export type Busy = { startsAt: Date; endsAt: Date }

function priceAt(curve: HourPrice[], t: number): HourPrice | null {
  if (!curve.length) return null
  const i = Math.floor((t - curve[0]!.at.getTime()) / HOUR_MS)
  return curve[i] ?? null
}

/** Custo em centavos, meia hora a meia hora (a curva é só por hora cheia). */
export function windowCostCents(curve: HourPrice[], start: number, hours: number, rateKw: number): number | null {
  let cost = 0
  for (let t = start, left = hours; left > 1e-9; t += HOUR_MS / 2, left -= 0.5) {
    const p = priceAt(curve, t)
    if (!p) return null
    cost += p.priceCentsKwh * rateKw * Math.min(0.5, left)
  }
  return Math.round(cost)
}

export type Window = { start: Date; end: Date; hours: number; costCents: number; level: PriceLevel }

/**
 * A janela mais barata que cabe entre `earliest` e `deadline`, livre de conflito com `busy`.
 * `null` se a energia não couber a tempo (prazo curto demais) ou não houver curva de preço
 * cobrindo o período inteiro.
 */
export function cheapestWindow(args: {
  curve: HourPrice[]
  earliest: Date
  deadline: Date
  energyKwh: number
  rateKw: number
  busy: Busy[]
}): Window | null {
  const { curve, earliest, deadline, energyKwh, rateKw, busy } = args
  const hours = energyKwh / rateKw
  if (hours <= 0 || rateKw <= 0 || !curve.length) return null

  // começar já (o carro está plugado) ou em cada hora cheia depois
  const now = earliest.getTime()
  const first = Math.ceil(now / HOUR_MS) * HOUR_MS
  const starts = first === now ? [] : [now]
  for (let s = first; s + hours * HOUR_MS <= deadline.getTime() + 1; s += HOUR_MS) starts.push(s)
  let best: Window | null = null
  for (const s of starts) {
    if (s + hours * HOUR_MS > deadline.getTime() + 1) break
    const e = s + hours * HOUR_MS
    const clash = busy.some((b) => b.startsAt.getTime() < e && b.endsAt.getTime() > s)
    if (clash) continue
    const cost = windowCostCents(curve, s, hours, rateKw)
    if (cost === null) break
    if (!best || cost < best.costCents) {
      best = { start: new Date(s), end: new Date(e), hours, costCents: cost, level: priceAt(curve, s + (hours * HOUR_MS) / 2)?.level ?? 'mid' }
    }
  }
  return best
}

export type StartSlot = {
  startsAt: Date
  endsAt: Date
  /** "Agora" — o único horário fora da hora cheia. */
  now: boolean
  /** Nível da tarifa no meio da janela (mesma régua do `cheapestWindow`), não só na hora de início. */
  level: PriceLevel
  costCents: number | null
  free: boolean
}

/**
 * Horários em que dá pra começar a carregar dentro de [from, to): "agora" (se `now` cai no
 * intervalo) e cada hora cheia depois dele. Some o horário cuja janela não cabe no
 * funcionamento da estação (`opening`). Livre só se a janela inteira (`hours` a partir do
 * início) não bate com nenhuma reserva em `busy`; "agora" também fica ocupado se tem carro
 * na tomada (`occupiedNow`).
 */
export function startSlots(args: {
  curve: HourPrice[]
  now: Date
  from: Date
  to: Date
  hours: number
  rateKw: number
  busy: Busy[]
  occupiedNow: boolean
  opening?: OpeningHours | null
}): StartSlot[] {
  const { curve, now, from, to, hours, rateKw, busy, occupiedNow, opening = null } = args
  const n = now.getTime()
  const starts: number[] = []
  if (n >= from.getTime() && n < to.getTime()) starts.push(n)
  for (let s = Math.ceil(Math.max(from.getTime(), n + 1) / HOUR_MS) * HOUR_MS; s < to.getTime(); s += HOUR_MS) starts.push(s)

  return starts.filter((s) => fitsOpening(opening, new Date(s), new Date(s + hours * HOUR_MS))).map((s) => {
    const e = s + hours * HOUR_MS
    const isNow = s === n
    const clash = busy.some((b) => b.startsAt.getTime() < e && b.endsAt.getTime() > s)
    return {
      startsAt: new Date(s),
      endsAt: new Date(e),
      now: isNow,
      level: priceAt(curve, s + (hours * HOUR_MS) / 2)?.level ?? 'mid',
      costCents: windowCostCents(curve, s, hours, rateKw),
      free: !clash && !(isNow && occupiedNow),
    }
  })
}

/** Folga entre o fim previsto e o prazo: o fim conta com a bateria assumida e pode atrasar. */
export const DEADLINE_SLACK_MS = 60 * 60_000
/** Até quanto acima do mais barato ainda vale trocar por um início mais perto do prazo. */
const NEAR_CHEAPEST = 1.1

/**
 * Horário de início a recomendar pra "pronto até `deadline`": entre os que terminam com folga
 * antes do prazo, o mais tarde que custa até 10% acima do mais barato. Entre madrugadas de
 * mesmo preço sai a que fica mais perto do prazo, não a das 1h. Sem nenhum com folga, o mais
 * barato que termina no prazo.
 */
export function recommendedForDeadline<T extends Pick<StartSlot, 'startsAt' | 'endsAt' | 'costCents'>>(slots: T[], deadline: Date): T | undefined {
  const priced = slots.filter((s) => s.costCents !== null && s.endsAt <= deadline)
  const slack = priced.filter((s) => s.endsAt.getTime() <= deadline.getTime() - DEADLINE_SLACK_MS)
  const pool = slack.length ? slack : priced
  if (!pool.length) return undefined
  const cheapest = Math.min(...pool.map((s) => s.costCents!))
  return pool.filter((s) => s.costCents! <= cheapest * NEAR_CHEAPEST).sort((x, y) => y.startsAt.getTime() - x.startsAt.getTime())[0]
}
