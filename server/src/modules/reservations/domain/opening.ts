/**
 * Horário de funcionamento a partir do texto livre que o gestor cadastra na estação
 * ("seg a sáb, 7h–23h", "ter a dom, 10h–18h", "24h para moradores"). O que não dá pra ler vira
 * "sempre aberto" (null): melhor oferecer horário a mais do que sumir com a estação.
 */
import { fromLocal, toLocal } from '../../../shared/time.js'

const HOUR_MS = 3_600_000
const DAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom']

/** `days[0]` = segunda; `open`/`close` em hora local cheia (close até 24). */
export type OpeningHours = { days: boolean[]; open: number; close: number }

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function parseOpeningHours(text: string | null): OpeningHours | null {
  if (!text) return null
  const t = normalize(text)
  const hours = t.match(/(\d{1,2})\s*h\s*(?:\d{2})?\s*(?:[-–—]|as|a)\s*(\d{1,2})\s*h/)
  if (!hours) return null
  const open = Number(hours[1])
  const close = Number(hours[2])
  if (!(open >= 0 && close <= 24 && open < close)) return null

  const range = t.match(/\b(seg|ter|qua|qui|sex|sab|dom)[a-z-]*\s*(?:a|ate|[-–—])\s*(seg|ter|qua|qui|sex|sab|dom)/)
  const a = range ? DAYS.indexOf(range[1]!) : 0
  const b = range ? DAYS.indexOf(range[2]!) : 6
  const days = DAYS.map((_, i) => (a <= b ? i >= a && i <= b : i >= a || i <= b))
  return { days, open, close }
}

/** A janela [start, end) cabe inteira num dia aberto, entre a abertura e o fechamento. */
export function fitsOpening(h: OpeningHours | null, start: Date, end: Date): boolean {
  if (!h) return true
  const l = toLocal(start)
  const dayStart = fromLocal(l.year, l.month, l.day).getTime()
  return h.days[l.weekday]! && start.getTime() >= dayStart + h.open * HOUR_MS && end.getTime() <= dayStart + h.close * HOUR_MS
}
