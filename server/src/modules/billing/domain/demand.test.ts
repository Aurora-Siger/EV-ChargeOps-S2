import { describe, expect, it } from 'vitest'
import { fromLocal } from '../../../shared/time.js'
import { linearForecast, multFromDemand, occupiedFraction, predictDemand, priceCurve } from './demand.js'

const at = (d: number, h: number, mi = 0) => fromLocal(2026, 6, d, h, mi) // junho/2026: dia 5 é sexta

describe('linearForecast', () => {
  it('reproduz o exemplo do README (sextas às 18h)', () => {
    expect(linearForecast([0.75, 0.78, 0.8, 0.82])).toBeCloseTo(0.845, 3)
  })
  it('sem histórico é neutro', () => expect(linearForecast([])).toBe(0.5))
})

describe('occupiedFraction', () => {
  it('mede só a parte da hora coberta pela sessão', () => {
    expect(occupiedFraction([{ start: at(5, 18, 30), end: at(5, 20) }], at(5, 18))).toBeCloseTo(0.5)
  })
})

describe('predictDemand', () => {
  // sextas às 18h, ocupadas nas 4 semanas anteriores à sexta dia 3 de julho
  const sessions = [5, 12, 19, 26].map((d) => ({ start: at(d, 18), end: at(d, 19) }))
  const historyStart = fromLocal(2026, 6, 1)

  it('slot sempre ocupado vira demanda 1 e mult no teto', () => {
    const d = predictDemand(sessions, fromLocal(2026, 7, 3, 18, 20), historyStart)
    expect(d).toBe(1)
    expect(multFromDemand(d)).toBe(1.5)
  })
  it('slot nunca usado vira desconto máximo', () => {
    expect(multFromDemand(predictDemand(sessions, fromLocal(2026, 7, 3, 3), historyStart))).toBe(0.5)
  })
  it('semana antes do início do histórico não conta como demanda zero', () => {
    expect(predictDemand(sessions, fromLocal(2026, 6, 12, 18), historyStart)).toBe(1)
    expect(predictDemand([], at(12, 18), null)).toBe(0.5)
  })
})

describe('priceCurve', () => {
  it('preço = tarifa base × mult', () => {
    const [h] = priceCurve([], at(5, 10), 1, 52)
    expect(h).toMatchObject({ mult: 1, priceCentsKwh: 52, level: 'mid' })
  })
})
