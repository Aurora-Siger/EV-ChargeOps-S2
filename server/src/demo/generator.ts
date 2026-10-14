/**
 * Gerador do condomínio de DEMONSTRAÇÃO: sessões e telemetria parametrizadas, sem banco e sem
 * rede (quem grava é seedDemoData.ts). Reproduzível: mesma `seed` → mesmos dados.
 *
 * Nada aqui é inventado do zero. Energia e duração de cada sessão sintética são sorteadas das
 * 20 sessões reais do HCA G2 da FIAP (realSessions.ts), com variação de ±15%. O que muda por
 * morador é o hábito: quantas vezes por semana, em que hora, em que dia e quanto tempo deixa o
 * carro plugado depois da carga. Um carregador só: sessões que colidem esperam a vaga liberar.
 */
import { fromLocal, toLocal } from '../shared/time.js'
import { DEVICE_SN, REAL_SESSIONS } from '../realSessions.js'

const MIN_MS = 60_000
const HOUR_MS = 60 * MIN_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS

export type Persona = {
  key: string
  name: string
  unitLabel: string
  /** cartão RFID; o primeiro morador usa o cartão real das sessões capturadas */
  cardNumber: string
  habit: string
  sessionsPerWeek: number
  /** hora local de chegada: média e desvio (horas) */
  hourMean: number
  hourSd: number
  /** peso de cada dia da semana, 0 = segunda … 6 = domingo */
  weekdays: [number, number, number, number, number, number, number]
  /** minutos plugado depois do fim da carga, sorteado entre [min, max] */
  idleMin: [number, number]
  /** repete a captura real (datas deslocadas) no período que ela cobre */
  replaysRealCapture?: boolean
  vehicle: { model: string; capacityKwh: number; rangeKm: number; maxChargeKw: number }
}

export const PERSONAS: Persona[] = [
  {
    key: 'ana',
    name: 'Ana Ribeiro',
    unitLabel: 'Apto 101',
    cardNumber: DEVICE_SN,
    habit: 'chega do trabalho e carrega no pico da noite (é o padrão real do carregador da FIAP)',
    sessionsPerWeek: 4.5,
    hourMean: 20.5,
    hourSd: 1,
    weekdays: [3, 3, 3, 3, 3, 2, 1],
    idleMin: [0, 25],
    replaysRealCapture: true,
    vehicle: { model: 'BYD Dolphin Mini', capacityKwh: 38, rangeKm: 280, maxChargeKw: 6.6 },
  },
  {
    key: 'bruno',
    name: 'Bruno Costa',
    unitLabel: 'Apto 202',
    cardNumber: 'DEMO-CARD-202',
    habit: 'trabalha de casa e carrega de manhã, fora do pico',
    sessionsPerWeek: 2.5,
    hourMean: 10,
    hourSd: 1.8,
    weekdays: [2, 2, 2, 2, 2, 1, 0],
    idleMin: [0, 15],
    vehicle: { model: 'BYD Dolphin', capacityKwh: 44.9, rangeKm: 291, maxChargeKw: 6.6 },
  },
  {
    key: 'carla',
    name: 'Carla Mendes',
    unitLabel: 'Apto 303',
    cardNumber: 'DEMO-CARD-303',
    habit: 'carrega no fim de semana à tarde',
    sessionsPerWeek: 1.5,
    hourMean: 15,
    hourSd: 2,
    weekdays: [0, 0, 0, 0, 1, 4, 4],
    idleMin: [5, 30],
    vehicle: { model: 'Renault Kwid E-Tech', capacityKwh: 26.8, rangeKm: 185, maxChargeKw: 7 },
  },
  {
    key: 'diego',
    name: 'Diego Alves',
    unitLabel: 'Apto 404',
    cardNumber: 'DEMO-CARD-404',
    habit: 'carrega no começo da noite e esquece o carro plugado (gera ociosidade)',
    sessionsPerWeek: 1.2,
    hourMean: 17.5,
    hourSd: 2,
    weekdays: [1, 1, 1, 1, 1, 1, 1],
    idleMin: [45, 180],
    vehicle: { model: 'GWM Ora 03', capacityKwh: 48, rangeKm: 315, maxChargeKw: 6.6 },
  },
]

export type DemoSession = {
  serial: string
  personaKey: string
  cardNumber: string
  start: Date
  end: Date
  kwh: number
  greenKwh: number
  min: number
  km: number
  idleMin: number
  source: 'captura-real' | 'sintetica'
}

export type GenOptions = {
  weeks: number
  seed: number
  /** nada termina depois disso (normalmente "agora") */
  end: Date
  personas: Persona[]
  /** false: tudo sintético, sem repetir a captura real */
  replayReal?: boolean
}

