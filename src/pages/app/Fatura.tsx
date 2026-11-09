import { useState } from 'react'
import Volt from '../../components/Volt'
import {
  currentPeriod,
  fmtBRL,
  fmtDay,
  fmtDueDate,
  fmtKwh,
  fmtMult,
  fmtTime,
  LEVEL_LABEL,
  monthName,
  shiftPeriod,
  STATE_LABEL,
  STATE_TAG,
} from '../../lib/format'
import type { MyInvoice } from '../../lib/types'
import { useApi } from '../../lib/useApi'
import EntryRows from './EntryRows'
import { PaymentCard } from './Pagamento'
import { Empty, ErrorBox, Loading, PeriodPicker } from './ui'
import { t } from '../../lib/i18n'

export default function Fatura() {
  const now = currentPeriod()
  const [period, setPeriod] = useState(now)
  const { data, error, loading, reload } = useApi<MyInvoice>(`/api/me/invoice?period=${period}`)

  const line = data?.line
  // convidado (mora em outro condomínio) paga só a energia: sem parcela fixa nem crédito
  const guest = line?.kind === 'CONVIDADO'
  const sessions = data?.sessions ?? []
  const total = line?.totalCents ?? 0
  const priciest = sessions.reduce<(typeof sessions)[number] | null>(
    (a, b) => ((b.chargedCents ?? 0) > (a?.chargedCents ?? -1) ? b : a),
    null,
  )
  const offPeak = sessions.filter((s) => s.level === 'cheap').length
  const peak = sessions.filter((s) => s.level === 'peak').length
  const diff = data?.previousTotalCents != null ? total - data.previousTotalCents : null

  // barra de composição: energia cobrada + parcela fixa − crédito
  const parts = line
    ? [
        { k: t('Energia (tarifa dinâmica)', 'Energy (dynamic rate)'), v: line.chargedCents, bg: 'linear-gradient(90deg,#f472b6,#e8185a)', sw: '#e8185a' },
        { k: t('Parcela fixa', 'Fixed share'), v: line.fixedShareCents - line.creditCents, bg: 'var(--text3)', sw: 'var(--text3)' },
        { k: t('Ajustes', 'Adjustments'), v: line.adjustmentCents, bg: 'var(--amber)', sw: 'var(--amber)' },
      ].filter((p) => p.v > 0)
    : []
  const partsTotal = parts.reduce((s, p) => s + p.v, 0) || 1

  return (
    <div className="screen-anim">
      <div className="screen-title">{t('Minha fatura', 'My bill')}</div>
      <PeriodPicker period={period} onChange={setPeriod} max={now} />

      {loading && !data && <Loading />}
      {error && <ErrorBox error={error} onRetry={reload} />}

      {data && (
        <div className="desk-cols">
          <div>
            <div className="bill-hero">
              <div className="amount">{fmtBRL(total)}</div>
              <div className="bill-meta">
                {line && <span className={`ptag ${STATE_TAG[line.status]}`}>{STATE_LABEL[line.status]}</span>}
                {line && line.status !== 'EXEMPT' && <span>{t('vence', 'due')} {fmtDueDate(line.dueDate)}</span>}
              </div>
              {diff !== null && diff !== 0 && (
                <div className={`trend ${diff > 0 ? 'up' : ''}`}>
                  {diff < 0 ? '▼' : '▲'} {fmtBRL(Math.abs(diff))} {diff < 0 ? t('mais leve', 'lighter') : t('mais cara', 'higher')} {t('que', 'than')}{' '}
                  {monthName(shiftPeriod(period, -1))}
                </div>
              )}
            </div>

            {line && (
              <PaymentCard
                key={period}
                line={line}
                charges={data.charges}
                reload={reload}
              />
            )}

            {line && (line.active || line.adjustmentCents !== 0) ? (
              <div className="c">
                <div className="c-label">{t('Como sua fatura foi calculada', 'How your bill was calculated')}</div>
                <div className="bill-split">
                  {parts.map((p) => (
                    <div key={p.k} style={{ width: `${(p.v / partsTotal) * 100}%`, background: p.bg }} />
                  ))}
                </div>
                <div className="calc-rows">
                  <div>
                    <span>{t('Energia a preço de custo', 'Energy at cost price')} · {fmtKwh(line.energyKwh)} × {t('tarifa base', 'base rate')}</span>
                    <b>{fmtBRL(line.energyCostCents)}</b>
                  </div>
                  <div>
                    <span>{t('Energia cobrada com a tarifa dinâmica (mult por horário)', 'Energy charged at the dynamic rate (multiplier by hour)')}</span>
                    <b>{fmtBRL(line.chargedCents)}</b>
                  </div>
                  {guest ? (
                    <div>
                      <span>{t('Parcela fixa · convidado não entra no rateio deste condomínio', 'Fixed share · guests are not part of this building’s split')}</span>
                      <b>{fmtBRL(0)}</b>
                    </div>
                  ) : (
                    <>
                      <div>
                        <span>
                          {t('Parcela fixa', 'Fixed share')} · {fmtBRL(data.fixedSplitCents)} ÷ {data.activeUsers}{' '}
                          {data.activeUsers === 1 ? t('morador ativo', 'active resident') : t('moradores ativos', 'active residents')}
                          {data.fixedSplitCents < data.fixedMonthlyCostCents + data.expensesCents &&
                            ` ${t('(custo fixo de', '(fixed cost of')} ${fmtBRL(data.fixedMonthlyCostCents + data.expensesCents)}${t(', parte coberta por convidados)', ', partly covered by guests)')}`}
                          {data.entries
                            .filter((e) => e.kind === 'DESPESA')
                            .map((e) => ` · ${t('inclui', 'includes')} ${e.description} (${fmtBRL(e.amountCents)})`)
                            .join('')}
                        </span>
                        <b>{fmtBRL(line.fixedShareCents)}</b>
                      </div>
                      <div className="good">
                        <span>{t('Crédito do excedente pago no horário concorrido', 'Credit for the surplus paid at peak hours')}</span>
                        <b>− {fmtBRL(line.creditCents)}</b>
                      </div>
                    </>
                  )}
                  <EntryRows data={data} />
                  <div className="total">
                    <span>{t('Total', 'Total')}</span>
                    <b>{fmtBRL(line.totalCents)}</b>
                  </div>
                </div>
              </div>
            ) : (
              <div className="c">
                <Empty>
                  {data?.line?.kind === 'CONVIDADO'
                    ? t(`Nenhuma recarga sua aqui em ${monthName(period)}.`, `No charges from you here in ${monthName(period)}.`)
                    : t(`Nenhuma recarga sua em ${monthName(period)}: você fica isento da parcela fixa neste ciclo.`, `No charges from you in ${monthName(period)}: you are exempt from the fixed share this cycle.`)}
                </Empty>
              </div>
            )}
          </div>

          <div>
            {sessions.length > 0 && priciest && (
              <div className="volt-card">
                <Volt size={52} />
                <div className="bubble">
                  <div className="who">{t('Volt explica', 'Volt explains')}</div>
                  <p>
                    {t('A recarga mais cara foi', 'The most expensive charge was')} <b>{fmtDay(priciest.startedAt)} {t('às', 'at')} {fmtTime(priciest.startedAt)}</b>:{' '}
                    {fmtKwh(priciest.energyKwh)} {t('com mult', 'with multiplier')} {priciest.mult !== null ? fmtMult(priciest.mult) : '—'}
                    {priciest.demand !== null && ` (${t('demanda prevista de', 'expected demand of')} ${Math.round(priciest.demand * 100)}% ${t('naquele horário', 'at that time')})`}.{' '}
                    {offPeak > 0 ? (
                      <span className="good">
                        {offPeak} {t('de', 'of')} {sessions.length} {t('foram em horário barato.', 'were at cheap hours.')}
                      </span>
                    ) : peak > 0 ? (
                      t('Tente agendar fora do pico para pagar menos.', 'Try booking off-peak to pay less.')
                    ) : null}
                  </p>
                </div>
              </div>
            )}

            <div className="c">
              <div className="c-label">{t('Recarga por recarga', 'Charge by charge')}</div>
              {sessions.length === 0 && <Empty>{t('Sem recargas neste mês.', 'No charges this month.')}</Empty>}
              {sessions.map((s) => (
                <div className="act" key={s.id}>
                  <div className="info">
                    <div className="t">
                      {t('Recarga', 'Charge')} · {fmtDay(s.startedAt)} {fmtTime(s.startedAt)}
                    </div>
                    <div className="s">
                      {fmtKwh(s.energyKwh)}
                      {s.mult !== null && ` · ${t('mult', 'mult')} ${fmtMult(s.mult)}`}
                      {s.energyCostCents !== null && ` · ${t('custo', 'cost')} ${fmtBRL(s.energyCostCents)}`}
                    </div>
                  </div>
                  {s.level && (
                    <span className={`ptag ${s.level}`} style={{ marginRight: 10 }}>
                      {LEVEL_LABEL[s.level]}
                    </span>
                  )}
                  <div className="val">{s.chargedCents !== null ? fmtBRL(s.chargedCents) : '—'}</div>
                </div>
              ))}
              {line && line.fixedShareCents > 0 && (
                <div className="act">
                  <div className="info">
                    <div className="t">{t('Parte fixa do condomínio', 'Building fixed share')}</div>
                    <div className="s">{t('manutenção', 'maintenance')} ÷ {data.activeUsers} {t('ativos', 'active')}</div>
                  </div>
                  <span className="ptag dim" style={{ marginRight: 10 }}>
                    {t('Rateio', 'Split')}
                  </span>
                  <div className="val">{fmtBRL(line.fixedShareCents)}</div>
                </div>
              )}
              {line && line.creditCents > 0 && (
                <div className="act">
                  <div className="info">
                    <div className="t">{t('Crédito na parte fixa', 'Credit on the fixed share')}</div>
                    <div className="s">{t('o que você pagou acima do custo real volta para você', 'what you paid above the real cost comes back to you')}</div>
                  </div>
                  <span className="ptag cheap" style={{ marginRight: 10 }}>
                    {t('Crédito', 'Credit')}
                  </span>
                  <div className="val">− {fmtBRL(line.creditCents)}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
