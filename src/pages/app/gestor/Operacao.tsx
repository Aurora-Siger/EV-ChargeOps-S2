import { Fragment, useState } from 'react'
import ChargerStatus from '../../../components/ChargerStatus'
import { csvDateTime, csvMoney, downloadCsv } from '../../../lib/csv'
import { fmtBRL, fmtDay, fmtKwh, fmtTime, LEVEL_LABEL, WEEKDAYS } from '../../../lib/format'
import { isEn, t } from '../../../lib/i18n'
import { api } from '../../../lib/http'
import type { AdminUser, Demand, Forecast, Session } from '../../../lib/types'
import { useApi } from '../../../lib/useApi'
import { I } from '../icons'
import { Empty, ErrorBox, Loading } from '../ui'
import { useAction } from '../../../lib/useAction'

function heatColor(v: number) {
  if (v < 0.05) return 'rgba(255,255,255,0.045)'
  return `rgba(232, 24, 90, ${0.1 + v * 0.85})`
}

export function Heatmap() {
  const [mode, setMode] = useState<'predicted' | 'observed'>('predicted')
  const { data, error, loading } = useApi<Demand>('/api/admin/demand')
  const forecast = useApi<Forecast>('/api/pricing/forecast?hoursAhead=24')
  if (loading && !data) return <Loading what={t('Montando a matriz de demanda', 'Building the demand matrix')} />
  if (error) return <ErrorBox error={error} />
  if (!data) return null
  const matrix = data[mode]

  return (
    <div className="c">
      <div className="c-label row-between">
        {t('Matriz de demanda', 'Demand matrix')} · 24×7
        <span className="seg">
          <button className={mode === 'predicted' ? 'on' : ''} onClick={() => setMode('predicted')}>
            {t('prevista (tarifa)', 'forecast (rate)')}
          </button>
          <button className={mode === 'observed' ? 'on' : ''} onClick={() => setMode('observed')}>
            {t('observada', 'observed')}
          </button>
        </span>
      </div>
      {data.sessions === 0 ? (
        <Empty>{t('Sem sessões registradas ainda: toda hora cobra a tarifa base (mult 1,0×).', 'No sessions recorded yet: every hour charges the base rate (multiplier 1.0×).')}</Empty>
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
                      title={`${WEEKDAYS[d]} ${String(h).padStart(2, '0')}h · ${t('demanda', 'demand')} ${Math.round(v * 100)}% · mult ${(0.5 + v).toFixed(2)}×`}
                    />
                  ))}
                </Fragment>
              ))}
            </div>
          </div>
          <div className="heat-legend">
            <span>
              <span className="sw" style={{ background: 'rgba(255,255,255,0.045)' }} />
              {t('livre (0,5×)', 'free (0.5×)')}
            </span>
            <span>
              <span className="sw" style={{ background: 'rgba(232,24,90,0.5)' }} />
              {t('média (1,0×)', 'average (1.0×)')}
            </span>
            <span>
              <span className="sw" style={{ background: 'rgba(232,24,90,0.95)' }} />
              {t('lotado (1,5×)', 'full (1.5×)')}
            </span>
          </div>
          <div className="hint-line">
            {mode === 'predicted'
              ? t('Regressão linear sobre o mesmo slot nas últimas 4 semanas (mult = 0,5 + demanda). É o que vira tarifa.', 'Linear regression over the same slot in the last 4 weeks (mult = 0.5 + demand). This is what becomes the rate.')
              : t('Fração média de cada hora com carro carregando nas últimas 4 semanas.', 'Average share of each hour with a car charging over the last 4 weeks.')}
          </div>
        </>
      )}
      <div className="hint-line">
        {t('Modelo de IA (shadow):', 'AI model (shadow):')}{' '}
        {forecast.data?.available && forecast.data.cheapest_at
          ? t(
              `prevê o horário mais barato das próximas 24h em ${fmtDay(forecast.data.cheapest_at)} às ${fmtTime(forecast.data.cheapest_at)} (${forecast.data.model_version}). Só comparação: não decide preço.`,
              `forecasts the cheapest hour in the next 24h: ${fmtDay(forecast.data.cheapest_at)} at ${fmtTime(forecast.data.cheapest_at)} (${forecast.data.model_version}). For comparison only: it does not set the price.`,
            )
          : (forecast.data?.reason ?? t('consultando…', 'checking…'))}
      </div>
    </div>
  )
}

