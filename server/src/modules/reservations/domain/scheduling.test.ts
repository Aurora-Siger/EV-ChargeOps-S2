import { describe, expect, it } from 'vitest'
import { fromLocal } from '../../../shared/time.js'
import { parseOpeningHours } from './opening.js'
import { cheapestWindow, recommendedForDeadline, startSlots, windowCostCents, type HourPrice } from './scheduling.js'

const at = (h: number, mi = 0) => fromLocal(2026, 7, 3, h, mi) // sexta

/** Curva simples: cara de dia (100), barata de madrugada (40), a partir da meia-noite local. */
function curve24(): HourPrice[] {
  return Array.from({ length: 48 }, (_, i) => {
    const hourOfDay = i % 24
    const cheap = hourOfDay >= 1 && hourOfDay <= 5
    return { at: fromLocal(2026, 7, 3, 0, 0 + i * 60), priceCentsKwh: cheap ? 40 : 100, level: cheap ? 'cheap' : 'peak' }
  })
}

describe('windowCostCents', () => {
  it('soma meia hora a meia hora', () => {
    const curve: HourPrice[] = [{ at: at(10), priceCentsKwh: 100, level: 'mid' }]
    expect(windowCostCents(curve, at(10).getTime(), 1, 7)).toBe(700)
    expect(windowCostCents(curve, at(10).getTime(), 0.5, 7)).toBe(350)
  })
  it('null se a curva não cobre o período inteiro', () => {
    const curve: HourPrice[] = [{ at: at(10), priceCentsKwh: 100, level: 'mid' }]
    expect(windowCostCents(curve, at(10).getTime(), 2, 7)).toBeNull()
  })
})

describe('cheapestWindow', () => {
  it('acha a janela mais barata livre dentro do prazo', () => {
    const w = cheapestWindow({
      curve: curve24(),
      earliest: at(0),
      deadline: at(23, 59),
      energyKwh: 7, // 1h a 7kW
      rateKw: 7,
      busy: [],
    })
    expect(w).not.toBeNull()
    expect(w!.level).toBe('cheap')
    expect(new Date(w!.start).getUTCHours()).toBeGreaterThanOrEqual(1 + 3) // +3 = UTC-3 local
  })

  it('respeita conflito de horário (janela barata ocupada vira peak)', () => {
    const w = cheapestWindow({
      curve: curve24(),
      earliest: at(0),
      deadline: at(23, 59),
      energyKwh: 7,
      rateKw: 7,
      busy: [{ startsAt: at(0), endsAt: at(6) }], // ocupa toda a madrugada, inclusive a barata
    })
    expect(w).not.toBeNull()
    expect(w!.level).toBe('peak')
    expect(w!.start.getTime()).toBeGreaterThanOrEqual(at(6).getTime())
  })

  it('null quando o prazo é curto demais pra energia necessária', () => {
    const w = cheapestWindow({ curve: curve24(), earliest: at(0), deadline: at(0, 30), energyKwh: 7, rateKw: 7, busy: [] })
    expect(w).toBeNull()
  })

  it('null sem curva', () => {
    expect(cheapestWindow({ curve: [], earliest: at(0), deadline: at(23), energyKwh: 7, rateKw: 7, busy: [] })).toBeNull()
  })
  it('começa agora quando a próxima hora cheia já não cabe no prazo', () => {
    const w = cheapestWindow({ curve: curve24(), earliest: at(14, 10), deadline: at(15, 30), energyKwh: 7, rateKw: 7, busy: [] })
    expect(w?.start).toEqual(at(14, 10))
    expect(w?.end).toEqual(at(15, 10))
  })
})

