import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import chargingPile from '../assets/charging-pile.png'
import { STATUS_LABEL, WORK_STATE_LABEL, fmtMinutes } from '../lib/semsDevice'
import { fmtNum } from '../lib/format'
import { t } from '../lib/i18n'
import { fetchPowerSeries, useDeviceData, type LastCharge, type PowerPoint } from '../lib/api'

const PAGE = 3

/** "2026-09-01 21:22:44" → "01/09/2026 21:22:44" */
function fmtStamp(s: string) {
  const m = s.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}(?::\d{2})?)/)
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : s
}

/** minutos desde 00:00 de um "YYYY-MM-DD HH:MM:SS" */
function minutesOf(s: string) {
  const m = s.match(/(\d{2}):(\d{2})/)
  return m ? +m[1] * 60 + +m[2] : 0
}

function fmtClock(totalMin: number) {
  const h = Math.floor((totalMin + 1440) % 1440 / 60)
  const m = Math.round((totalMin + 1440) % 1440 % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Potência ao longo da sessão, reconstruída da média/pico reais quando a SEMS não devolve
 * a série temporal (timeSeriesData) da sessão:
 * AC segura perto do pico e decai no fim, o desenho clássico de uma carga AC.
 */
function powerCurve(avg: number, max: number, startMin: number, endMin: number, points = 40) {
  const hold = Math.max(0.15, Math.min(0.9, (2 * avg) / max - 1 + 0.35))
  const raw = Array.from({ length: points }, (_, i) => {
    const t = i / (points - 1)
    if (t < hold) return 1
    const k = (t - hold) / (1 - hold)
    return Math.max(0.04, Math.exp(-3.2 * k))
  })
  const mean = raw.reduce((s, v) => s + v, 0) / points
  const scale = Math.min(1, avg / (mean * max))
  const span = endMin - startMin || 1
  return raw.map((v, i) => ({
    tempo: fmtClock(startMin + (i / (points - 1)) * span),
    kw: +(v * max * scale).toFixed(2),
  }))
}

function PowerTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <div className="ct-label">{label}</div>
      <div className="ct-row">
        <span className="ct-dot" style={{ background: '#fbbf24' }} />
        potência <b>{payload[0].value.toFixed(2)} kW</b>
      </div>
    </div>
  )
}

