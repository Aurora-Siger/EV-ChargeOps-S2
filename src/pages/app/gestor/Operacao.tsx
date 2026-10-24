import { Fragment, useState } from 'react'
import ChargerStatus from '../../../components/ChargerStatus'
import { fmtBRL, fmtDay, fmtKwh, fmtMult, fmtTime, LEVEL_LABEL, WEEKDAYS } from '../../../lib/format'
import { api } from '../../../lib/http'
import type { AdminUser, Demand, Forecast, Session } from '../../../lib/types'
import { useApi } from '../../../lib/useApi'
import { I } from '../icons'
import { Empty, ErrorBox, Loading, PlateChip } from '../ui'
import { useAction } from '../../../lib/useAction'

function heatColor(v: number) {
  if (v < 0.05) return 'rgb(var(--ink) / 0.045)'
  return `rgba(232, 24, 90, ${0.1 + v * 0.85})`
}

function Heatmap() {
  const [mode, setMode] = useState<'predicted' | 'observed'>('predicted')
  const { data, error, loading } = useApi<Demand>('/api/admin/demand')
  const forecast = useApi<Forecast>('/api/pricing/forecast?hoursAhead=24')
  if (loading && !data) return <Loading what="Montando a matriz de demanda" />
  if (error) return <ErrorBox error={error} />
  if (!data) return null
  const matrix = data[mode]

  return (
    <div className="c">
      <div className="c-label row-between">
        Matriz de demanda · 24×7
        <span className="seg">
          <button className={mode === 'predicted' ? 'on' : ''} onClick={() => setMode('predicted')}>
            prevista (tarifa)
          </button>
          <button className={mode === 'observed' ? 'on' : ''} onClick={() => setMode('observed')}>
            observada
          </button>
        </span>
      </div>
      {data.sessions === 0 ? (
        <Empty>Sem sessões registradas ainda: toda hora cobra a tarifa base (mult 1,0×).</Empty>
      ) : (
        <>
          <div className="heat-scroll">
            <div className="heatmap">
              <span />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="hm-label">
                  {h % 4 === 0 ? String(h).padStart(2, '0') : ''}
                </span>
              ))}
              {matrix.map((row, d) => (
                <Fragment key={d}>
                  <span className="hm-label">{WEEKDAYS[d]}</span>
                  {row.map((v, h) => (
                    <div
                      key={h}
                      className="hm-cell"
                      style={{ background: heatColor(v) }}
                      title={`${WEEKDAYS[d]} ${String(h).padStart(2, '0')}h · demanda ${Math.round(v * 100)}% · mult ${(0.5 + v).toFixed(2)}×`}
                    />
                  ))}
                </Fragment>
              ))}
            </div>
          </div>
          <div className="heat-legend">
            <span>
              <span className="sw" style={{ background: 'rgb(var(--ink) / 0.045)' }} />
              livre (0,5×)
            </span>
            <span>
              <span className="sw" style={{ background: 'rgba(232,24,90,0.5)' }} />
              média (1,0×)
            </span>
            <span>
              <span className="sw" style={{ background: 'rgba(232,24,90,0.95)' }} />
              lotado (1,5×)
            </span>
          </div>
          <div className="hint-line">
            {mode === 'predicted'
              ? 'Regressão linear sobre o mesmo slot nas últimas 4 semanas (mult = 0,5 + demanda). É o que vira tarifa.'
              : 'Fração média de cada hora com carro carregando nas últimas 4 semanas.'}
          </div>
        </>
      )}
      <div className="hint-line">
        Modelo de IA (shadow):{' '}
        {forecast.data?.available && forecast.data.cheapest_at
          ? `prevê o horário mais barato das próximas 24h em ${fmtDay(forecast.data.cheapest_at)} às ${fmtTime(forecast.data.cheapest_at)} (${forecast.data.model_version}). Só comparação: não decide preço.`
          : (forecast.data?.reason ?? 'consultando…')}
      </div>
    </div>
  )
}

function Sessions({ period }: { period: string }) {
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const sessions = useApi<Session[]>(`/api/admin/sessions?period=${period}${onlyUnassigned ? '&unassigned=1' : ''}`)
  const users = useApi<AdminUser[]>('/api/admin/users')
  const act = useAction()
  const [synced, setSynced] = useState<string | null>(null)

  // placa do carro dono do cartão — deixa o gestor casar visualmente cartão físico → morador →
  // carro numa atribuição manual, mesmo antes de a sessão estar atribuída.
  const plateByCard = new Map<string, string>()
  for (const u of users.data ?? []) {
    const plate = u.vehicles[0]?.plate
    if (!plate) continue
    for (const c of u.cards) plateByCard.set(c.cardNumber, plate)
  }

  const assign = (id: string, userId: string) =>
    act.run(async () => {
      await api(`/api/admin/sessions/${id}`, { method: 'PATCH', json: { userId: userId || null } })
      sessions.reload()
    })

  const sync = () =>
    act.run(async () => {
      const r = await api<{ imported: number; priced: number }>('/api/admin/sessions/sync', { method: 'POST' })
      setSynced(`${r.imported} sessões lidas da SEMS, ${r.priced} recalculadas.`)
      sessions.reload()
    })

  return (
    <div className="c">
      <div className="c-label row-between">
        Sessões do mês
        <span className="row-actions">
          <label className="check-lbl">
            <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} /> só sem
            morador
          </label>
          <button className="btn btn-ghost btn-sm" onClick={sync} disabled={act.busy}>
            Sincronizar SEMS
          </button>
        </span>
      </div>
      {synced && <div className="hint-line">{synced}</div>}
      {act.error && <div className="login-error">{act.error}</div>}
      {sessions.loading && !sessions.data && <Loading />}
      {sessions.error && <ErrorBox error={sessions.error} onRetry={sessions.reload} />}
      {sessions.data?.length === 0 && <Empty>Nenhuma sessão neste mês.</Empty>}
      {sessions.data?.map((s) => (
        <div className="act wrap" key={s.id}>
          <div className="ic">{I.bolt}</div>
          <div className="info">
            <div className="t">
              {fmtDay(s.startedAt)} · {fmtTime(s.startedAt)}
              {s.endedAt && ` – ${fmtTime(s.endedAt)}`} · {fmtKwh(s.energyKwh)}
            </div>
            <div className="s">
              {s.mult !== null && `mult ${fmtMult(s.mult)} · `}
              {s.chargedCents !== null ? fmtBRL(s.chargedCents) : 'sem tarifa'}
              {s.cardNumber && ` · cartão …${s.cardNumber.slice(-4)}`}
              {s.assignedManually && ' · atribuída à mão'}
              {s.cardNumber && plateByCard.has(s.cardNumber) && <PlateChip plate={plateByCard.get(s.cardNumber)!} />}
            </div>
          </div>
          {s.level && <span className={`ptag ${s.level}`}>{LEVEL_LABEL[s.level]}</span>}
          <select
            className="inline-select"
            value={s.userId ?? ''}
            disabled={act.busy || !users.data}
            onChange={(e) => assign(s.id, e.target.value)}
            aria-label="Morador da sessão"
          >
            <option value="">— sem morador —</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unitLabel ? `${u.unitLabel} · ` : ''}
                {u.name}
                {u.kind === 'CONVIDADO' ? ' (convidado)' : ''}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}

export default function Operacao({ period }: { period: string }) {
  return (
    <>
      <ChargerStatus />
      <Heatmap />
      <Sessions period={period} />
    </>
  )
}
