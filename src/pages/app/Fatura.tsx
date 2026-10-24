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
        { k: 'Energia (tarifa dinâmica)', v: line.chargedCents, bg: 'var(--pink)', sw: '#e8185a' },
        { k: 'Parcela fixa', v: line.fixedShareCents - line.creditCents, bg: 'var(--text3)', sw: 'var(--text3)' },
        { k: 'Ajustes', v: line.adjustmentCents, bg: 'var(--amber)', sw: 'var(--amber)' },
      ].filter((p) => p.v > 0)
    : []
  const partsTotal = parts.reduce((s, p) => s + p.v, 0) || 1

  return (
    <div className="screen-anim">
      <div className="screen-title">Minha fatura</div>
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
                {line && line.status !== 'EXEMPT' && <span>vence {fmtDueDate(line.dueDate)}</span>}
              </div>
              {diff !== null && diff !== 0 && (
                <div className={`trend ${diff > 0 ? 'up' : ''}`}>
                  {diff < 0 ? '▼' : '▲'} {fmtBRL(Math.abs(diff))} {diff < 0 ? 'mais leve' : 'mais cara'} que{' '}
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
                <div className="c-label">Como sua fatura foi calculada</div>
                <div className="bill-split">
                  {parts.map((p) => (
                    <div key={p.k} style={{ width: `${(p.v / partsTotal) * 100}%`, background: p.bg }} />
                  ))}
                </div>
                <div className="calc-rows">
                  <div>
                    <span>Energia a preço de custo · {fmtKwh(line.energyKwh)} × tarifa base</span>
                    <b>{fmtBRL(line.energyCostCents)}</b>
                  </div>
                  <div>
                    <span>Energia cobrada com a tarifa dinâmica (mult por horário)</span>
                    <b>{fmtBRL(line.chargedCents)}</b>
                  </div>
                  {guest ? (
                    <div>
                      <span>Parcela fixa · convidado não entra no rateio deste condomínio</span>
                      <b>{fmtBRL(0)}</b>
                    </div>
                  ) : (
                    <>
                      <div>
                        <span>
                          Parcela fixa · {fmtBRL(data.fixedSplitCents)} ÷ {data.activeUsers}{' '}
                          {data.activeUsers === 1 ? 'morador ativo' : 'moradores ativos'}
                          {data.fixedSplitCents < data.fixedMonthlyCostCents + data.expensesCents &&
                            ` (custo fixo de ${fmtBRL(data.fixedMonthlyCostCents + data.expensesCents)}, parte coberta por convidados)`}
                          {data.entries
                            .filter((e) => e.kind === 'DESPESA')
                            .map((e) => ` · inclui ${e.description} (${fmtBRL(e.amountCents)})`)
                            .join('')}
                        </span>
                        <b>{fmtBRL(line.fixedShareCents)}</b>
                      </div>
                      <div className="good">
                        <span>Crédito do excedente pago no horário concorrido</span>
                        <b>− {fmtBRL(line.creditCents)}</b>
                      </div>
                    </>
                  )}
                  <EntryRows data={data} />
                  <div className="total">
                    <span>Total</span>
                    <b>{fmtBRL(line.totalCents)}</b>
                  </div>
                </div>
              </div>
            ) : (
              <div className="c">
                <Empty>
                  {data?.line?.kind === 'CONVIDADO'
                    ? `Nenhuma recarga sua aqui em ${monthName(period)}.`
                    : `Nenhuma recarga sua em ${monthName(period)}: você fica isento da parcela fixa neste ciclo.`}
                </Empty>
              </div>
            )}
          </div>

          <div>
            {sessions.length > 0 && priciest && (
              <div className="volt-card">
                <Volt size={52} />
                <div className="bubble">
                  <div className="who">Volt explica</div>
                  <p>
                    A recarga mais cara foi <b>{fmtDay(priciest.startedAt)} às {fmtTime(priciest.startedAt)}</b>:{' '}
                    {fmtKwh(priciest.energyKwh)} com mult {priciest.mult !== null ? fmtMult(priciest.mult) : '—'}
                    {priciest.demand !== null && ` (demanda prevista de ${Math.round(priciest.demand * 100)}% naquele horário)`}.{' '}
                    {offPeak > 0 ? (
                      <span className="good">
                        {offPeak} de {sessions.length} foram em horário barato.
                      </span>
                    ) : peak > 0 ? (
                      'Tente agendar fora do pico para pagar menos.'
                    ) : null}
                  </p>
                </div>
              </div>
            )}

            <div className="c">
              <div className="c-label">Recarga por recarga</div>
              {sessions.length === 0 && <Empty>Sem recargas neste mês.</Empty>}
              {sessions.map((s) => (
                <div className="act" key={s.id}>
                  <div className="info">
                    <div className="t">
                      Recarga · {fmtDay(s.startedAt)} {fmtTime(s.startedAt)}
                    </div>
                    <div className="s">
                      {fmtKwh(s.energyKwh)}
                      {s.mult !== null && ` · mult ${fmtMult(s.mult)}`}
                      {s.energyCostCents !== null && ` · custo ${fmtBRL(s.energyCostCents)}`}
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
                    <div className="t">Parte fixa do condomínio</div>
                    <div className="s">manutenção ÷ {data.activeUsers} ativos</div>
                  </div>
                  <span className="ptag dim" style={{ marginRight: 10 }}>
                    Rateio
                  </span>
                  <div className="val">{fmtBRL(line.fixedShareCents)}</div>
                </div>
              )}
              {line && line.creditCents > 0 && (
                <div className="act">
                  <div className="info">
                    <div className="t">Crédito na parte fixa</div>
                    <div className="s">o que você pagou acima do custo real volta para você</div>
                  </div>
                  <span className="ptag cheap" style={{ marginRight: 10 }}>
                    Crédito
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
