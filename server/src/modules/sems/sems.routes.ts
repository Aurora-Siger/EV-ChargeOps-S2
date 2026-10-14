import { Hono } from 'hono'
import { env } from '../../config/env.js'
import { requireAuth } from '../../infra/auth/middleware.js'
import { semsGatewayClient } from '../../infra/sems/client.js'
import { semsState } from './sems.collector.js'
import { semsRepository } from './sems.repository.js'
import { semsService } from './sems.service.js'
import { requireWorkspaceAdmin, withWorkspace, type WorkspaceVars } from '../workspaces/workspace.middleware.js'

type SnapshotKind = 'detail' | 'last_charge' | 'capabilities' | 'device_info' | 'station_info' | 'alarm_count'

async function snapshotResponse(kind: SnapshotKind) {
  const snap = await semsRepository.latestSnapshot(kind)
  return snap ? { collected_at: snap.collectedAt.toISOString(), data: snap.payload } : null
}

/**
 * Telemetria do carregador para o front (`GET /api/sems-proxy?path=/api/xxx`,
 * consumido por src/lib/api.ts). Os dados vêm do Postgres (snapshots gravados
 * por sems.collector.ts) ou, para a série de potência, de uma chamada ao vivo
 * ao gateway SEMS+.
 *
 * Só para o gestor: o log bruto traz o número do cartão RFID de cada recarga, e a série de
 * potência consulta a SEMS+ com a conta do condomínio.
 */
const MAX_ROWS = 500
const limitOf = (v: string | null, fallback: number) => {
  const n = Number(v ?? fallback)
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_ROWS) : fallback
}

const gestor = new Hono<{ Variables: WorkspaceVars }>().use(requireAuth, withWorkspace, requireWorkspaceAdmin)

export const semsRoutes = gestor.get('/', async (c) => {
  const raw = c.req.query('path')
  if (!raw) return c.json({ error: 'path required' }, 400)
  const [pathname, qs] = raw.split('?')
  const query = new URLSearchParams(qs ?? '')

  try {
    switch (pathname) {
      case '/api/health':
        return c.json({
          device: { sn: env.SEMS_SN, stationId: env.SEMS_STATION_ID },
          token_ok: semsState.tokenOk,
          last_poll: semsState.lastPoll,
          last_login: semsState.lastLogin,
          captcha_blocked: semsState.captchaBlocked,
          last_error: semsState.lastError,
          poll_interval: env.SEMS_POLL_INTERVAL_MS / 1000,
        })

      case '/api/status':
      case '/api/last-charge':
      case '/api/capabilities':
      case '/api/device-info':
      case '/api/station-info':
      case '/api/alarm-count': {
        const kind: SnapshotKind = {
          '/api/status': 'detail',
          '/api/last-charge': 'last_charge',
          '/api/capabilities': 'capabilities',
          '/api/device-info': 'device_info',
          '/api/station-info': 'station_info',
          '/api/alarm-count': 'alarm_count',
        }[pathname] as SnapshotKind
        const snap = await snapshotResponse(kind)
        if (!snap) return c.json({ error: 'sem dados coletados ainda' }, 404)
        if (kind === 'detail') {
          // O `detail` da GoodWe congela em "cabo fora" no meio da recarga; o estado ao vivo
          // corrigido pela série de potência é o que o painel deve mostrar (ver domain/power.ts).
          const live = await semsService.live()
          const d = snap.data as { status?: string; workState?: string; soc?: number | null }
          if (live && live.status === 'charging' && d.status !== 'charging') {
            return c.json({
              collected_at: live.collectedAt,
              data: { ...d, status: live.status, workState: live.workState, soc: live.soc },
            })
          }
        }
        return c.json(snap)
      }

      case '/api/charge-log': {
        const limit = limitOf(query.get('limit'), 50)
        const rows = await semsRepository.chargeLog(limit)
        return c.json({ sessions: rows.map((r) => r.payload) })
      }

      case '/api/history': {
        const kind = (query.get('kind') ?? 'detail') as SnapshotKind
        const limit = limitOf(query.get('limit'), 288)
        const rows = await semsRepository.history(kind, limit)
        return c.json({ points: rows.map((r) => ({ collected_at: r.collectedAt.toISOString(), data: r.payload })) })
      }

      case '/api/power-series': {
        const start = query.get('start')
        const end = query.get('end')
        if (!start || !end) return c.json({ error: 'start e end são obrigatórios' }, 400)
        return c.json(await semsGatewayClient.timeSeries(start, end))
      }

      default:
        return c.json({ error: 'rota desconhecida' }, 404)
    }
  } catch (error) {
    console.error('SEMS route error:', error)
    return c.json({ error: 'Erro ao consultar SEMS' }, 500)
  }
})
