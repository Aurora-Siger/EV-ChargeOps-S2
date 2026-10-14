import { describe, expect, it } from 'vitest'
import { compareWithPrevious } from './comparison.js'

describe('compareWithPrevious', () => {
  it('mês aberto abaixo do anterior (o setembro da Ana): diz quanto a menos e que é parcial', () => {
    const c = compareWithPrevious({ period: '2026-09', totalCents: 7527, previousTotalCents: 10029, closed: false })
    expect(c).toEqual({
      previousPeriod: '2026-08',
      previousTotalCents: 10029,
      differenceCents: -2502,
      direction: 'down',
      partial: true,
      summary: 'R$ 25,02 a menos que em agosto até agora (o mês ainda está aberto e pode subir).',
    })
  })

  it('mês fechado acima do anterior', () => {
    const c = compareWithPrevious({ period: '2026-08', totalCents: 10029, previousTotalCents: 7038, closed: true })
    expect(c?.direction).toBe('up')
    expect(c?.differenceCents).toBe(2991)
    expect(c?.partial).toBe(false)
    expect(c?.summary).toBe('R$ 29,91 a mais que em julho.')
  })

  it('mesmo valor', () => {
    const c = compareWithPrevious({ period: '2026-08', totalCents: 5000, previousTotalCents: 5000, closed: true })
    expect(c?.direction).toBe('same')
    expect(c?.summary).toBe('o mesmo valor de julho.')
  })

  it('janeiro compara com dezembro do ano anterior', () => {
    const c = compareWithPrevious({ period: '2027-01', totalCents: 100, previousTotalCents: 50, closed: true })
    expect(c?.previousPeriod).toBe('2026-12')
    expect(c?.summary).toBe('R$ 0,50 a mais que em dezembro.')
  })

  it('sem fatura no mês anterior ou neste mês: null', () => {
    expect(compareWithPrevious({ period: '2026-09', totalCents: 7527, previousTotalCents: null, closed: false })).toBeNull()
    expect(compareWithPrevious({ period: '2026-09', totalCents: null, previousTotalCents: 10029, closed: false })).toBeNull()
  })
})