/** Card do equipamento no painel do gestor, alimentado pela SEMS+ via server/ */
export default function ChargerStatus() {
  const { device, chargeLog, live, loading } = useDeviceData()
  const [page, setPage] = useState(0)

  if (loading && !device) {
    return <div className="dev-card empty-card">Carregando telemetria do carregador…</div>
  }
  if (!device) {
    return (
      <div className="dev-card empty-card">
        <b>{t('Sem telemetria do carregador ainda.', 'No charger telemetry yet.')}</b>{' '}
        {t('O coletor da SEMS+ não salvou nenhum snapshot — confira o login da SEMS no servidor', 'The SEMS+ collector has not saved any snapshot — check the SEMS login on the server')}{' '}
        (<code>/api/sems-proxy?path=/api/health</code>).
      </div>
    )
  }

  const pages = Math.max(1, Math.ceil(chargeLog.length / PAGE))
  const rows = chargeLog.slice(page * PAGE, page * PAGE + PAGE)
  // Origem da energia: só sessões reais (sem as de demonstração) dos últimos 7 dias.
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const lastWeek = chargeLog.filter((c) => !c.demo && c.at.getTime() >= weekAgo)
  const green = lastWeek.reduce((s, c) => s + c.green, 0)
  const grid = lastWeek.reduce((s, c) => s + c.grid, 0)
  const greenPct = green + grid > 0 ? Math.round((green / (green + grid)) * 100) : null
  const status = device.status ?? 'offline'

  return (
    <div className="dev-card">
      <div className="dev-top">
        <div className="dev-photo">
          <img src={chargingPile} alt="GoodWe HCA G2 charger" />
        </div>

        <div className="dev-head">
          <span className={`dev-live ${live ? '' : 'off'}`}>
            <span className="dot" />{' '}
            {live
              ? t('ao vivo', 'live')
              : device.collectedAt
                ? `${t('última coleta', 'last sample')} ${fmtStamp(device.collectedAt.replace('T', ' '))}`
                : t('sem coleta', 'no samples')}
          </span>
          <h3>GoodWe HCA G2</h3>
          <div className="dev-sub">
            {[device.productModel, device.ratedPower && `${device.ratedPower} kW ${t('nominais', 'rated')}`, device.pileGeneration && `${t('geração', 'generation')} ${device.pileGeneration}`]
              .filter(Boolean)
              .join(' · ') || t('specs ainda não coletadas', 'specs not collected yet')}
          </div>
          {device.sn && <div className="dev-sn">SN {device.sn}</div>}
          {device.local && <div className="dev-local">{device.local}</div>}

          <div className="dev-state">
            <span className={`ptag ${status === 'fault' ? 'peak' : status === 'charging' ? 'mid' : 'cheap'}`}>
              {STATUS_LABEL[status] ?? status}
            </span>
            {device.workState && <span className="dev-work">{WORK_STATE_LABEL[device.workState] ?? device.workState}</span>}
          </div>
        </div>

        <div className="dev-grid">
          <div>
            <span className="k">{t('Potência máx.', 'Max power')}</span>
            <span className="v">{device.chargeMaxPower !== null ? `${device.chargeMaxPower} kW` : '—'}</span>
          </div>
          <div>
            <span className="k">{t('SOC do carro', 'Car SOC')}</span>
            <span className="v">{device.soc ? `${device.soc}%` : '—'}</span>
          </div>
          <div>
            <span className="k">{t('Próx. agendamento', 'Next schedule')}</span>
            <span className="v">{device.scheduleTime?.slice(11, 16) || '—'}</span>
          </div>
          <div>
            <span className="k">{t('Carga dinâmica', 'Dynamic load')}</span>
            <span className="v">{device.dynamicLoad ? t('ativa', 'on') : t('inativa', 'off')}</span>
          </div>
        </div>
      </div>

      {device.lastCharge && <LastChargeBlock lc={device.lastCharge} />}

      {greenPct !== null && (
        <div className="dev-green">
          <div className="dev-green-head">
            <span>{t('Origem da energia nos últimos 7 dias', 'Energy source over the last 7 days')} · {lastWeek.length} {lastWeek.length === 1 ? t('sessão', 'session') : t('sessões', 'sessions')}</span>
            <b>{greenPct}% {t('solar', 'solar')}</b>
          </div>
          <div className="dev-green-bar">
            <div className="fill" style={{ width: `${greenPct}%` }} />
          </div>
          <div className="dev-green-legend">
            <span>
              <i className="g" /> {t('Solar', 'Solar')} {fmtNum(green, 1)} kWh
            </span>
            <span>
              <i className="r" /> {t('Rede', 'Grid')} {fmtNum(grid, 2)} kWh
            </span>
          </div>
        </div>
      )}

      <div className="dev-sessions">
        <div className="dev-sessions-head">
          <span className="dev-block-label">{t('Sessões coletadas do carregador', 'Sessions collected from the charger')}</span>
          {pages > 1 && (
            <span className="dev-pager">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label={t('Anteriores', 'Previous')}>
                ‹
              </button>
              {page + 1}/{pages}
              <button
                onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                disabled={page === pages - 1}
                aria-label={t('Próximas', 'Next')}
              >
                ›
              </button>
            </span>
          )}
        </div>
        {rows.length === 0 && <div className="empty-inline">{t('Nenhuma sessão coletada ainda.', 'No sessions collected yet.')}</div>}
        {rows.map((c) => (
          <div className="act" key={c.start}>
            <div className="info">
              <div className="t">
                {c.start} → {c.end}
              </div>
              <div className="s">
                {fmtMinutes(c.min)} {t('plugado', 'plugged in')} · {c.km.toFixed(0)} km {t('de autonomia', 'of range')}
              </div>
            </div>
            <span className={`ptag ${c.grid < 0.1 ? 'cheap' : 'mid'}`} style={{ marginRight: 10 }}>
              {c.green + c.grid === 0
                ? t('sem energia', 'no energy')
                : c.grid < 0.1
                  ? t('100% solar', '100% solar')
                  : `${Math.round((c.green / (c.green + c.grid)) * 100)}% ${t('solar', 'solar')}`}
            </span>
            <div className="val">{fmtNum(c.kwh, 2)} kWh</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Último carregamento, no formato do SEMS+, com a série real de potência quando existir. */
function LastChargeBlock({ lc }: { lc: LastCharge }) {
  const [realCurve, setRealCurve] = useState<PowerPoint[] | null>(null)

  useEffect(() => {
    if (!lc.start || !lc.end) return
    let stop = false
    fetchPowerSeries(lc.start, lc.end).then((series) => {
      if (!stop) setRealCurve(series)
    })
    return () => {
      stop = true
    }
  }, [lc.start, lc.end])

  const estimatedCurve = useMemo(
    () =>
      lc.start && lc.maxCharP > 0
        ? powerCurve(lc.averCharP, lc.maxCharP, minutesOf(lc.start), minutesOf(lc.start) + lc.chargeTimeLength)
        : [],
    [lc.averCharP, lc.maxCharP, lc.start, lc.chargeTimeLength],
  )
  const isEstimated = !realCurve
  const curve = realCurve?.map((p) => ({ tempo: p.time, kw: p.kw })) ?? estimatedCurve

  return (
    <div className="last-charge">
      <div className="lc-cols">
        <div>
          <div className="lc-head">{t('Último carregamento', 'Last charge')}</div>
          <div className="lc-duration">
            {Math.floor(lc.chargeTimeLength / 60)}
            <small>h</small> {lc.chargeTimeLength % 60}
            <small>min</small>
          </div>
          {lc.start && lc.end && (
            <div className="lc-period">
              {fmtStamp(lc.start)} – {fmtStamp(lc.end)}
            </div>
          )}
        </div>

        <div>
          <div className="lc-stats">
            <div>
              <span className="v">{fmtNum(lc.currentChargeQuantity, 2)}</span>
              <span className="k">kWh</span>
            </div>
            <div>
              <span className="v">{fmtNum(lc.mileage, 2)}</span>
              <span className="k">km</span>
            </div>
            <div>
              <span className="v">{lc.gun ?? '—'}</span>
              <span className="k">{t('porta', 'gun')}</span>
            </div>
          </div>
          {lc.cardNumber && (
            <div className="lc-card-id">
              {t('ID do cartão', 'Card ID')} · <b>{lc.cardNumber}</b>
            </div>
          )}
        </div>
      </div>

      {curve.length > 0 && (
        <div className="lc-chart">
          <div className="lc-chart-head">
            <span>
              {t('Potência de carregamento', 'Charging power')}
              {isEstimated && (
                <>
                  {' '}
                  <span className="lc-chart-estimate" title={t('A SEMS não devolveu a série temporal desta sessão — a curva abaixo é reconstruída a partir do pico e da média reais.', 'SEMS did not return this session’s time series; the curve below is rebuilt from the real peak and average.')}>
                    ({t('estimado', 'estimated')})
                  </span>
                </>
              )}
            </span>
            <span className="lc-chart-max">
              {t('pico', 'peak')} {fmtNum(lc.maxCharP, 1)} kW · {t('média', 'average')} {fmtNum(lc.averCharP, 1)} kW
            </span>
          </div>
          <div className="lc-chart-bg">
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={curve} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradPower" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="tempo"
                  interval={Math.ceil(curve.length / 5) - 1}
                  tick={{ fill: '#8e95a6', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#8e95a6', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                  axisLine={false}
                  tickLine={false}
                  width={34}
                  tickFormatter={(v: number) => `${v}kW`}
                />
                <Tooltip content={<PowerTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.2)' }} />
                <Area type="monotone" dataKey="kw" stroke="#fbbf24" strokeWidth={2} fill="url(#gradPower)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
