import { useState } from 'react'
import Volt from '../../../components/Volt'
import { currentPeriod, fmtBRL, fmtDueDate, fmtKwh, monthName, STATE_LABEL, STATE_TAG } from '../../../lib/format'
import { api } from '../../../lib/http'
import type { Cycle, CycleLine } from '../../../lib/types'
import { useApi } from '../../../lib/useApi'
import { Empty, ErrorBox, Loading } from '../ui'
import { useAction } from '../../../lib/useAction'
import FaturaDetalhe, { LineSplit } from './FaturaDetalhe'
import Lancamentos from './Lancamentos'

export default function Rateio({ period, canWrite, goCobrancas }: { period: string; canWrite: boolean; goCobrancas?: () => void }) {
  const { data: c, error, loading, reload } = useApi<Cycle>(`/api/admin/billing?period=${period}`)
  const act = useAction()
  const [detail, setDetail] = useState<CycleLine | null>(null)

  if (loading && !c) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (!c) return null

  const active = c.lines.filter((l) => l.active)
  // quem recebe fatura: quem carregou ou tem ajuste lançado no ciclo
  const billed = c.lines.filter((l) => l.active || l.adjustmentCents !== 0)
  const exempt = c.lines.length - active.length
  const fixedPool = c.fixedMonthlyCostCents + c.expensesCents
  const open = c.lines.filter((l) => l.status === 'PENDING' || l.status === 'OVERDUE').length
  const hasPaid = c.lines.some((l) => l.status === 'PAID')
  const fixedAfterCredit = c.totals.fixedShareCents - c.totals.creditCents
  const barTotal = c.totals.chargedCents + fixedAfterCredit + c.totals.creditCents || 1
  const share = (v: number) => `${Math.round((v / barTotal) * 100)}%`

  // o ciclo só fecha depois que o mês termina: nenhuma recarga do mês fica fora da fatura
  const monthOpen = period >= currentPeriod()

  const close = () => {
    const msg = `Emitir as faturas de ${monthName(period)} para ${billed.length} ${billed.length === 1 ? 'pessoa' : 'pessoas'}?`
    if (!confirm(msg)) return
    void act.run(async () => {
      await api(`/api/admin/billing/${period}/close`, { method: 'POST' })
      reload()
    })
  }

  const setPaid = (invoiceId: string, paid: boolean) =>
    act.run(async () => {
      await api(`/api/admin/invoices/${invoiceId}`, { method: 'PATCH', json: { status: paid ? 'PAID' : 'PENDING' } })
      reload()
    })

  return (
    <>
      <div className="kpi2">
        <div className="kpi">
          <div className="k">Energia cobrada</div>
          <div className="v">{fmtBRL(c.totals.chargedCents)}</div>
          <div className="d">
            {fmtKwh(c.totals.energyKwh, 0)} · custo {fmtBRL(c.totals.energyCostCents)}
          </div>
        </div>
        <div className="kpi">
          <div className="k">Custo fixo do mês</div>
          <div className="v">{fmtBRL(fixedPool)}</div>
          <div className="d">
            ÷ {c.activeUsers} {c.activeUsers === 1 ? 'ativo' : 'ativos'}
            {c.expensesCents > 0 && ` · inclui ${fmtBRL(c.expensesCents)} de despesas`}
            {c.fixedSplitCents < fixedPool &&
              c.activeUsers > 0 &&
              ` · convidados cobriram ${fmtBRL(fixedPool - c.fixedSplitCents)}`}
          </div>
        </div>
        <div className="kpi">
          <div className="k">Total do ciclo</div>
          <div className="v">{fmtBRL(c.totals.totalCents)}</div>
          <div className="d">{c.closed ? `vence ${fmtDueDate(c.dueDate)}` : 'ciclo aberto'}</div>
        </div>
        <div className="kpi">
          <div className="k">Faturas em aberto</div>
          <div className="v">{c.closed ? open : '—'}</div>
          <div className={open > 0 ? 'd warn' : 'd'}>{c.closed ? `de ${billed.length} emitidas` : 'ainda não emitidas'}</div>
        </div>
      </div>

      <div className="c">
        <div className="c-label">Composição financeira do mês</div>
        <div className="bill-split">
          <div style={{ width: share(c.totals.chargedCents), background: 'linear-gradient(90deg,#f472b6,#e8185a)' }} />
          <div style={{ width: share(c.totals.creditCents), background: 'var(--amber)' }} />
          <div style={{ width: share(fixedAfterCredit), background: 'var(--text3)' }} />
        </div>
        <div className="bill-legend">
          <span>
            <span className="sw" style={{ background: '#e8185a' }} />
            Energia · {fmtBRL(c.totals.chargedCents)}
          </span>
          <span>
            <span className="sw" style={{ background: 'var(--amber)' }} />
            Créditos devolvidos · {fmtBRL(c.totals.creditCents)}
          </span>
          <span>
            <span className="sw" style={{ background: 'var(--text3)' }} />
            Parcela fixa líquida · {fmtBRL(fixedAfterCredit)}
          </span>
        </div>
      </div>

      <div className="volt-card">
        <Volt size={52} />
        <div className="bubble">
          <div className="who">Como funciona o rateio</div>
          <p>
            Cada recarga custa <b>mult × kWh × tarifa base</b>, com mult entre 0,5× (horário ocioso) e 1,5× (horário
            disputado). O custo fixo é dividido entre {c.activeUsers === 1 ? 'o' : 'os'}{' '}
            <b>{c.activeUsers} {c.activeUsers === 1 ? 'morador ativo' : 'moradores ativos'}</b>, e o que alguém pagou acima
            do custo real da energia <span className="good">volta como crédito na parcela fixa dele</span>, nunca como
            lucro.
          </p>
        </div>
      </div>

      <Lancamentos cycle={c} period={period} canWrite={canWrite} locked={hasPaid} onChanged={reload} />

      <div className="c">
        <div className="c-label row-between">
          Faturas por morador
          {canWrite && !hasPaid && !monthOpen && (
            <button className="btn btn-primary btn-sm" onClick={close} disabled={act.busy || billed.length === 0}>
              {c.closed ? 'Recalcular faturas' : 'Fechar ciclo e emitir'}
            </button>
          )}
          {canWrite && monthOpen && <span>fecha quando o mês terminar</span>}
        </div>
        {act.error && <div className="login-error">{act.error}</div>}
        {c.closed && open > 0 && goCobrancas && (
          <div className="pay-issue">
            <span>Faturas emitidas. Gere o Pix ou o boleto de cada morador e acompanhe os pagamentos.</span>
            <button className="btn btn-ghost btn-sm" onClick={goCobrancas}>
              Ir para Cobranças
            </button>
          </div>
        )}
        {billed.length === 0 && <Empty>Nenhum morador com recarga atribuída neste mês.</Empty>}
        {billed.map((l) => (
          <div className="act wrap" key={l.userId}>
            <button className="info inv-open" onClick={() => setDetail(l)} aria-label={`Ver composição da fatura de ${l.name}`}>
              <div className="t">
                {l.unitLabel ? `${l.unitLabel} · ${l.name}` : l.name}
                {l.kind === 'CONVIDADO' && <small> · convidado</small>}
              </div>
              <div className="s">
                {fmtKwh(l.energyKwh)} em {l.sessionsCount} · energia {fmtBRL(l.chargedCents)} ·{' '}
                {l.kind === 'CONVIDADO' ? 'sem parcela fixa' : `fixa ${fmtBRL(l.fixedShareCents)}`}
                {l.creditCents > 0 && ` · crédito ${fmtBRL(l.creditCents)}`}
                {l.adjustmentCents !== 0 &&
                  ` · ajuste ${l.adjustmentCents < 0 ? '−' : '+'} ${fmtBRL(Math.abs(l.adjustmentCents))}`}
              </div>
              <LineSplit line={l} />
              <span className="inv-more">ver composição</span>
            </button>
            <span className={`ptag ${STATE_TAG[l.status]}`}>{STATE_LABEL[l.status]}</span>
            <div className="val">{fmtBRL(l.totalCents)}</div>
            {canWrite && l.invoiceId && (
              <button
                className="btn btn-ghost btn-sm"
                disabled={act.busy}
                onClick={() => setPaid(l.invoiceId!, l.status !== 'PAID')}
              >
                {l.status === 'PAID' ? 'Desfazer' : 'Marcar paga'}
              </button>
            )}
          </div>
        ))}
        {detail && <FaturaDetalhe line={detail} period={period} onClose={() => setDetail(null)} />}
        <div className="rateio-note">
          {exempt > 0 && `${exempt} de ${c.lines.length} cadastrados não carregaram e ficam isentos da parcela fixa neste ciclo. `}
          {c.notInvoiced > 0 &&
            `${c.notInvoiced} ${c.notInvoiced === 1 ? 'recarga entrou' : 'recargas entraram'} depois do fechamento e não ${c.notInvoiced === 1 ? 'está' : 'estão'} em nenhuma fatura${hasPaid ? '. ' : ': recalcule as faturas. '}`}
          {c.unassigned.count > 0 &&
            `${c.unassigned.count} ${c.unassigned.count === 1 ? 'sessão' : 'sessões'} (${fmtKwh(c.unassigned.energyKwh)}) sem morador: atribua em Operação para entrarem no rateio.`}
        </div>
      </div>
    </>
  )
}
