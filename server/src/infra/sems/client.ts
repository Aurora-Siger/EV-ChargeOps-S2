import { env } from '../../config/env.js'

/**
 * Cliente da API interna SEMS+ (GoodWe) — us-gateway.semsportal.com.
 *
 * Autenticação: headers `token` (JSON com uid/token/timestamp) e `X-Signature`,
 * capturados por um login headless (ver ./login.ts). Anti-corruption layer: o
 * resto do sistema nunca vê o formato bruto da API da GoodWe.
 */

export class SemsAuthError extends Error {}

type Credentials = { token: string; signature: string }

let credentials: Credentials | null = null

export function setCredentials(token: string, signature: string): void {
  credentials = { token, signature }
}

export function isConfigured(): boolean {
  return credentials !== null
}

function headers(): Record<string, string> {
  if (!credentials) throw new SemsAuthError('SEMS token/signature não configurados')
  return {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    Origin: 'https://semsplus.goodwe.com',
    Referer: 'https://semsplus.goodwe.com/',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    currentLang: 'pt',
    neutral: '0',
    token: credentials.token,
    'X-Signature': credentials.signature,
  }
}

async function request<T = unknown>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${env.SEMS_GATEWAY}${path}`, {
    method,
    headers: headers(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`SEMS gateway ${res.status} em ${path}`)
  const data = (await res.json()) as { code?: string | number; translationCode?: string; errorMsg?: string; data?: T }
  const code = data.code
  if (code !== '00000' && code !== 0 && code !== '0' && code !== undefined && code !== null) {
    if (data.translationCode === 'account_login_abnormal' || code === 'C0602') {
      throw new SemsAuthError(`token rejeitado: ${code}`)
    }
    throw new Error(`SEMS erro ${code}: ${data.errorMsg}`)
  }
  return (data.data ?? (data as unknown)) as T
}

/** Status em tempo real do carregador. */
const detail = () =>
  request('POST', '/web/sems/sems-remote/api/ev-charger/detail', { sn: env.SEMS_SN, productModel: env.SEMS_PRODUCT_MODEL })

const lastCharge = () =>
  request('GET', `/web/sems/sems-plant/api/v1/chargePile/getLastCharge?chargeSn=${env.SEMS_SN}&pwId=${env.SEMS_STATION_ID}`)

type ChargeLogResponse = { dataList?: Record<string, unknown>[] }

const chargeLog = (start: string, end: string, page = 1, size = 50) =>
  request<ChargeLogResponse>('POST', '/web/sems/sems-plant/api/v1/chargePile/queryChargeLogList', {
    sn: env.SEMS_SN, startTime: start, endTime: end, pageNum: page, pageSize: size,
  })

const capabilities = () =>
  request('GET', `/web/sems/sems-remote/api/ev-charger/control-item-content-list/${env.SEMS_SN}`)

/** Specs adicionais do dispositivo (data de instalação, nº de portas). */
const deviceInformation = () =>
  request(
    'GET',
    `/web/sems/sems-plant/api/equipments/${env.SEMS_SN}/information?deviceType=EV_CHARGER&pwId=${env.SEMS_STATION_ID}`,
  )

/** Dados da usina: nome, endereço real, coordenadas, potência instalada. */
const stationInfo = () =>
  request('GET', `/web/sems/sems-plant/api/portal/stations/basic/info?stationId=${env.SEMS_STATION_ID}`)

const alarmCount = () => request('POST', '/web/sems/sems-alarm/api/alarm/count')

/** Série temporal real de potência (pEvChar, kW) a cada 5 min. */
const timeSeries = (start: string, end: string) =>
  request('POST', `/web/sems/sems-plant/api/portal/equipments/${env.SEMS_SN}/timeSeriesData`, {
    sn: env.SEMS_SN,
    deviceType: 'EV_CHARGER',
    stationId: env.SEMS_STATION_ID,
    startDateTime: start,
    endDateTime: end,
    group: 'operation_area',
    module: 'chart',
    timeGranularity: '1',
  })

export const semsGatewayClient = {
  detail, lastCharge, chargeLog, capabilities, deviceInformation, stationInfo, alarmCount, timeSeries,
}
