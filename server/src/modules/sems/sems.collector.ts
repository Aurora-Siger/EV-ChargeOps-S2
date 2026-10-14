import { env } from '../../config/env.js'
import { CaptchaRequiredError, loginHeadless } from '../../infra/sems/login.js'
import { isConfigured, semsGatewayClient, SemsAuthError, setCredentials } from '../../infra/sems/client.js'
import { formatSemsLocal, fromLocal, parseSemsLocal, toLocal } from '../../shared/time.js'
import { semsRepository } from './sems.repository.js'
import { alignToPowerStep, parsePowerSeries } from './domain/power.js'

/**
 * Coletor em background: faz login headless, consome o gateway SEMS+ a cada
 * SEMS_POLL_INTERVAL_MS e persiste em Postgres. A API sempre serve o último
 * snapshot salvo, mesmo se o token SEMS expirar entre um poll e outro.
 * Ciclo: login → poll → reautentica sozinho em SemsAuthError.
 */

type State = {
  tokenOk: boolean | null
  lastPoll: string | null
  lastError: string | null
  captchaBlocked: boolean
  lastLogin: string | null
}

export const semsState: State = { tokenOk: null, lastPoll: null, lastError: null, captchaBlocked: false, lastLogin: null }

let loginInFlight: Promise<boolean> | null = null

// Chamado depois de cada coleta bem-sucedida (main.ts registra a ingestão de sessões).
// Callback em vez de import direto para o coletor não depender do módulo de sessões.
const afterPoll: (() => Promise<unknown>)[] = []
export function onPollSuccess(cb: () => Promise<unknown>) {
  afterPoll.push(cb)
}
async function runAfterPoll() {
  for (const cb of afterPoll) {
    try {
      await cb()
    } catch (e) {
      console.error('Pós-coleta falhou:', e)
    }
  }
}

export async function relogin(): Promise<boolean> {
  if (loginInFlight) return loginInFlight
  loginInFlight = (async () => {
    try {
      const { token, signature } = await loginHeadless()
      setCredentials(token, signature)
      semsState.captchaBlocked = false
      semsState.lastLogin = new Date().toISOString()
      return true
    } catch (e) {
      if (e instanceof CaptchaRequiredError) {
        semsState.captchaBlocked = true
        semsState.lastError = e.message
      } else {
        semsState.lastError = `login: ${e instanceof Error ? e.constructor.name : 'Error'}: ${e instanceof Error ? e.message : e}`
      }
      return false
    }
  })()
  try {
    return await loginInFlight
  } finally {
    loginInFlight = null
  }
}

async function trySnapshot(
  kind: 'capabilities' | 'device_info' | 'station_info',
  fetcher: () => Promise<unknown>,
  warnings: string[],
) {
  if (await semsRepository.latestSnapshot(kind)) return
  try {
    await semsRepository.saveSnapshot(kind, await fetcher())
  } catch (e) {
    warnings.push(`${kind}: ${e instanceof Error ? e.message : e}`)
  }
}

/** Falhas em snapshots "uma vez só" (capabilities/device_info/station_info/alarm_count)
 * não interrompem o ciclo — mas precisam ser reportadas, não descartadas, senão
 * mascaram um erro real atrás de um /api/health que parece saudável. */
export async function pollOnce(): Promise<{ warnings: string[] }> {
  const warnings: string[] = []

  const detail = await semsGatewayClient.detail()
  await semsRepository.saveSnapshot('detail', detail)

  const last = await semsGatewayClient.lastCharge()
  await semsRepository.saveSnapshot('last_charge', last)

  // Specs do equipamento/usina não mudam: coleta só se ainda não tem nenhuma salva.
  await trySnapshot('capabilities', semsGatewayClient.capabilities, warnings)
  await trySnapshot('device_info', semsGatewayClient.deviceInformation, warnings)
  await trySnapshot('station_info', semsGatewayClient.stationInfo, warnings)

  try {
    await semsRepository.saveSnapshot('alarm_count', await semsGatewayClient.alarmCount())
  } catch (e) {
    warnings.push(`alarm_count: ${e instanceof Error ? e.message : e}`)
  }

  const end = new Date()
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000)
  const fmt = (d: Date, time: string) => `${d.toISOString().slice(0, 10)} ${time}`
  const log = await semsGatewayClient.chargeLog(fmt(start, '00:00:00'), fmt(end, '23:59:59'))
  const sessions = log.dataList ?? []
  await semsRepository.upsertChargeLogEntries(
    sessions.map((s) => ({
      serial: (s.chargeSerialNumber as string | undefined) ?? String(s.chargeStartTime),
      payload: s,
    })),
  )

  await collectPower(new Date(Date.now() - POWER_WINDOW_MS), new Date(), warnings)

  await runAfterPoll()
  return { warnings }
}

// ---------- Série de potência (pEvChar) ----------
// O `detail` congelou em "cabo fora" desde 19/09/2026; a série de potência continua certa e é
// a fonte de "está carregando" e de treino (ver domain/power.ts).

