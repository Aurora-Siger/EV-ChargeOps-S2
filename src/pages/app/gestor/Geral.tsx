import Volt from '../../../components/Volt'
import { fmtBRL, fmtKwh, fmtPct, monthName } from '../../../lib/format'
import { t } from '../../../lib/i18n'
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
          <div className="k">{t('Energia no mês', 'Energy this month')}</div>
          <div className="v">{fmtKwh(o.energyKwh, 0)}</div>
          <div className={`d ${delta !== null && delta > 0 ? 'up' : ''}`}>
            {delta === null ? `${o.sessionsCount} ${t('recargas', 'charges')}` : `${delta >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(delta))} ${t('vs. mês anterior', 'vs. last month')}`}
          </div>
        </div>
        <div className="kpi">
          <div className="k">{o.closed ? t('Faturado', 'Billed') : t('Rateio parcial', 'Partial split')}</div>
          <div className="v">{fmtBRL(o.billedCents)}</div>
          <div className="d">{o.closed ? `${o.openInvoices} ${t('em aberto', 'open')}` : t('ciclo ainda aberto', 'cycle still open')}</div>
        </div>
        <div className="kpi">
          <div className="k">{t('Moradores ativos', 'Active residents')}</div>
          <div className="v">{o.activeUsers}</div>
          <div className="d">{t('de', 'of')} {o.registeredUsers} {t('cadastrados', 'registered')}</div>
        </div>
        <div className="kpi">
          <div className="k">{t('Energia no pico', 'Peak energy')}</div>
          <div className="v">{fmtPct(o.peakShare)}</div>
          <div className={`d ${o.peakShare >= 0.5 ? 'warn' : ''}`}>{o.peakShare >= 0.5 ? t('revisar demanda', 'review demand') : t('dos kWh do mês', 'of the month’s kWh')}</div>
        </div>
      </div>

      <div className="volt-card">
        <Volt size={52} />
        <div className="bubble">
          <div className="who">{t('Resumo de', 'Summary for')} {monthName(period)}</div>
          <p>
            {t('O prédio consumiu', 'The building used')} <b>{fmtKwh(o.energyKwh)}</b> {t('em', 'in')} {o.sessionsCount}{' '}
            {o.sessionsCount === 1 ? t('recarga', 'charge') : t('recargas', 'charges')}
            {o.greenShare !== null && (
              <>
                , <span className="good">{fmtPct(o.greenShare)} {t('de energia solar', 'of solar energy')}</span>
              </>
            )}
            .{' '}
            {o.unassigned.count > 0
              ? t(`${o.unassigned.count} ainda sem morador atribuído (${fmtKwh(o.unassigned.energyKwh)} fora do rateio).`, `${o.unassigned.count} still without an assigned resident (${fmtKwh(o.unassigned.energyKwh)} outside the split).`)
              : t('Todas as recargas já têm morador.', 'All charges already have a resident.')}
          </p>
        </div>
      </div>

      <div className="c">
        <div className="c-label">{t('Alertas', 'Alerts')}</div>
        {o.alerts.length === 0 && <div className="empty-inline">{t('Nada fora do normal neste mês.', 'Nothing unusual this month.')}</div>}
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
