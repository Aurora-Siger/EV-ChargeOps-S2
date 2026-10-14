/**
 * Série de potência da SEMS+ (`timeSeriesData`, código `pEvChar`) e o que ela diz sobre a vaga.
 * Funções puras: sem banco, sem rede.
 *
 * Desde 19/09/2026 o `detail` da GoodWe devolve sempre "cabo fora", mesmo no meio de uma
 * recarga; a série de potência continuou certa. Ela mostra quando há carga, mas não quando o
 * carro está plugado parado (potência zero nos dois casos) nem o SOC.
 */
import { parseSemsLocal } from '../../../shared/time.js'

export type PowerPoint = { at: Date; kw: number }

type SeriesResponse = {
  xAxis?: { xAxi?: string }[]
  yAxis?: { code?: string; data?: (number | null)[] }[]
}

/** Pontos com valor (o fim da janela vem como `null`, ainda não medido). Horário local → UTC. */
export function parsePowerSeries(resp: unknown): PowerPoint[] {
  const r = (resp ?? {}) as SeriesResponse
  const data = r.yAxis?.find((y) => y.code === 'pEvChar')?.data ?? []
  const points: PowerPoint[] = []
  ;(r.xAxis ?? []).forEach((x, i) => {
    const at = parseSemsLocal(x.xAxi)
    const kw = data[i]
    if (at && typeof kw === 'number' && Number.isFinite(kw)) points.push({ at, kw })
  })
  return points
}

/** Passo da série. A GoodWe só devolve valores quando a janela começa num múltiplo dele: com
 * segundos quebrados (ex. 07:43:51) ela responde só as duas pontas, ambas `null`. */
export const POWER_STEP_MS = 5 * 60_000

/** Arredonda para baixo até o passo da série (o fuso de Brasília é múltiplo de 5 min). */
export function alignToPowerStep(d: Date): Date {
  return new Date(Math.floor(d.getTime() / POWER_STEP_MS) * POWER_STEP_MS)
}

/** Ponto mais novo que isso não conta como "agora": a série chega com alguns minutos de atraso. */
export const POWER_FRESH_MS = 20 * 60_000

/** Está carregando agora pela série de potência? `null` quando não há ponto recente. */
export function chargingFromPower(latest: PowerPoint | null, now: Date): boolean | null {
  if (!latest || now.getTime() - latest.at.getTime() > POWER_FRESH_MS) return null
  return latest.kw > 0
}

/** Sessão em andamento, como o app SEMS+ mostra: tempo, energia, autonomia ganha e potência de agora. */
export type LiveSession = { minutes: number; kwh: number; km: number; powerKw: number | null; cardNumber: string | null }

export type LiveTelemetry = {
  status: string
  workState: string
  soc: number | null
  collectedAt: string
  session: LiveSession | null
}

type LastChargePayload = {
  chargeLog?: {
    currentChargeQuantity?: number | null
    chargeTimeLength?: number | null
    mileage?: number | null
    averCharP?: number | null
    chargeStartTime?: string
    chargeEndTime?: string
    chargeCardNumber?: string | null
  }
}

/**
 * Sessão em andamento a partir do último `getLastCharge`. Só vale se ele ainda é a sessão de
 * agora (sem fim, ou fim de poucos minutos atrás); senão seria a carga anterior.
 */
export function sessionFromLastCharge(
  lastCharge: { payload: unknown } | null,
  latestPower: PowerPoint | null,
  now: Date,
): LiveSession | null {
  const c = (lastCharge?.payload as LastChargePayload | undefined)?.chargeLog
  if (!c || typeof c.currentChargeQuantity !== 'number') return null
  const end = parseSemsLocal(c.chargeEndTime)
  if (end && now.getTime() - end.getTime() > POWER_FRESH_MS) return null
  const start = parseSemsLocal(c.chargeStartTime)
  const minutes = c.chargeTimeLength ?? (start ? Math.round((now.getTime() - start.getTime()) / 60_000) : null)
  if (minutes === null || minutes < 0) return null
  const fresh = chargingFromPower(latestPower, now) !== null
  return {
    minutes,
    kwh: c.currentChargeQuantity,
    km: c.mileage ?? 0,
    powerKw: fresh ? latestPower!.kw : (c.averCharP ?? null),
    cardNumber: c.chargeCardNumber || null,
  }
}

/**
 * Estado ao vivo a partir do último `detail` e do último ponto de potência. Quando o `detail`
 * não diz que está carregando mas a potência diz, vale a potência; o SOC desse `detail` não é
 * confiável nesse caso e vira `null`, para ninguém agendar achando que a bateria está vazia.
 */
/**
 * Estado da conexão com o carro pelo `vehConnStu` do `detail`: 0 = cabo fora, 1 = plugado sem
 * carregar, 2 = carregando. Desde 19/09/2026 o `workState` desse carregador fica parado em
 * "cabo fora", mas o `vehConnStu` segue mudando (conferido em 13/10: 2 durante a recarga, 1 da
 * 1h24 às 8h30 com o carro ainda plugado, 0 depois). Fora desses valores, `null`.
 */
export function workStateFromConn(vehConnStu: unknown): 'charging' | 'available_gun_insered' | 'available_gun_no_insered' | null {
  if (vehConnStu === 2) return 'charging'
  if (vehConnStu === 1) return 'available_gun_insered'
  if (vehConnStu === 0) return 'available_gun_no_insered'
  return null
}

export function liveFromTelemetry(
  detail: { payload: unknown; collectedAt: Date } | null,
  latestPower: PowerPoint | null,
  now: Date,
  lastCharge: { payload: unknown } | null = null,
): LiveTelemetry | null {
  const p = (detail?.payload ?? {}) as { status?: string; workState?: string; soc?: number; vehConnStu?: unknown }
  const conn = workStateFromConn(p.vehConnStu)
  // `vehConnStu` vale mais que o `workState` parado; o SOC desse `detail` parado também não vale.
  const frozen = conn !== null && conn !== p.workState
  const fromDetail: LiveTelemetry | null = detail
    ? {
        status: conn === 'charging' ? 'charging' : conn ? 'available' : (p.status ?? 'unknown'),
        workState: conn ?? p.workState ?? 'unknown',
        soc: typeof p.soc === 'number' && !frozen ? p.soc : null,
        collectedAt: detail.collectedAt.toISOString(),
        session: null,
      }
    : null
  const detailCharging = fromDetail?.status === 'charging' || fromDetail?.workState === 'charging'
  if (!detailCharging && chargingFromPower(latestPower, now)) {
    return {
      status: 'charging',
      workState: 'charging',
      soc: null,
      collectedAt: latestPower!.at.toISOString(),
      session: sessionFromLastCharge(lastCharge, latestPower, now),
    }
  }
  if (fromDetail && detailCharging) fromDetail.session = sessionFromLastCharge(lastCharge, latestPower, now)
  return fromDetail
}
