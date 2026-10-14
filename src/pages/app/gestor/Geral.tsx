import Volt from '../../../components/Volt'
import { fmtBRL, fmtKwh, fmtPct, monthName } from '../../../lib/format'
import type { Overview } from '../../../lib/types'
import { useApi } from '../../../lib/useApi'
import { I } from '../icons'
import { ErrorBox, Loading } from '../ui'

const TONE = {
  warn: { icon: I.bell, style: { color: 'var(--amber)', borderColor: 'var(--amber-b)', background: 'var(--amber-l)' } },
  info: { icon: I.bolt, style: undefined },
  ok: { icon: I.check2, style: { color: 'var(--green)', borderColor: 'var(--green-b)', background: 'var(--green-l)' } },
}

export default function Geral({ period }: { period: string }) {
  const { data: o, error, loading, reload } = useApi<Overview>(`/api/admin/overview?period=${period}`)
  if (loading && !o) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (!o) return null

  const delta = o.prevEnergyKwh > 0 ? (o.energyKwh - o.prevEnergyKwh) / o.prevEnergyKwh : null

  return (
    <>
      <div className="kpi2">
        <div className="kpi">
          <div className="k">Energia no mês</div>
          <div className="v">{fmtKwh(o.energyKwh, 0)}</div>
          <div className={`d ${delta !== null && delta > 0 ? 'up' : ''}`}>
            {delta === null ? `${o.sessionsCount} recargas` : `${delta >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(delta))} vs. mês anterior`}
          </div>
        </div>
        <div className="kpi">
          <div className="k">{o.closed ? 'Faturado' : 'Rateio parcial'}</div>
          <div className="v">{fmtBRL(o.billedCents)}</div>
          <div className="d">{o.closed ? `${o.openInvoices} em aberto` : 'ciclo ainda aberto'}</div>
        </div>
        <div className="kpi">
          <div className="k">Moradores ativos</div>
          <div className="v">{o.activeUsers}</div>
          <div className="d">de {o.registeredUsers} cadastrados</div>
        </div>
        <div className="kpi">
          <div className="k">Energia no pico</div>
          <div className="v">{fmtPct(o.peakShare)}</div>
          <div className={`d ${o.peakShare >= 0.5 ? 'warn' : ''}`}>{o.peakShare >= 0.5 ? 'revisar demanda' : 'dos kWh do mês'}</div>
        </div>
      </div>

      <div className="volt-card">
        <Volt size={52} />
        <div className="bubble">
          <div className="who">Resumo de {monthName(period)}</div>
          <p>
            O prédio consumiu <b>{fmtKwh(o.energyKwh)}</b> em {o.sessionsCount} {o.sessionsCount === 1 ? 'recarga' : 'recargas'}
            {o.greenShare !== null && (
              <>
                , <span className="good">{fmtPct(o.greenShare)} de energia solar</span>
              </>
            )}
            .{' '}
            {o.unassigned.count > 0
              ? `${o.unassigned.count} ainda sem morador atribuído (${fmtKwh(o.unassigned.energyKwh)} fora do rateio).`
              : 'Todas as recargas já têm morador.'}
          </p>
        </div>
      </div>

      <div className="c">
        <div className="c-label">Alertas</div>
        {o.alerts.length === 0 && <div className="empty-inline">Nada fora do normal neste mês.</div>}
        {o.alerts.map((a) => (
          <div className="act" key={a.title}>
            <div className="ic" style={TONE[a.tone].style}>
              {TONE[a.tone].icon}
            </div>
            <div className="info">
              <div className="t">{a.title}</div>
              <div className="s clamp">{a.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
