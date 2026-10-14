/**
 * Telemetria do carregador GoodWe HCA G2 via `server/` (`/api/sems-proxy?path=…`), que serve
 * o último snapshot coletado da SEMS+ pelo coletor (sems.collector.ts):
 *
 *   /api/health       → estado do coletor + SN
 *   /api/status       → ev-charger/detail (estado em tempo real)
 *   /api/last-charge  → getLastCharge (última sessão)
 *   /api/charge-log   → queryChargeLogList (histórico de sessões)
 *
 * Sem dado coletado, a tela mostra isso — não há mais captura estática de fallback.
 */

import { useEffect, useState } from 'react'
import { activeWorkspaceId } from './http'

const BASE = '/api/sems-proxy'
/** Snapshot mais velho que isso deixa de ser "ao vivo" (o coletor roda a cada 5 min). */
const LIVE_MAX_AGE_MS = 20 * 60_000

type StatusResp = {
  collected_at: string
  data: {
    chargeMaxPower?: number
    soc?: number
    mileage?: number
    dynamicLoad?: number
    scheduleTime?: string
    status?: string
    workState?: string
  }
}

type LastChargeResp = {
  data: {
    chargeLog?: {
      currentChargeQuantity: number | null
      chargeTimeLength: number | null
      mileage: number | null
      averCharP: number | null
      maxCharP: number | null
      chargeStartTime?: string
      chargeEndTime?: string
      chargeCardNumber?: string
      chargePileSN?: string
      charGun?: number
    }
  }
}

type ChargeLogResp = {
  sessions: {
    chargeStartTime: string
    chargeEndTime: string
    /** presente só nas sessões geradas pelo seed de demonstração */
    demo?: boolean
    currentChargeQuantity: number | null
    greenElec: number | null
    purElec: number | null
    chargeTimeLength: number | null
    mileage: number | null
  }[]
}

type CapabilitiesResp = { data: { productModel?: string; ratedPower?: number; pileGeneration?: string } }
type DeviceInfoResp = { data: { code: string; data?: string }[] }
type StationInfoResp = { data: { name?: string; googleAddress?: string } }
type HealthResp = { device?: { sn?: string } }

