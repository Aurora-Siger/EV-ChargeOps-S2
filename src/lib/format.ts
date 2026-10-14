/**
 * Formatação no fuso do condomínio (America/Sao_Paulo) — o mesmo em que o backend corta
 * slots e ciclos —, independente do fuso do navegador.
 */
const TZ = 'America/Sao_Paulo'
const HOUR_MS = 3_600_000

export const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
})
const WD: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

export type Local = { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

export function local(d: Date | string): Local {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(d)).map((x) => [x.type, x.value]))
  return {
    year: +p.year,
    month: +p.month,
    day: +p.day,
    hour: +p.hour,
    minute: +p.minute,
    weekday: WD[p.weekday] ?? 0,
  }
}

/**
 * Instante de uma data/hora local do condomínio (America/Sao_Paulo, respeita horário de verão).
 * Aceita estouro como o Date.UTC (31/09 = 01/10): a hora de parede é normalizada primeiro e só
 * depois se descobre o fuso daquele instante. Comparar o dia pedido com o calculado quebrava na
 * virada do mês (31 contra 1 empurrava a data 30 dias pra frente).
 */
export function fromLocal(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute) // hora de parede, já normalizada
  const guess = wall + 3 * HOUR_MS // primeiro palpite: UTC-3
  const l = local(new Date(guess))
  const offset = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute) - guess // fuso real no palpite
  return new Date(wall - offset)
}

const pad = (n: number) => String(n).padStart(2, '0')

export const fmtBRL = (cents: number) =>
  `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const fmtKwh = (v: number, digits = 1) =>
  `${v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} kWh`
export const fmtNum = (v: number, digits = 1) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
export const fmtPct = (v: number) => `${Math.round(v * 100)}%`
export const fmtMult = (v: number) => `${fmtNum(v, 2)}×`

export function fmtTime(d: Date | string) {
  const l = local(d)
  return `${pad(l.hour)}:${pad(l.minute)}`
}

export function fmtDate(d: Date | string) {
  const l = local(d)
  return `${pad(l.day)}/${pad(l.month)}`
}

export function fmtDateTime(d: Date | string) {
  return `${fmtDate(d)} ${fmtTime(d)}`
}

/** "hoje", "ontem", "amanhã" ou "sex 18/09". */
export function fmtDay(d: Date | string, now = new Date()) {
  const a = local(d)
  const b = local(now)
  const diff = Math.round((Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 86_400_000)
  if (diff === 0) return 'hoje'
  if (diff === -1) return 'ontem'
  if (diff === 1) return 'amanhã'
  return `${WEEKDAYS[a.weekday]} ${pad(a.day)}/${pad(a.month)}`
}

export function fmtMinutes(min: number) {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h === 0 ? `${m}min` : `${h}h${pad(m)}`
}

export function fmtHours(h: number) {
  return fmtMinutes(h * 60)
}

export function currentPeriod(now = new Date()) {
  const l = local(now)
  return `${l.year}-${pad(l.month)}`
}

export function shiftPeriod(period: string, months: number) {
  const [y, m] = period.split('-').map(Number)
  const idx = y * 12 + (m - 1) + months
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`
}

export function periodLabel(period: string) {
  const [y, m] = period.split('-').map(Number)
  return `${MONTHS[m - 1]} de ${y}`
}

export function monthName(period: string) {
  return MONTHS[Number(period.split('-')[1]) - 1]
}

export function fmtDueDate(iso: string) {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export const LEVEL_LABEL = { cheap: 'Barato', mid: 'Normal', peak: 'Pico' } as const

export const STATE_LABEL = {
  OPEN: 'Ciclo aberto',
  PENDING: 'A pagar',
  PAID: 'Paga',
  OVERDUE: 'Vencida',
  EXEMPT: 'Isento',
} as const
export const STATE_TAG = { OPEN: 'dim', PENDING: 'mid', PAID: 'cheap', OVERDUE: 'peak', EXEMPT: 'dim' } as const

export const CHARGE_LABEL = {
  PENDING: 'Em aberto',
  OVERDUE: 'Vencida',
  RECEIVED: 'Recebida',
  CANCELLED: 'Cancelada',
  REFUNDED: 'Estornada',
} as const
export const CHARGE_TAG = { PENDING: 'mid', OVERDUE: 'peak', RECEIVED: 'cheap', CANCELLED: 'dim', REFUNDED: 'dim' } as const
export const METHOD_LABEL = { PIX: 'Pix', BOLETO: 'Boleto' } as const