export function Sessions({ period }: { period: string }) {
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const sessions = useApi<Session[]>(`/api/admin/sessions?period=${period}${onlyUnassigned ? '&unassigned=1' : ''}`)
  const users = useApi<AdminUser[]>('/api/admin/users')
  const act = useAction()

  const assign = (id: string, userId: string) =>
    act.run(async () => {
      await api(`/api/admin/sessions/${id}`, { method: 'PATCH', json: { userId: userId || null } })
      sessions.reload()
    })

  const exportCsv = () =>
    downloadCsv(
      `sessoes-${period}.csv`,
      isEn()
        ? ['Start', 'End', 'Unit', 'Resident', 'Card', 'Energy (kWh)', 'Duration (min)', 'Idle (min)', 'Multiplier', 'Energy cost (R$)', 'Amount charged (R$)']
        : ['Início', 'Fim', 'Unidade', 'Morador', 'Cartão', 'Energia (kWh)', 'Duração (min)', 'Ociosidade (min)', 'Multiplicador', 'Custo da energia (R$)', 'Valor cobrado (R$)'],
      (sessions.data ?? []).map((s) => [
        csvDateTime(s.startedAt),
        s.endedAt ? csvDateTime(s.endedAt) : null,
        s.unitLabel,
        s.userName,
        s.cardNumber,
        Number(s.energyKwh.toFixed(3)),
        s.durationMin,
        s.idleMin,
        s.mult,
        csvMoney(s.energyCostCents),
        csvMoney(s.chargedCents),
      ]),
    )

  return (
    <div className="c">
      <div className="ses-head">
        <div className="c-label" style={{ margin: 0 }}>
          {t('Sessões do mês', 'Sessions this month')}
        </div>
        <button className="btn btn-ghost btn-csv" onClick={exportCsv} disabled={!sessions.data?.length}>
          {I.download} {t('Exportar CSV', 'Export CSV')}
        </button>
      </div>
      <div className="seg ses-filter">
        <button className={!onlyUnassigned ? 'on' : ''} onClick={() => setOnlyUnassigned(false)}>
          {t('Todas', 'All')}
        </button>
        <button className={onlyUnassigned ? 'on' : ''} onClick={() => setOnlyUnassigned(true)}>
          {t('Sem morador', 'No resident')}
        </button>
      </div>
      {act.error && <div className="login-error">{act.error}</div>}
      {sessions.loading && !sessions.data && <Loading />}
      {sessions.error && <ErrorBox error={sessions.error} onRetry={sessions.reload} />}
      {sessions.data?.length === 0 && (
        <Empty>{onlyUnassigned ? t('Todas as sessões já têm morador.', 'All sessions already have a resident.') : t('Nenhuma sessão neste mês.', 'No sessions this month.')}</Empty>
      )}
      <div className="ses-list">
        {sessions.data?.map((s) => (
          <div className="ses-row" key={s.id}>
            <div className="ses-when">
              <b>
                {fmtDay(s.startedAt)} · {fmtTime(s.startedAt)}
                {s.endedAt ? ` – ${fmtTime(s.endedAt)}` : ` · ${t('carregando', 'charging')}`}
              </b>
              <span>
                {fmtKwh(s.energyKwh)}
                {s.chargedCents !== null && ` · ${fmtBRL(s.chargedCents)}`}
                {s.level && (
                  <span className={`ses-level ${s.level}`}>
                    <i />
                    {LEVEL_LABEL[s.level].toLowerCase()}
                  </span>
                )}
              </span>
            </div>
            <select
              className="ses-who"
              value={s.userId ?? ''}
              disabled={act.busy || !users.data}
              onChange={(e) => assign(s.id, e.target.value)}
              aria-label={t('Morador da sessão', 'Session resident')}
            >
              <option value="">{t('Sem morador', 'No resident')}</option>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unitLabel ? `${u.unitLabel} · ` : ''}
                  {u.name}
                  {u.kind === 'CONVIDADO' ? ` (${t('convidado', 'guest')})` : ''}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
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
