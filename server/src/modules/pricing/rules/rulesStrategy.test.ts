import { describe, expect, it } from 'vitest'
import { applyGuardrails } from '../domain/guardrails.js'
import { rulesStrategy } from './rulesStrategy.js'

const base = { chargerId: 'c1', basePriceCentsKwh: 100, occupancy: 0.2, gridLoad: 0.3, recentDemandKwh: 10 }

describe('rulesStrategy', () => {
  it('aplica ágio no horário de pico', async () => {
    const r = await rulesStrategy.price({ ...base, now: new Date('2026-01-01T19:00:00') })
    expect(r.multiplier).toBeCloseTo(1.2)
  })
})

describe('applyGuardrails', () => {
  const g = { minPriceCentsKwh: 50, maxPriceCentsKwh: 200, maxStepPercent: 15 }
  it('respeita o teto', () => expect(applyGuardrails(500, g).price).toBe(200))
  it('limita o salto entre decisões', () => expect(applyGuardrails(150, g, 100).price).toBe(115))
})