async function get<T>(path: string): Promise<T> {
  const ws = activeWorkspaceId()
  const res = await fetch(`${BASE}?path=${encodeURIComponent(path)}`, {
    credentials: 'same-origin',
    headers: ws ? { 'X-Workspace-Id': ws } : {},
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json()
}

const opt = <T,>(p: Promise<T>) => p.catch(() => null)

/** "2026-09-01 21:22:44.000" → "01/09 21:22" */
function fmtDate(s: string) {
  const m = s.match(/\d{4}-(\d{2})-(\d{2}) (\d{2}:\d{2})/)
  return m ? `${m[2]}/${m[1]} ${m[3]}` : s
}

export type LastCharge = {
  currentChargeQuantity: number
  chargeTimeLength: number
  mileage: number
  averCharP: number
  maxCharP: number
  start: string | null
  end: string | null
  cardNumber: string | null
  gun: number | null
}

export type DeviceData = {
  sn: string | null
  stationName: string | null
  local: string | null
  productModel: string | null
  ratedPower: number | null
  pileGeneration: string | null
  charGunNum: number | null
  status: string | null
  workState: string | null
  chargeMaxPower: number | null
  soc: number | null
  dynamicLoad: number | null
  scheduleTime: string | null
  collectedAt: string | null
  lastCharge: LastCharge | null
}

/** "2026-10-12 19:36:31.000" (horário de Brasília) → Date */
const semsLocalToDate = (s: string) => new Date(`${s.slice(0, 19).replace(' ', 'T')}-03:00`)

export type ChargeLogRow = { at: Date; demo: boolean; start: string; end: string; kwh: number; green: number; grid: number; min: number; km: number }

type PowerSeriesResp = {
  xAxis: { xAxi: string }[]
  yAxis: { code: string; data: (number | null)[] }[]
}

export type PowerPoint = { time: string; kw: number }

/** Série real de potência (kW) da sessão, direto do SEMS+. Retorna null se indisponível. */
export async function fetchPowerSeries(start: string, end: string): Promise<PowerPoint[] | null> {
  try {
    const path = `/api/power-series?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
    const res = await get<PowerSeriesResp>(path)
    const kws = res.yAxis.find((y) => y.code === 'pEvChar')?.data
    if (!kws || kws.length !== res.xAxis.length) return null
    return res.xAxis.map((x, i) => ({ time: x.xAxi.slice(11, 16), kw: kws[i] ?? 0 }))
  } catch {
    return null
  }
}

/** Estado do carregador. O status é re-consultado a cada 30s. */
export function useDeviceData() {
  const [device, setDevice] = useState<DeviceData | null>(null)
  const [chargeLog, setChargeLog] = useState<ChargeLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [checkedAt, setCheckedAt] = useState(0)

  useEffect(() => {
    let stop = false

    const pull = async (full: boolean) => {
      const [health, st, last, log, caps, info, station] = await Promise.all([
        full ? opt(get<HealthResp>('/api/health')) : null,
        opt(get<StatusResp>('/api/status')),
        full ? opt(get<LastChargeResp>('/api/last-charge')) : null,
        full ? opt(get<ChargeLogResp>('/api/charge-log')) : null,
        full ? opt(get<CapabilitiesResp>('/api/capabilities')) : null,
        full ? opt(get<DeviceInfoResp>('/api/device-info')) : null,
        full ? opt(get<StationInfoResp>('/api/station-info')) : null,
      ])
      if (stop) return
      setDevice((prev) => {
        const lc = last?.data.chargeLog
        const base: DeviceData = prev ?? {
          sn: null, stationName: null, local: null, productModel: null, ratedPower: null, pileGeneration: null,
          charGunNum: null, status: null, workState: null, chargeMaxPower: null, soc: null, dynamicLoad: null,
          scheduleTime: null, collectedAt: null, lastCharge: null,
        }
        const charGunNum = info?.data.find((f) => f.code === 'charGunNum')?.data
        const next: DeviceData = {
          ...base,
          ...(st && {
            status: st.data.status ?? null,
            workState: st.data.workState ?? null,
            chargeMaxPower: st.data.chargeMaxPower ?? null,
            soc: st.data.soc ?? null,
            dynamicLoad: st.data.dynamicLoad ?? null,
            scheduleTime: st.data.scheduleTime ?? null,
            collectedAt: st.collected_at,
          }),
          ...(full && {
            sn: lc?.chargePileSN ?? health?.device?.sn ?? base.sn,
            productModel: caps?.data.productModel ?? base.productModel,
            ratedPower: caps?.data.ratedPower ?? base.ratedPower,
            pileGeneration: caps?.data.pileGeneration ?? base.pileGeneration,
            local: station?.data.googleAddress ?? base.local,
            stationName: station?.data.name ?? base.stationName,
            charGunNum: charGunNum ? +charGunNum : base.charGunNum,
            lastCharge: lc
              ? {
                  currentChargeQuantity: lc.currentChargeQuantity ?? 0,
                  chargeTimeLength: lc.chargeTimeLength ?? 0,
                  mileage: lc.mileage ?? 0,
                  averCharP: +(lc.averCharP ?? 0).toFixed(1),
                  maxCharP: lc.maxCharP ?? 0,
                  start: lc.chargeStartTime ?? null,
                  end: lc.chargeEndTime ?? null,
                  cardNumber: lc.chargeCardNumber ?? null,
                  gun: lc.charGun ?? null,
                }
              : base.lastCharge,
          }),
        }
        const hasAny = next.collectedAt || next.lastCharge || next.productModel
        return hasAny ? next : null
      })
      if (log) {
        setChargeLog(
          log.sessions.map((s) => ({
            at: semsLocalToDate(s.chargeStartTime),
            demo: s.demo === true,
            start: fmtDate(s.chargeStartTime),
            end: fmtDate(s.chargeEndTime),
            kwh: s.currentChargeQuantity ?? 0,
            green: s.greenElec ?? 0,
            grid: s.purElec ?? 0,
            min: s.chargeTimeLength ?? 0,
            km: s.mileage ?? 0,
          })),
        )
      }
      setCheckedAt(Date.now())
      setLoading(false)
    }

    pull(true)
    const t = setInterval(() => pull(false), 30_000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [])

  const live = !!device?.collectedAt && checkedAt - new Date(device.collectedAt).getTime() < LIVE_MAX_AGE_MS
  return { device, chargeLog, live, loading }
}
