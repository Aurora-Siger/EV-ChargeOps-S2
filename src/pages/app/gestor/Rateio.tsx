import { useState } from 'react'
import Volt from '../../../components/Volt'
import { currentPeriod, fmtBRL, fmtDueDate, fmtKwh, monthName, STATE_LABEL, STATE_TAG } from '../../../lib/format'
import { isEn, t } from '../../../lib/i18n'
import { csvMoney, downloadCsv } from '../../../lib/csv'
import { api } from '../../../lib/http'
import type { Cycle, CycleLine } from '../../../lib/types'
import { useApi } from '../../../lib/useApi'
import { I } from '../icons'
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
    const msg = t(
      `Emitir as faturas de ${monthName(period)} para ${billed.length} ${billed.length === 1 ? 'pessoa' : 'pessoas'}?`,
      `Issue the ${monthName(period)} bills for ${billed.length} ${billed.length === 1 ? 'person' : 'people'}?`,
    )
    if (!confirm(msg)) return
    void act.run(async () => {
      await api(`/api/admin/billing/${period}/close`, { method: 'POST' })
      reload()
    })
  }

  // rateio do mês pronto pra administradora: uma linha por pessoa, valores em reais
  const exportCsv = () =>
    downloadCsv(
      `rateio-${period}.csv`,
      isEn()
        ? ['Unit', 'Name', 'Email', 'Type', 'Charges', 'Energy (kWh)', 'Energy cost (R$)', 'Energy charged (R$)', 'Fixed share (R$)', 'Credit (R$)', 'Adjustments (R$)', 'Total (R$)', 'Status']
        : ['Unidade', 'Nome', 'E-mail', 'Tipo', 'Recargas', 'Energia (kWh)', 'Custo da energia (R$)', 'Energia cobrada (R$)', 'Parcela fixa (R$)', 'Crédito (R$)', 'Ajustes (R$)', 'Total (R$)', 'Situação'],
      c.lines.map((l) => [
        l.unitLabel,
        l.name,
        l.email,
        l.kind === 'CONVIDADO' ? t('Convidado', 'Guest') : t('Morador', 'Resident'),
        l.sessionsCount,
        Number(l.energyKwh.toFixed(3)),
        csvMoney(l.energyCostCents),
        csvMoney(l.chargedCents),
        csvMoney(l.fixedShareCents),
        csvMoney(l.creditCents),
        csvMoney(l.adjustmentCents),
        csvMoney(l.totalCents),
        STATE_LABEL[l.status],
      ]),
    )

  const setPaid = (invoiceId: string, paid: boolean) =>
    act.run(async () => {
      await api(`/api/admin/invoices/${invoiceId}`, { method: 'PATCH', json: { status: paid ? 'PAID' : 'PENDING' } })
      reload()
    })

  return (
    <>
      <div className="kpi2">
        <div className="kpi">
          <div className="k">{t('Energia cobrada', 'Energy charged')}</div>
          <div className="v">{fmtBRL(c.totals.chargedCents)}</div>
          <div className="d">
            {fmtKwh(c.totals.energyKwh, 0)} · {t('custo', 'cost')} {fmtBRL(c.totals.energyCostCents)}
          </div>
        </div>
        <div className="kpi">
          <div className="k">{t('Custo fixo do mês', 'Fixed cost this month')}</div>
          <div className="v">{fmtBRL(fixedPool)}</div>
          <div className="d">
            ÷ {c.activeUsers} {c.activeUsers === 1 ? t('ativo', 'active') : t('ativos', 'active')}
            {c.expensesCents > 0 && ` · ${t('inclui', 'includes')} ${fmtBRL(c.expensesCents)} ${t('de despesas', 'of expenses')}`}
            {c.fixedSplitCents < fixedPool &&
              c.activeUsers > 0 &&
              ` · ${t('convidados cobriram', 'guests covered')} ${fmtBRL(fixedPool - c.fixedSplitCents)}`}
          </div>
        </div>
        <div className="kpi">
          <div className="k">{t('Total do ciclo', 'Cycle total')}</div>
          <div className="v">{fmtBRL(c.totals.totalCents)}</div>
          <div className="d">{c.closed ? `${t('vence', 'due')} ${fmtDueDate(c.dueDate)}` : t('ciclo aberto', 'cycle open')}</div>
        </div>
        <div className="kpi">
          <div className="k">{t('Faturas em aberto', 'Open bills')}</div>
          <div className="v">{c.closed ? open : '—'}</div>
          <div className={open > 0 ? 'd warn' : 'd'}>
            {c.closed ? `${t('de', 'of')} ${billed.length} ${t('emitidas', 'issued')}` : t('ainda não emitidas', 'not issued yet')}
          </div>
        </div>
      </div>

      <div className="c">
        <div className="c-label">{t('Composição financeira do mês', 'Financial breakdown for the month')}</div>
        <div className="bill-split">
          <div style={{ width: share(c.totals.chargedCents), background: 'linear-gradient(90deg,#f472b6,#e8185a)' }} />
          <div style={{ width: share(c.totals.creditCents), background: 'var(--amber)' }} />
          <div style={{ width: share(fixedAfterCredit), background: 'var(--text3)' }} />
        </div>
        <div className="bill-legend">
          <span>
            <span className="sw" style={{ background: '#e8185a' }} />
            {t('Energia', 'Energy')} · {fmtBRL(c.totals.chargedCents)}
          </span>
          <span>
            <span className="sw" style={{ background: 'var(--amber)' }} />
            {t('Créditos devolvidos', 'Credits returned')} · {fmtBRL(c.totals.creditCents)}
          </span>
          <span>
            <span className="sw" style={{ background: 'var(--text3)' }} />
            {t('Parcela fixa líquida', 'Net fixed share')} · {fmtBRL(fixedAfterCredit)}
          </span>
        </div>
      </div>

      <div className="volt-card">
        <Volt size={52} />
        <div className="bubble">
          <div className="who">{t('Como funciona o rateio', 'How the split works')}</div>
          <p>
            {t('Cada recarga custa', 'Each charge costs')} <b>mult × kWh × {t('tarifa base', 'base rate')}</b>
            {t(', com mult entre 0,5× (horário ocioso) e 1,5× (horário disputado). O custo fixo é dividido entre ', ', with the multiplier between 0.5× (idle hours) and 1.5× (contested hours). The fixed cost is split among ')}
            <b>{c.activeUsers} {c.activeUsers === 1 ? t('morador ativo', 'active resident') : t('moradores ativos', 'active residents')}</b>
            {t(', e o que alguém pagou acima do custo real da energia ', ', and what someone paid above the real energy cost ')}
            <span className="good">{t('volta como crédito na parcela fixa dele', 'comes back as credit on their fixed share')}</span>
            {t(', nunca como lucro.', ', never as profit.')}
          </p>
        </div>
      </div>

      <Lancamentos cycle={c} period={period} canWrite={canWrite} locked={hasPaid} onChanged={reload} />

      <div className="c">
        <div className="c-label row-between">
          {t('Faturas por morador', 'Bills per resident')}
          <span className="row-actions">
          <button className="btn btn-ghost btn-sm btn-csv" onClick={exportCsv} disabled={c.lines.length === 0}>
            {I.download} CSV
          </button>
          {canWrite && !hasPaid && !monthOpen && (
            <button className="btn btn-primary btn-sm" onClick={close} disabled={act.busy || billed.length === 0}>
              {c.closed ? t('Recalcular faturas', 'Recalculate bills') : t('Fechar ciclo e emitir', 'Close cycle and issue')}
            </button>
          )}
          {canWrite && monthOpen && <span>{t('fecha quando o mês terminar', 'closes when the month ends')}</span>}
          </span>
        </div>
        {act.error && <div className="login-error">{act.error}</div>}
        {c.closed && open > 0 && goCobrancas && (
          <div className="pay-issue">
            <span>{t('Faturas emitidas. Gere o Pix ou o boleto de cada morador e acompanhe os pagamentos.', 'Bills issued. Generate each resident’s Pix or boleto and track payments.')}</span>
            <button className="btn btn-ghost btn-sm" onClick={goCobrancas}>
              {t('Ir para Cobranças', 'Go to Billing')}
            </button>
          </div>
        )}
        {billed.length === 0 && <Empty>{t('Nenhum morador com recarga atribuída neste mês.', 'No resident with an assigned charge this month.')}</Empty>}
        {billed.map((l) => (
          <div className="act wrap" key={l.userId}>
            <button className="info inv-open" onClick={() => setDetail(l)} aria-label={`${t('Ver composição da fatura de', 'See the bill breakdown for')} ${l.name}`}>
              <div className="t">
                {l.unitLabel ? `${l.unitLabel} · ${l.name}` : l.name}
                {l.kind === 'CONVIDADO' && <small> · {t('convidado', 'guest')}</small>}
              </div>
              <div className="s">
                {fmtKwh(l.energyKwh)} {t('em', 'in')} {l.sessionsCount} · {t('energia', 'energy')} {fmtBRL(l.chargedCents)} ·{' '}
                {l.kind === 'CONVIDADO' ? t('sem parcela fixa', 'no fixed share') : `${t('fixa', 'fixed')} ${fmtBRL(l.fixedShareCents)}`}
                {l.creditCents > 0 && ` · ${t('crédito', 'credit')} ${fmtBRL(l.creditCents)}`}
                {l.adjustmentCents !== 0 &&
                  ` · ${t('ajuste', 'adjustment')} ${l.adjustmentCents < 0 ? '−' : '+'} ${fmtBRL(Math.abs(l.adjustmentCents))}`}
              </div>
              <LineSplit line={l} />
              <span className="inv-more">{t('ver composição', 'see breakdown')}</span>
            </button>
            <span className={`ptag ${STATE_TAG[l.status]}`}>{STATE_LABEL[l.status]}</span>
            <div className="val">{fmtBRL(l.totalCents)}</div>
            {canWrite && l.invoiceId && (
              <button
                className="btn btn-ghost btn-sm"
                disabled={act.busy}
                onClick={() => setPaid(l.invoiceId!, l.status !== 'PAID')}
              >
                {l.status === 'PAID' ? t('Desfazer', 'Undo') : t('Marcar paga', 'Mark paid')}
              </button>
            )}
          </div>
        ))}
        {detail && <FaturaDetalhe line={detail} period={period} onClose={() => setDetail(null)} />}
        <div className="rateio-note">
          {exempt > 0 &&
            t(
              `${exempt} de ${c.lines.length} cadastrados não carregaram e ficam isentos da parcela fixa neste ciclo. `,
              `${exempt} of ${c.lines.length} registered did not charge and are exempt from the fixed share this cycle. `,
            )}
          {c.notInvoiced > 0 &&
            t(
              `${c.notInvoiced} ${c.notInvoiced === 1 ? 'recarga entrou' : 'recargas entraram'} depois do fechamento e não ${c.notInvoiced === 1 ? 'está' : 'estão'} em nenhuma fatura${hasPaid ? '. ' : ': recalcule as faturas. '}`,
              `${c.notInvoiced} ${c.notInvoiced === 1 ? 'charge was' : 'charges were'} added after closing and are not on any bill${hasPaid ? '. ' : ': recalculate the bills. '}`,
            )}
          {c.unassigned.count > 0 &&
            t(`${c.unassigned.count} ${c.unassigned.count === 1 ? 'sessão' : 'sessões'} (${fmtKwh(c.unassigned.energyKwh)}) sem morador: atribua em Operação para entrarem no rateio.`, `${c.unassigned.count} ${c.unassigned.count === 1 ? 'session' : 'sessions'} (${fmtKwh(c.unassigned.energyKwh)}) without a resident: assign them in Operations to include them in the split.`)}
        </div>
      </div>
    </>
  )
}