/** PRNG pequeno e determinístico (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const normal = (r: () => number, mean: number, sd: number) =>
  mean + sd * Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())

const round2 = (x: number) => Math.round(x * 100) / 100

/** "2026-09-23 20:15:00" no horário local — o formato que a SEMS usa no charge log. */
export function semsLocal(d: Date): string {
  const p = toLocal(d)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${z(p.month)}-${z(p.day)} ${z(p.hour)}:${z(p.minute)}:00`
}

/** "2026-06-19 19:27:28" (horário local da captura) → instante. */
function realLocal(s: string): Date {
  const [d, t] = s.split(' ') as [string, string]
  const [y, mo, da] = d.split('-').map(Number) as [number, number, number]
  const [h, mi, se] = t.split(':').map(Number) as [number, number, number]
  return new Date(fromLocal(y, mo, da, h, mi).getTime() + se * 1000)
}

const TEMPLATES = REAL_SESSIONS.filter((s) => s.kwh >= 0.5)

export function generateSessions(o: GenOptions): DemoSession[] {
  const r = rng(o.seed)
  const endMs = o.end.getTime()
  const firstWeek = new Date(endMs - o.weeks * WEEK_MS)
  const p0 = toLocal(firstWeek)
  const dayZero = fromLocal(p0.year, p0.month, p0.day)
  const candidates: DemoSession[] = []

  // Captura real: desloca em semanas inteiras pra terminar perto de `end` (mantém o dia da semana).
  const real = REAL_SESSIONS.map((s) => ({ ...s, startAt: realLocal(s.start), endAt: realLocal(s.end) }))
  const lastRealEnd = Math.max(...real.map((s) => s.endAt.getTime()))
  const shift = Math.max(0, Math.floor((endMs - lastRealEnd) / WEEK_MS)) * WEEK_MS
  const realFrom = Math.min(...real.map((s) => s.startAt.getTime())) + shift

  for (const p of o.personas) {
    const replay = p.replaysRealCapture && o.replayReal !== false
    if (replay) {
      for (const s of real) {
        const start = new Date(s.startAt.getTime() + shift)
        if (start.getTime() < firstWeek.getTime()) continue
        candidates.push({
          serial: '',
          personaKey: p.key,
          cardNumber: p.cardNumber,
          start,
          end: new Date(s.endAt.getTime() + shift),
          kwh: s.kwh,
          greenKwh: s.green,
          min: s.min,
          km: s.km,
          idleMin: 0,
          source: 'captura-real',
        })
      }
    }
    const weightSum = p.weekdays.reduce((a, b) => a + b, 0) || 1
    for (let day = 0; day < o.weeks * 7; day++) {
      const dayStart = dayZero.getTime() + day * DAY_MS
      if (replay && dayStart >= realFrom - DAY_MS) continue // o período da captura já é real
      const weekday = toLocal(new Date(dayStart + 12 * HOUR_MS)).weekday
      const chance = (p.sessionsPerWeek * p.weekdays[weekday]!) / weightSum
      if (r() >= chance) continue
      const hour = Math.min(23.75, Math.max(0, normal(r, p.hourMean, p.hourSd)))
      const t = TEMPLATES[Math.floor(r() * TEMPLATES.length)]!
      const k = 0.85 + r() * 0.3
      const min = Math.max(20, Math.round(t.min * k))
      const start = new Date(dayStart + Math.round(hour * 60) * MIN_MS)
      candidates.push({
        serial: '',
        personaKey: p.key,
        cardNumber: p.cardNumber,
        start,
        end: new Date(start.getTime() + min * MIN_MS),
        kwh: round2(t.kwh * k),
        greenKwh: round2(t.green * k),
        min,
        km: round2(t.km * k),
        idleMin: 0,
        source: 'sintetica',
      })
    }
  }

  // Um carregador só. A captura real entra primeiro (é o que aconteceu de fato); as sintéticas
  // que chegam com a vaga ocupada esperam liberar, e desistem se a espera passar de 3h.
  const byKey = new Map(o.personas.map((p) => [p.key, p]))
  const accepted: DemoSession[] = []
  const busy = (from: number, to: number) =>
    accepted.find((a) => from < a.end.getTime() + a.idleMin * MIN_MS && to > a.start.getTime())
  const realStarts = candidates
    .filter((c) => c.source === 'captura-real')
    .map((c) => c.start.getTime())
    .sort((a, b) => a - b)
  const place = (c: DemoSession) => {
    const [lo, hi] = byKey.get(c.personaKey)!.idleMin
    let idleMin = Math.round(lo + r() * (hi - lo))
    if (c.source === 'captura-real') {
      // a ociosidade da captura não pode invadir a próxima sessão real
      const next = realStarts.find((t) => t > c.start.getTime())
      if (next !== undefined) idleMin = Math.max(0, Math.min(idleMin, Math.floor((next - c.end.getTime()) / MIN_MS) - 1))
    }
    let s = c
    const originalStart = c.start.getTime()
    const freeAt = (x: DemoSession) => x.end.getTime() + idleMin * MIN_MS
    for (let hit = busy(s.start.getTime(), freeAt(s)); hit; hit = busy(s.start.getTime(), freeAt(s))) {
      if (s.source === 'captura-real') return
      const next = hit.end.getTime() + hit.idleMin * MIN_MS + 10 * MIN_MS
      if (next - originalStart > 3 * HOUR_MS) return
      s = { ...s, start: new Date(next), end: new Date(next + s.min * MIN_MS) }
    }
    if (s.end.getTime() > endMs) return
    const p = toLocal(s.start)
    const z = (n: number) => String(n).padStart(2, '0')
    accepted.push({ ...s, idleMin, serial: `DEMO-${p.year}${z(p.month)}${z(p.day)}${z(p.hour)}${z(p.minute)}-${s.personaKey}` })
  }
  const byStart = (a: DemoSession, b: DemoSession) => a.start.getTime() - b.start.getTime()
  candidates.filter((c) => c.source === 'captura-real').sort(byStart).forEach(place)
  candidates.filter((c) => c.source === 'sintetica').sort(byStart).forEach(place)
  return accepted.sort(byStart)
}

export type TelemetrySample = { at: Date; payload: Record<string, unknown> }

const BASE = {
  demo: true,
  chargeMaxPower: 7,
  currentLimit: 0,
  ensureMinimumChargingPower: 0,
  finishTime: '0',
  maxEnergy: 0,
  minEnergy: 0,
  scheduleChargeMaxPower: 0,
  scheduleFinishTime: '0',
  scheduleMaxEnergy: 100,
  scheduleMinEnergy: 100,
  scheduleSOC: 99,
  chargeFromGrid: 0,
  chargeMode: 0,
  scheduleChargeMode: 2,
  scheduleMode: 0,
  scheduleTotalMinute: 60,
  unit: 0,
  mileage: 5.0,
}

/**
 * O que o coletor teria gravado a cada `stepMin`: carregando durante a sessão, "plugado sem
 * carregar" durante a ociosidade e "cabo fora" no resto. `demo: true` marca o que é seed.
 */
export function telemetry(sessions: DemoSession[], from: Date, to: Date, stepMin = 5): TelemetrySample[] {
  const sorted = [...sessions].sort((a, b) => a.start.getTime() - b.start.getTime())
  const out: TelemetrySample[] = []
  let i = 0
  for (let t = from.getTime(); t <= to.getTime(); t += stepMin * MIN_MS) {
    while (i < sorted.length && sorted[i]!.end.getTime() + sorted[i]!.idleMin * MIN_MS < t) i++
    const s = sorted[i]
    const at = new Date(t)
    if (s && t >= s.start.getTime() && t <= s.end.getTime()) {
      const avgKw = s.kwh / (s.min / 60)
      const progress = (t - s.start.getTime()) / (s.end.getTime() - s.start.getTime())
      const socStart = 20 + (s.serial.charCodeAt(s.serial.length - 1) % 20)
      out.push({
        at,
        payload: {
          ...BASE,
          chargedNow: Math.round(s.kwh * progress * 1000),
          dynamicLoad: round2(avgKw),
          lockChargingPlug: 1,
          phaseSwitch: 170,
          soc: Math.min(97, Math.round(socStart + progress * (s.kwh / 0.6))),
          status: 'charging',
          workState: 'charging',
          startStatus: true,
        },
      })
    } else if (s && t > s.end.getTime()) {
      out.push({
        at,
        payload: {
          ...BASE,
          chargedNow: 0,
          dynamicLoad: 0,
          lockChargingPlug: 1,
          phaseSwitch: 0,
          soc: Math.min(97, Math.round(20 + (s.serial.charCodeAt(s.serial.length - 1) % 20) + s.kwh / 0.6)),
          status: 'available',
          workState: 'available_gun_insered',
          startStatus: false,
        },
      })
    } else {
      out.push({
        at,
        payload: {
          ...BASE,
          chargedNow: 0,
          dynamicLoad: 0,
          lockChargingPlug: 0,
          phaseSwitch: 0,
          soc: 0,
          status: 'available',
          workState: 'available_gun_no_insered',
          startStatus: false,
        },
      })
    }
  }
  return out
}

/** Item do `queryChargeLogList` da SEMS, como o coletor salvaria. */
export function chargeLogPayload(s: DemoSession) {
  return {
    demo: true,
    chargeStartTime: semsLocal(s.start),
    chargeEndTime: semsLocal(s.end),
    chargePileSN: DEVICE_SN,
    chargeSerialNumber: s.serial,
    currentChargeQuantity: s.kwh,
    greenElec: s.greenKwh,
    purElec: round2(Math.max(0, s.kwh - s.greenKwh)),
    chargeTimeLength: s.min,
    mileage: s.km,
    unit: 'km',
    chargeCardNumber: s.cardNumber,
    chargeEndCause: 'normal_stop',
    charGun: 1,
    chargeMuzzle: 1,
    chartUnit: 'kWh',
  }
}
