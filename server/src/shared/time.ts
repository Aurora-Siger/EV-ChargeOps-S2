/**
 * Datas do domínio no fuso do condomínio. O Brasil não tem horário de verão desde 2019,
 * então America/Sao_Paulo é UTC-3 fixo — dá para fazer a conta sem biblioteca de fuso.
 * No banco tudo fica em UTC (ARCHITECTURE.md §4); só slot (hora/dia da semana) e ciclo
 * de faturamento (mês) são calculados em horário local.
 */
const HOUR_MS = 3_600_000
export const BRT_OFFSET_MS = -3 * HOUR_MS

export type LocalParts = {
  year: number
  month: number // 1..12
  day: number
  hour: number
  minute: number
  /** 0 = segunda … 6 = domingo */
  weekday: number
}

export function toLocal(d: Date): LocalParts {
  const x = new Date(d.getTime() + BRT_OFFSET_MS)
  return {
    year: x.getUTCFullYear(),
    month: x.getUTCMonth() + 1,
    day: x.getUTCDate(),
    hour: x.getUTCHours(),
    minute: x.getUTCMinutes(),
    weekday: (x.getUTCDay() + 6) % 7,
  }
}

/** Instante UTC de uma data/hora local. `month` é 1..12 (aceita estouro, como Date.UTC). */
export function fromLocal(year: number, month: number, day = 1, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - BRT_OFFSET_MS)
}

/** "2026-06-19 19:27:28" (ou com ".000"), horário local do carregador → Date. */
export function parseSemsLocal(s: unknown): Date | null {
  if (typeof s !== 'string') return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  const [, y, mo, d, h, mi, se] = m
  return new Date(fromLocal(+y!, +mo!, +d!, +h!, +mi!).getTime() + (se ? +se * 1000 : 0))
}

/** Date → "2026-06-19 19:27:28" no horário local do carregador (inverso de parseSemsLocal). */
export function formatSemsLocal(d: Date): string {
  return new Date(d.getTime() + BRT_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ')
}

export function startOfLocalHour(d: Date): Date {
  const p = toLocal(d)
  return fromLocal(p.year, p.month, p.day, p.hour)
}

/** Segunda-feira 00:00 local da semana de `d`. */
export function startOfLocalWeek(d: Date): Date {
  const p = toLocal(d)
  return fromLocal(p.year, p.month, p.day - p.weekday)
}

// ---------- Ciclo de faturamento (mensal) ----------

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

export function isPeriod(s: unknown): s is string {
  return typeof s === 'string' && PERIOD_RE.test(s)
}

/** Data local "2026-09-24": vencimento é data de Brasília, não UTC. */
export function localDate(d: Date = new Date()): string {
  const p = toLocal(d)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function periodOf(d: Date): string {
  const p = toLocal(d)
  return `${p.year}-${String(p.month).padStart(2, '0')}`
}

export function periodRange(period: string): { start: Date; end: Date } {
  const [y, m] = period.split('-').map(Number) as [number, number]
  return { start: fromLocal(y, m), end: fromLocal(y, m + 1) }
}

export function shiftPeriod(period: string, months: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number]
  const idx = y * 12 + (m - 1) + months
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/** Vencimento: dia `dueDay` do mês seguinte ao ciclo ("2026-10-10"). */
export function dueDateOf(period: string, dueDay: number): string {
  const next = shiftPeriod(period, 1)
  return `${next}-${String(Math.min(Math.max(dueDay, 1), 28)).padStart(2, '0')}`
}

/** "2026-10-14 07:00" no horário do condomínio: o formato que o agente devolve pra agendar. */
export function localStamp(d: Date): string {
  const p = toLocal(d)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${two(p.month)}-${two(p.day)} ${two(p.hour)}:${two(p.minute)}`
}

const WEEKDAY_SHORT = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']

/** "qua 24/09 15h" no horário do condomínio — pra texto que vai para o agente ou para o usuário. */
export function localHourLabel(d: Date): string {
  const p = toLocal(d)
  const dd = String(p.day).padStart(2, '0')
  const mm = String(p.month).padStart(2, '0')
  return `${WEEKDAY_SHORT[p.weekday]} ${dd}/${mm} ${p.hour}h${p.minute ? String(p.minute).padStart(2, '0') : ''}`
}
