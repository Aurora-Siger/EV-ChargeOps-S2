import { describe, expect, it } from 'vitest'
import { idleMinutes, MAX_IDLE_MIN, pluggedFromTelemetry, type PlugSample } from './idle.js'

const at = (min: number) => new Date(Date.UTC(2026, 8, 23, 12, min))
const s = (min: number, plugged: boolean | null): PlugSample => ({ at: at(min), plugged })

describe('pluggedFromTelemetry', () => {
  it('lê os estados que a SEMS manda', () => {
    expect(pluggedFromTelemetry('available_gun_insered', 'available')).toBe(true)
    expect(pluggedFromTelemetry('available_gun_no_insered', 'available')).toBe(false)
    expect(pluggedFromTelemetry('charging', 'charging')).toBe(true)
    expect(pluggedFromTelemetry('fault', 'unknown')).toBeNull()
  })

  it('vehConnStu vale mais que o workState congelado em "cabo fora"', () => {
    expect(pluggedFromTelemetry('available_gun_no_insered', 'available', 1)).toBe(true)
    expect(pluggedFromTelemetry('available_gun_no_insered', 'available', 2)).toBe(true)
    expect(pluggedFromTelemetry('available_gun_no_insered', 'available', 0)).toBe(false)
  })
})

describe('idleMinutes', () => {
  it('conta do fim da carga até o último status ainda plugado', () => {
    const samples = [s(5, true), s(10, true), s(15, true), s(20, false)]
    expect(idleMinutes(at(0), null, samples)).toBe(15)
  })

  it('cabo tirado antes do primeiro poll = zero (nunca cobra pelo que não viu)', () => {
    expect(idleMinutes(at(0), null, [s(5, false), s(10, true)])).toBe(0)
  })

  it('para na chegada do próximo carro', () => {
    const samples = [s(5, true), s(10, true), s(30, true), s(35, true)]
    expect(idleMinutes(at(0), at(20), samples)).toBe(10)
  })

  it('ignora estados desconhecidos e o que veio antes do fim da sessão', () => {
    const samples = [s(-5, true), s(5, null), s(10, true), s(15, null), s(20, false)]
    expect(idleMinutes(at(0), null, samples)).toBe(10)
  })

  it('tem teto quando o cabo nunca aparece saindo', () => {
    const samples = Array.from({ length: 200 }, (_, i) => s(5 * (i + 1), true))
    expect(idleMinutes(at(0), null, samples)).toBe(MAX_IDLE_MIN)
  })
})
