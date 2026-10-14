import { describe, expect, it } from 'vitest'
import { computeCycle, priceSession, splitEvenly } from './rateio.js'

const cfg = { tariffBaseCentsKwh: 52, idleCentsPerMinute: 10, idleGraceMinutes: 15 }

describe('priceSession', () => {
  it('aplica o mult na energia e na ociosidade além da carência', () => {
    const p = priceSession({ ...cfg, energyKwh: 10, idleMin: 25, mult: 1.2 })
    expect(p).toEqual({ energyCostCents: 520, idleChargeableMin: 10, chargedCents: Math.round(1.2 * (520 + 100)) })
  })
  it('ociosidade dentro da carência é grátis', () => {
    expect(priceSession({ ...cfg, energyKwh: 1, idleMin: 15, mult: 1 }).idleChargeableMin).toBe(0)
  })
})

describe('computeCycle', () => {
  const s = (energyCostCents: number, chargedCents: number) => ({ energyKwh: 1, energyCostCents, chargedCents })

  it('divide o custo fixo só entre ativos e isenta quem não carregou', () => {
    const rows = computeCycle(
      [{ userId: 'a', sessions: [s(100, 100)] }, { userId: 'b', sessions: [s(100, 100)] }, { userId: 'c', sessions: [] }],
      1001,
    )
    expect(rows.map((r) => r.fixedShareCents)).toEqual([501, 500, 0])
    expect(rows[2]!.totalCents).toBe(0)
  })
  it('excedente vira crédito na parcela fixa, travado em zero e no valor da parcela', () => {
    const [pico, madrugada, exagero] = computeCycle(
      [
        { userId: 'a', sessions: [s(1000, 1300)] },
        { userId: 'b', sessions: [s(1000, 600)] },
        { userId: 'c', sessions: [s(1000, 9000)] },
      ],
      3000,
    )
    expect(pico).toMatchObject({ surplusCents: 300, creditCents: 300, totalCents: 1300 + 1000 - 300 })
    expect(madrugada).toMatchObject({ surplusCents: -400, creditCents: 0, totalCents: 600 + 1000 })
    expect(exagero).toMatchObject({ creditCents: 1000, totalCents: 9000 })
  })
  it('convidado paga só o consumo e o excedente dele abate o custo fixo dos moradores', () => {
    const [morador, convidado] = computeCycle(
      [
        { userId: 'a', sessions: [s(1000, 1000)] },
        { userId: 'g', guest: true, sessions: [s(1000, 1200)] },
      ],
      3000,
    )
    expect(convidado).toMatchObject({ fixedShareCents: 0, creditCents: 0, totalCents: 1200 })
    expect(morador).toMatchObject({ fixedShareCents: 3000 - 200, totalCents: 1000 + 2800 })
  })
  it('convidado sozinho no ciclo não paga custo fixo', () => {
    const [g] = computeCycle([{ userId: 'g', guest: true, sessions: [s(500, 400)] }], 3000)
    expect(g).toMatchObject({ active: true, fixedShareCents: 0, totalCents: 400 })
  })
  it('ajuste do gestor entra só na fatura da pessoa, sem mexer em quem é ativo', () => {
    const [a, b, c] = computeCycle(
      [
        { userId: 'a', sessions: [s(1000, 1000)], adjustmentCents: -500 },
        { userId: 'b', sessions: [s(1000, 1000)] },
        { userId: 'c', sessions: [], adjustmentCents: 300 },
      ],
      2000,
    )
    expect(a).toMatchObject({ fixedShareCents: 1000, adjustmentCents: -500, totalCents: 1000 + 1000 - 500 })
    expect(b).toMatchObject({ fixedShareCents: 1000, totalCents: 2000 })
    expect(c).toMatchObject({ active: false, fixedShareCents: 0, totalCents: 300 })
  })
  it('crédito maior que a fatura zera a fatura, sem valor negativo', () => {
    const [a] = computeCycle([{ userId: 'a', sessions: [s(100, 100)], adjustmentCents: -5000 }], 0)
    expect(a!.totalCents).toBe(0)
  })
  it('splitEvenly soma exatamente o total', () => {
    expect(splitEvenly(10, 3).reduce((a, b) => a + b, 0)).toBe(10)
  })
})
