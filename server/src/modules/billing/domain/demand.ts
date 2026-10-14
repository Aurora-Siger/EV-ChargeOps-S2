/**
 * Multiplicador de demanda do modelo de rateio (README do ev-chargeops-s1, "Modelo de rateio
 * proposto"). Funções puras: sem banco, sem rede.
 *
 *   demanda = prever_demanda(hora, dia)   # regressão linear sobre o MESMO slot nas semanas anteriores
 *   mult    = 0,5 + demanda               # piso 0,5×, teto 1,5×
 *
 * O `y` de cada semana é a fração daquela hora (mesmo dia da semana) em que o carregador
 * esteve ocupado por uma sessão — medido do histórico real de sessões, nada estimado.
 */
import { startOfLocalHour, startOfLocalWeek, toLocal } from '../../../shared/time.js'

const HOUR_MS = 3_600_000
const WEEK_MS = 7 * 24 * HOUR_MS

export const MULT_FLOOR = 0.5
export const MULT_CEIL = 1.5
/** Quantas semanas anteriores do mesmo slot entram na regressão. */
export const HISTORY_WEEKS = 4
/** Sem histórico nenhum para o slot: demanda neutra → mult 1,0 (tarifa base). */
export const NEUTRAL_DEMAND = 0.5

export type Interval = { start: Date; end: Date }
export type PriceLevel = 'cheap' | 'mid' | 'peak'

/** Fração [0,1] da hora que começa em `slotStart` coberta por alguma sessão. */
export function occupiedFraction(intervals: Interval[], slotStart: Date): number {
  const a = slotStart.getTime()
  const b = a + HOUR_MS
  let covered = 0
  for (const s of intervals) {
    const lo = Math.max(a, s.start.getTime())
    const hi = Math.min(b, s.end.getTime())
    if (hi > lo) covered += hi - lo
  }
  return Math.min(1, covered / HOUR_MS)
}

/** Regressão linear simples sobre x = 1..n; devolve a previsão para x = n + 1. */
export function linearForecast(ys: number[]): number {
  const n = ys.length
  if (n === 0) return NEUTRAL_DEMAND
  if (n === 1) return ys[0]!
  const meanX = (n + 1) / 2
  const meanY = ys.reduce((s, y) => s + y, 0) / n
  let num = 0
  let den = 0
  ys.forEach((y, i) => {
    const dx = i + 1 - meanX
    num += dx * (y - meanY)
    den += dx * dx
  })
  const slope = num / den
  return meanY + slope * (n + 1 - meanX)
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const round4 = (v: number) => Math.round(v * 10_000) / 10_000

/**
 * Demanda prevista para a hora de `at`: série do mesmo slot (mesma hora, mesmo dia da semana)
 * nas até HISTORY_WEEKS semanas anteriores. Semanas antes de `historyStart` (quando o
 * carregador ainda não registrava sessões) não entram — ausência de dado não é demanda zero.
 */
export function predictDemand(intervals: Interval[], at: Date, historyStart: Date | null): number {
  const slot = startOfLocalHour(at)
  const ys: number[] = []
  for (let k = HISTORY_WEEKS; k >= 1; k--) {
    const past = new Date(slot.getTime() - k * WEEK_MS)
    if (!historyStart || past < historyStart) continue
    ys.push(occupiedFraction(intervals, past))
  }
  return round4(clamp01(linearForecast(ys)))
}

export function multFromDemand(demand: number): number {
  return round4(Math.min(MULT_CEIL, Math.max(MULT_FLOOR, MULT_FLOOR + demand)))
}

export function levelOf(mult: number): PriceLevel {
  if (mult < 0.9) return 'cheap'
  if (mult < 1.2) return 'mid'
  return 'peak'
}

/** Início do histórico: segunda-feira da semana da primeira sessão registrada. */
export function historyStartOf(intervals: Interval[]): Date | null {
  if (intervals.length === 0) return null
  const first = intervals.reduce((min, s) => (s.start < min ? s.start : min), intervals[0]!.start)
  return startOfLocalWeek(first)
}

export type HourPrice = { at: Date; demand: number; mult: number; priceCentsKwh: number; level: PriceLevel }

/** Curva de preço hora a hora a partir de `from` — a mesma regra usada para cobrar a sessão. */
export function priceCurve(intervals: Interval[], from: Date, hours: number, basePriceCentsKwh: number): HourPrice[] {
  const start = startOfLocalHour(from)
  const historyStart = historyStartOf(intervals)
  return Array.from({ length: hours }, (_, i) => {
    const at = new Date(start.getTime() + i * HOUR_MS)
    const demand = predictDemand(intervals, at, historyStart)
    const mult = multFromDemand(demand)
    return { at, demand, mult, priceCentsKwh: Math.round(basePriceCentsKwh * mult), level: levelOf(mult) }
  })
}

/** Matriz 7×24 (linha = dia, 0 = segunda) da demanda observada: média das últimas semanas. */
export function observedMatrix(intervals: Interval[], now: Date, weeks = HISTORY_WEEKS): number[][] {
  const weekStart = startOfLocalWeek(now)
  const historyStart = historyStartOf(intervals)
  const sums = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  let counted = 0
  for (let k = 1; k <= weeks; k++) {
    const ws = new Date(weekStart.getTime() - k * WEEK_MS)
    if (!historyStart || ws < historyStart) continue
    counted++
    for (let h = 0; h < 7 * 24; h++) {
      const slot = new Date(ws.getTime() + h * HOUR_MS)
      const p = toLocal(slot)
      sums[p.weekday]![p.hour]! += occupiedFraction(intervals, slot)
    }
  }
  return sums.map((row) => row.map((v) => (counted ? round4(v / counted) : 0)))
}

/** Matriz 7×24 da demanda prevista para a próxima semana (o que vira tarifa). */
export function predictedMatrix(intervals: Interval[], now: Date): number[][] {
  const matrix = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  const historyStart = historyStartOf(intervals)
  const start = startOfLocalHour(now)
  for (let h = 0; h < 7 * 24; h++) {
    const at = new Date(start.getTime() + h * HOUR_MS)
    const p = toLocal(at)
    matrix[p.weekday]![p.hour] = predictDemand(intervals, at, historyStart)
  }
  return matrix
}