/** Janela relida a cada poll: cobre o atraso da série e um poll perdido. */
const POWER_WINDOW_MS = 2 * 60 * 60 * 1000
/** Quantos dias para trás a recuperação do histórico vai, no máximo. */
const POWER_BACKFILL_MAX_DAYS = 120

/** Pausa entre dias na recuperação e espera depois de um 429: a GoodWe limita chamadas seguidas. */
const POWER_BACKFILL_PAUSE_MS = 3_000
const POWER_RATE_LIMIT_WAIT_MS = 60_000
/** De quanto em quanto tempo a recuperação roda de novo (pega o dia de hoje e os dias que falharam). */
const POWER_BACKFILL_EVERY_MS = 60 * 60 * 1000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Grava a série da janela. Devolve a mensagem de erro, ou null se deu certo. */
async function collectPower(start: Date, end: Date, warnings: string[]): Promise<string | null> {
  try {
    const series = await semsGatewayClient.timeSeries(
      formatSemsLocal(alignToPowerStep(start)),
      formatSemsLocal(alignToPowerStep(end)),
    )
    await semsRepository.upsertPowerPoints(env.SEMS_SN, parsePowerSeries(series))
    return null
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    warnings.push(`power: ${msg}`)
    return msg
  }
}

/**
 * Recupera a série de potência dos dias que ainda não têm nenhum ponto, desde a primeira recarga
 * do log (até POWER_BACKFILL_MAX_DAYS). Hoje é sempre relido inteiro. Roda em segundo plano depois
 * de um poll que deu certo, na subida e de hora em hora, então um dia que falhou entra na próxima.
 */
export async function backfillPower(): Promise<{ days: number; warnings: string[] }> {
  const warnings: string[] = []
  const now = new Date()
  const today = toLocal(now)
  const have = await semsRepository.powerDays(env.SEMS_SN)
  const first = parseSemsLocal(await semsRepository.firstChargeStart())
  const oldest = fromLocal(today.year, today.month, today.day - POWER_BACKFILL_MAX_DAYS)
  const start = toLocal(first && first > oldest ? first : oldest)
  let days = 0
  for (let d = fromLocal(start.year, start.month, start.day); d <= now; ) {
    const p = toLocal(d)
    const next = fromLocal(p.year, p.month, p.day + 1)
    const isToday = p.year === today.year && p.month === today.month && p.day === today.day
    if (isToday || !have.has(formatSemsLocal(d).slice(0, 10))) {
      const dayEnd = new Date(Math.min(next.getTime() - 1000, now.getTime()))
      const error = await collectPower(d, dayEnd, warnings)
      if (error?.includes(' 429 ')) {
        await sleep(POWER_RATE_LIMIT_WAIT_MS)
        if (!(await collectPower(d, dayEnd, warnings))) warnings.pop()
      }
      days++
      await sleep(POWER_BACKFILL_PAUSE_MS)
    }
    d = next
  }
  return { days, warnings }
}

let backfillRunning = false
let lastBackfill = 0
function startBackfillIfDue() {
  if (backfillRunning || Date.now() - lastBackfill < POWER_BACKFILL_EVERY_MS) return
  backfillRunning = true
  lastBackfill = Date.now()
  void backfillPower()
    .then(({ days, warnings }) =>
      console.log(`Potência SEMS+: ${days} dia(s) recuperado(s)${warnings.length ? `; avisos: ${warnings.join('; ')}` : ''}`),
    )
    .catch((e) => console.error('Recuperação da potência SEMS+ falhou:', e))
    .finally(() => {
      backfillRunning = false
    })
}

async function tick(): Promise<void> {
  try {
    const { warnings } = await pollOnce()
    semsState.tokenOk = true
    semsState.lastError = warnings.length ? warnings.join('; ') : null
    startBackfillIfDue()
  } catch (e) {
    if (e instanceof SemsAuthError) {
      semsState.tokenOk = false
      semsState.lastError = e.message
      if (await relogin()) {
        try {
          const { warnings } = await pollOnce()
          semsState.tokenOk = true
          semsState.lastError = warnings.length ? warnings.join('; ') : null
        } catch (e2) {
          semsState.lastError = `${e2 instanceof Error ? e2.constructor.name : 'Error'}: ${e2 instanceof Error ? e2.message : e2}`
        }
      }
    } else {
      semsState.lastError = `${e instanceof Error ? e.constructor.name : 'Error'}: ${e instanceof Error ? e.message : e}`
    }
  }
  semsState.lastPoll = new Date().toISOString()
}

let stopped = false

export async function startCollector(): Promise<void> {
  if (!isConfigured()) await relogin()
  const loop = async () => {
    if (stopped) return
    await tick()
    if (!stopped) setTimeout(loop, env.SEMS_POLL_INTERVAL_MS)
  }
  void loop()
}

export function stopCollector(): void {
  stopped = true
}
