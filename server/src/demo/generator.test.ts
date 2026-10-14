import { describe, expect, it } from 'vitest'
import { generateSessions, PERSONAS, telemetry } from './generator.js'
import { idleMinutes, pluggedFromTelemetry } from '../modules/sessions/domain/idle.js'
import { toLocal } from '../shared/time.js'

const END = new Date(Date.UTC(2026, 8, 23, 15, 0))
const opts = { weeks: 8, seed: 42, end: END, personas: PERSONAS }

describe('generateSessions', () => {
  it('é reproduzível pela seed', () => {
    const a = generateSessions(opts)
    const b = generateSessions(opts)
    expect(a).toEqual(b)
    expect(generateSessions({ ...opts, seed: 7 })).not.toEqual(a)
  })

  it('nunca sobrepõe duas sessões (nem a ociosidade) no mesmo carregador', () => {
    const s = generateSessions(opts)
    for (let i = 1; i < s.length; i++) {
      const prevFree = s[i - 1]!.end.getTime() + s[i - 1]!.idleMin * 60_000
      expect(s[i]!.start.getTime()).toBeGreaterThanOrEqual(prevFree)
    }
  })

  it('respeita o período, o fim e o hábito de cada morador', () => {
    const s = generateSessions(opts)
    expect(s.every((x) => x.end <= END)).toBe(true)
    expect(new Set(s.map((x) => x.personaKey))).toEqual(new Set(PERSONAS.map((p) => p.key)))
    const carla = s.filter((x) => x.personaKey === 'carla')
    const fimDeSemana = carla.filter((x) => toLocal(x.start).weekday >= 4).length
    expect(fimDeSemana / carla.length).toBeGreaterThan(0.7)
  })

  it('repete a captura real sem alterar energia nem duração', () => {
    const real = generateSessions(opts).filter((x) => x.source === 'captura-real')
    expect(real.length).toBeGreaterThan(10)
    expect(real.find((x) => x.kwh === 14.6)?.min).toBe(355)
  })

  it('sem replay, é tudo sintético', () => {
    expect(generateSessions({ ...opts, replayReal: false }).every((x) => x.source === 'sintetica')).toBe(true)
  })
})

describe('telemetry', () => {
  it('a ociosidade lida de volta da telemetria bate com a gerada (precisão do poll)', () => {
    const s = generateSessions(opts)
    const samples = telemetry(s, new Date(s[0]!.start.getTime() - 3_600_000), END, 5).map((t) => ({
      at: t.at,
      plugged: pluggedFromTelemetry(t.payload.workState as string, t.payload.status as string),
    }))
    for (const [i, x] of s.entries()) {
      const read = idleMinutes(x.end, s[i + 1]?.start ?? null, samples)
      expect(read).toBeLessThanOrEqual(x.idleMin)
      expect(x.idleMin - read).toBeLessThanOrEqual(5)
    }
  })
})
