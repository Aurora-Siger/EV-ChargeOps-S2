import { describe, expect, it } from 'vitest'
import { fromLocal } from '../../../shared/time.js'
import { fitsOpening, parseOpeningHours } from './opening.js'

// 2026-07-03 é sexta; 07-05 é domingo
const at = (day: number, h: number, mi = 0) => fromLocal(2026, 7, day, h, mi)

describe('parseOpeningHours', () => {
  it('lê faixa de dias e de horas', () => {
    expect(parseOpeningHours('seg a sáb, 7h–23h')).toEqual({ days: [true, true, true, true, true, true, false], open: 7, close: 23 })
    expect(parseOpeningHours('ter a dom, 10h-18h')).toEqual({ days: [false, true, true, true, true, true, true], open: 10, close: 18 })
    expect(parseOpeningHours('segunda a sexta, das 8h às 22h')?.days).toEqual([true, true, true, true, true, false, false])
  })

  it('sem faixa de dias = todo dia', () => {
    expect(parseOpeningHours('6h–22h')?.days.every(Boolean)).toBe(true)
  })

  it('"24h", vazio ou ilegível = sempre aberto (null)', () => {
    expect(parseOpeningHours('24h para moradores')).toBeNull()
    expect(parseOpeningHours(null)).toBeNull()
    expect(parseOpeningHours('horário comercial')).toBeNull()
    expect(parseOpeningHours('22h–6h')).toBeNull() // virada de dia: não suportada, fica aberto
  })
})

describe('fitsOpening', () => {
  const fiap = parseOpeningHours('seg a sáb, 7h–23h')

  it('janela inteira dentro do horário', () => {
    expect(fitsOpening(fiap, at(3, 7), at(3, 10, 30))).toBe(true)
    expect(fitsOpening(fiap, at(3, 19, 30), at(3, 23))).toBe(true)
  })

  it('começa antes de abrir ou termina depois de fechar', () => {
    expect(fitsOpening(fiap, at(3, 6), at(3, 9))).toBe(false)
    expect(fitsOpening(fiap, at(3, 21), at(3, 24, 30))).toBe(false)
  })

  it('dia fechado', () => {
    expect(fitsOpening(fiap, at(5, 10), at(5, 12))).toBe(false)
  })

  it('null = sempre cabe', () => {
    expect(fitsOpening(null, at(5, 3), at(5, 6))).toBe(true)
  })
})
