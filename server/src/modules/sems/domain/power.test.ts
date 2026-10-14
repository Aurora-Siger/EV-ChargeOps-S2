import { describe, expect, it } from 'vitest'
import { formatSemsLocal } from '../../../shared/time.js'
import { alignToPowerStep, chargingFromPower, liveFromTelemetry, parsePowerSeries } from './power.js'

// Trecho real da série de 12/10/2026 (horário de Brasília), com o fim da janela ainda sem medida.
const series = {
  xAxis: [{ xAxi: '2026-10-12 19:35:00' }, { xAxi: '2026-10-12 19:40:00' }, { xAxi: '2026-10-13 01:40:00', isCE: true }],
  yAxis: [{ code: 'pEvChar', alias: 'charge_pw', data: [0, 3.4, null], unit: 'kW' }],
}

const frozenDetail = {
  collectedAt: new Date('2026-10-12T23:00:13Z'),
  payload: { status: 'available', workState: 'available_gun_no_insered', soc: 0 },
}

describe('parsePowerSeries', () => {
  it('converte o horário local para UTC e ignora o ponto sem medida', () => {
    expect(parsePowerSeries(series)).toEqual([
      { at: new Date('2026-10-12T22:35:00Z'), kw: 0 },
      { at: new Date('2026-10-12T22:40:00Z'), kw: 3.4 },
    ])
  })

  it('resposta sem pEvChar ou vazia vira lista vazia', () => {
    expect(parsePowerSeries({ xAxis: series.xAxis, yAxis: [] })).toEqual([])
    expect(parsePowerSeries(null)).toEqual([])
  })
})

describe('formatSemsLocal', () => {
  it('é o inverso do horário local da SEMS', () => {
    expect(formatSemsLocal(new Date('2026-10-12T22:40:00Z'))).toBe('2026-10-12 19:40:00')
  })
})

describe('chargingFromPower', () => {
  const now = new Date('2026-10-12T23:00:00Z')
  it('potência recente acima de zero é carga', () => {
    expect(chargingFromPower({ at: new Date('2026-10-12T22:50:00Z'), kw: 3.4 }, now)).toBe(true)
    expect(chargingFromPower({ at: new Date('2026-10-12T22:50:00Z'), kw: 0 }, now)).toBe(false)
  })
  it('sem ponto recente não sabe dizer', () => {
    expect(chargingFromPower({ at: new Date('2026-10-12T22:00:00Z'), kw: 3.4 }, now)).toBeNull()
    expect(chargingFromPower(null, now)).toBeNull()
  })
})

describe('liveFromTelemetry', () => {
  const now = new Date('2026-10-12T23:05:00Z')
  it('detail congelado em "cabo fora" com potência recente vira carregando, sem SOC', () => {
    expect(liveFromTelemetry(frozenDetail, { at: new Date('2026-10-12T22:55:00Z'), kw: 3.4 }, now)).toEqual({
      status: 'charging',
      workState: 'charging',
      soc: null,
      collectedAt: '2026-10-12T22:55:00.000Z',
      session: null,
    })
  })

  it('sem potência, vale o detail', () => {
    expect(liveFromTelemetry(frozenDetail, { at: new Date('2026-10-12T22:55:00Z'), kw: 0 }, now)).toEqual({
      status: 'available',
      workState: 'available_gun_no_insered',
      soc: 0,
      collectedAt: '2026-10-12T23:00:13.000Z',
      session: null,
    })
  })

  it('vehConnStu corrige o detail congelado: 1 é plugado sem carregar, 2 é carregando', () => {
    const conn = (vehConnStu: number) => ({ ...frozenDetail, payload: { ...(frozenDetail.payload as object), vehConnStu } })
    const plugged = liveFromTelemetry(conn(1), null, now)
    expect(plugged).toMatchObject({ status: 'available', workState: 'available_gun_insered', soc: null })
    expect(liveFromTelemetry(conn(2), null, now)).toMatchObject({ status: 'charging', workState: 'charging', soc: null })
    expect(liveFromTelemetry(conn(0), null, now)).toMatchObject({ workState: 'available_gun_no_insered', soc: 0 })
  })

  it('detail carregando mantém o SOC dele', () => {
    const charging = { collectedAt: frozenDetail.collectedAt, payload: { status: 'charging', workState: 'charging', soc: 62 } }
    expect(liveFromTelemetry(charging, { at: new Date('2026-10-12T22:55:00Z'), kw: 3.4 }, now)?.soc).toBe(62)
  })

  it('carregando com a sessão em andamento traz tempo, energia, autonomia e potência de agora', () => {
    const lastCharge = {
      payload: { chargeLog: { currentChargeQuantity: 1.53, chargeTimeLength: 31, mileage: 7.65, averCharP: 3.1, chargeStartTime: '2026-10-12 19:34:00' } },
    }
    const live = liveFromTelemetry(frozenDetail, { at: new Date('2026-10-12T23:00:00Z'), kw: 3.4 }, now, lastCharge)
    expect(live?.session).toEqual({ minutes: 31, kwh: 1.53, km: 7.65, powerKw: 3.4, cardNumber: null })
  })

  it('sessão que já terminou há tempo não conta como a de agora', () => {
    const lastCharge = {
      payload: { chargeLog: { currentChargeQuantity: 9, chargeTimeLength: 120, mileage: 40, chargeEndTime: '2026-10-12 12:00:00' } },
    }
    const live = liveFromTelemetry(frozenDetail, { at: new Date('2026-10-12T23:00:00Z'), kw: 3.4 }, now, lastCharge)
    expect(live?.session).toBeNull()
  })

  it('sem detail nem potência, null', () => {
    expect(liveFromTelemetry(null, null, now)).toBeNull()
  })
})

describe('alignToPowerStep', () => {
  it('leva a janela para o múltiplo de 5 min, senão a GoodWe devolve só null', () => {
    expect(formatSemsLocal(alignToPowerStep(new Date('2026-10-13T10:43:51Z')))).toBe('2026-10-13 07:40:00')
    expect(formatSemsLocal(alignToPowerStep(new Date('2026-10-13T10:45:00Z')))).toBe('2026-10-13 07:45:00')
  })
})
