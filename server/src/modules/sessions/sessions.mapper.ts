import { parseSemsLocal } from '../../shared/time.js'

/**
 * Anti-corrupção: item bruto do `queryChargeLogList` da SEMS+ (sems_charge_log.payload)
 * → campos da `charge_session`. Os horários da SEMS vêm no horário local do carregador.
 */
export type MappedSession = {
  serial: string
  startedAt: Date
  endedAt: Date
  energyKwh: number
  greenKwh: number | null
  gridKwh: number | null
  durationMin: number | null
  mileageKm: number | null
  cardNumber: string | null
  endCause: string | null
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function mapSemsChargeLog(serial: string, payload: Record<string, unknown>): MappedSession | null {
  const startedAt = parseSemsLocal(payload.chargeStartTime)
  if (!startedAt) return null
  const durationMin = num(payload.chargeTimeLength)
  const endedAt =
    parseSemsLocal(payload.chargeEndTime) ?? new Date(startedAt.getTime() + (durationMin ?? 0) * 60_000)
  return {
    serial,
    startedAt,
    endedAt,
    energyKwh: num(payload.currentChargeQuantity) ?? 0,
    greenKwh: num(payload.greenElec),
    gridKwh: num(payload.purElec),
    durationMin,
    mileageKm: num(payload.mileage),
    cardNumber: str(payload.chargeCardNumber),
    endCause: str(payload.chargeEndCause),
  }
}