describe('startSlots', () => {
  const base = { curve: curve24(), hours: 2, rateKw: 7, busy: [], occupiedNow: false }

  it('hoje: "agora" primeiro, depois só horas cheias futuras', () => {
    const slots = startSlots({ ...base, now: at(21, 40), from: at(0), to: at(24) })
    expect(slots.map((s) => s.now)).toEqual([true, false, false])
    expect(slots[0]!.startsAt).toEqual(at(21, 40))
    expect(slots[1]!.startsAt).toEqual(at(22))
    expect(slots[2]!.startsAt).toEqual(at(23))
    expect(slots[0]!.endsAt).toEqual(at(23, 40))
  })

  it('"agora" em hora cheia não repete a mesma hora', () => {
    const slots = startSlots({ ...base, now: at(22), from: at(0), to: at(24) })
    expect(slots.map((s) => s.startsAt)).toEqual([at(22), at(23)])
  })

  it('dia futuro: 24 horas cheias, sem "agora"', () => {
    const slots = startSlots({ ...base, now: at(10), from: at(24), to: at(48) })
    expect(slots).toHaveLength(24)
    expect(slots.some((s) => s.now)).toBe(false)
    expect(slots[0]!.startsAt).toEqual(at(24))
  })

  it('ocupado se a janela inteira (não só o início) bate com outra reserva', () => {
    const slots = startSlots({ ...base, now: at(0), from: at(24), to: at(30), busy: [{ startsAt: at(27), endsAt: at(28) }] })
    const free = Object.fromEntries(slots.map((s) => [s.startsAt.getTime() - at(24).getTime(), s.free]))
    const h = 3_600_000
    expect(free[0]).toBe(true) // 00–02
    expect(free[2 * h]).toBe(false) // 02–04 invade 03–04
    expect(free[3 * h]).toBe(false)
    expect(free[4 * h]).toBe(true) // 04–06
  })

  it('"agora" fica ocupado com carro na tomada; as próximas horas não', () => {
    const slots = startSlots({ ...base, now: at(21, 40), from: at(0), to: at(24), occupiedNow: true })
    expect(slots[0]!.free).toBe(false)
    expect(slots[1]!.free).toBe(true)
  })

  it('some com o horário cuja janela não cabe no funcionamento da estação', () => {
    const opening = parseOpeningHours('seg a sáb, 7h–23h')
    const sexta = startSlots({ ...base, now: at(0), from: at(0), to: at(24), opening })
    expect(sexta[0]!.startsAt).toEqual(at(7))
    expect(sexta.at(-1)!.startsAt).toEqual(at(21)) // 21h + 2h = 23h, fecha na hora
    const domingo = startSlots({ ...base, now: at(0), from: at(48), to: at(72), opening })
    expect(domingo).toHaveLength(0)
  })

  it('nível e custo pela janela inteira; custo null onde a curva acaba', () => {
    const slots = startSlots({ ...base, now: at(0), from: at(24), to: at(48) })
    const two = slots[2]! // 02:00–04:00, madrugada barata
    expect(two.level).toBe('cheap')
    expect(two.costCents).toBe(40 * 7 * 2)
    const zero = slots[0]! // 00:00–02:00: começa cara, mas o meio da janela (01:00) já é barato
    expect(zero.level).toBe('cheap')
    expect(slots[23]!.costCents).toBeNull() // 23:00 + 2h passa do fim da curva de 48h
  })
})

describe('recommendedForDeadline', () => {
  const slot = (h: number, hours: number, costCents: number | null) => ({ startsAt: at(h), endsAt: at(h + hours), costCents })

  it('entre preços iguais, o início mais perto do prazo, com uma hora de folga', () => {
    const slots = [slot(21, 4, 2200), slot(25, 4, 790), slot(26, 4, 790), slot(27, 4, 790), slot(29, 4, 1500)]
    expect(recommendedForDeadline(slots, at(34))!.startsAt).toEqual(at(27)) // 3h–7h; 5h–9h é caro
  })

  it('aceita até 10% acima do mais barato pra começar mais tarde', () => {
    const slots = [slot(25, 4, 790), slot(27, 4, 860), slot(28, 4, 900)]
    expect(recommendedForDeadline(slots, at(34))!.startsAt).toEqual(at(27))
  })

  it('sem folga, o mais barato que ainda termina no prazo; nada se nenhum termina', () => {
    const slots = [slot(21, 5, 2200), slot(22, 4, 1700), slot(23, 4, null)]
    expect(recommendedForDeadline(slots, at(26))!.startsAt).toEqual(at(22))
    expect(recommendedForDeadline(slots, at(24))).toBeUndefined()
  })
})
