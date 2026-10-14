import { useState } from 'react'
import {
  CHARGE_LABEL,
  CHARGE_TAG,
  fmtBRL,
  fmtDateTime,
  monthName,
  METHOD_LABEL,
  STATE_LABEL,
  STATE_TAG,
} from '../../../lib/format'
import { api } from '../../../lib/http'
import type { Charge, ChargeMethod, ChargesOfPeriod, Cycle, CycleLine } from '../../../lib/types'
import { useAction } from '../../../lib/useAction'
import { useApi } from '../../../lib/useApi'
import { ChargeView } from '../Pagamento'
import FaturaDetalhe from './FaturaDetalhe'
import { Empty, ErrorBox, Loading, Modal } from '../ui'

type Listed = ChargesOfPeriod['charges'][number]

export default function Cobrancas({ period, canWrite, goRateio }: { period: string; canWrite: boolean; goRateio: () => void }) {
  const cycle = useApi<Cycle>(`/api/admin/billing?period=${period}`)
  const list = useApi<ChargesOfPeriod>(`/api/admin/charges?period=${period}`)
  const act = useAction()
  const [bulkMethod, setBulkMethod] = useState<ChargeMethod>('PIX')
  const [viewing, setViewing] = useState<{ charge: Charge; line: CycleLine } | null>(null)
  const [detail, setDetail] = useState<CycleLine | null>(null)
  // quem ficou sem cobrança no último "Emitir" em lote por falta de CPF/CNPJ
  const [skipped, setSkipped] = useState<string[]>([])

  if ((cycle.loading && !cycle.data) || (list.loading && !list.data)) return <Loading />
  if (cycle.error) return <ErrorBox error={cycle.error} onRetry={cycle.reload} />
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />
  const c = cycle.data
  const l = list.data
  if (!c || !l) return null

  const reload = () => {
    cycle.reload()
    list.reload()
  }
  const lines = c.lines.filter((x) => x.invoiceId)
  const openLines = lines.filter((x) => x.status === 'PENDING' || x.status === 'OVERDUE')
  const byInvoice = new Map<string, Listed[]>()
  for (const ch of l.charges) byInvoice.set(ch.invoiceId, [...(byInvoice.get(ch.invoiceId) ?? []), ch])
  const activeOf = (invoiceId: string) =>
    (byInvoice.get(invoiceId) ?? []).filter((ch) => ch.status === 'PENDING' || ch.status === 'OVERDUE')
  const missing = openLines.filter((x) => !activeOf(x.invoiceId!).some((ch) => ch.method === bulkMethod)).length
  const t = l.totals
  const emitted = t.pending.cents + t.overdue.cents + t.received.cents

  const issueAll = () =>
    act.run(async () => {
      const r = await api<{ skipped: string[] }>(`/api/admin/billing/${period}/charges`, {
        method: 'POST',
        json: { method: bulkMethod },
      })
      setSkipped(r.skipped)
      reload()
    })
  const issue = (invoiceId: string, method: ChargeMethod) =>
    act.run(async () => {
      await api(`/api/admin/invoices/${invoiceId}/charges`, { method: 'POST', json: { method } })
      reload()
    })
  const cancel = (id: string) =>
    act.run(async () => {
      await api(`/api/admin/charges/${id}/cancel`, { method: 'POST' })
      reload()
    })
  // o QR só vem na rota da fatura (a lista não gera imagem): busca na hora de abrir
  const view = (ch: Listed, line: CycleLine) =>
    act.run(async () => {
      const full = await api<Charge[]>(`/api/admin/invoices/${ch.invoiceId}/charges`)
      setViewing({ charge: full.find((x) => x.id === ch.id) ?? ch, line })
    })

  if (!c.closed) {
    return (
      <div className="c">
        <div className="c-label">Cobranças de {monthName(period)}</div>
        <Empty>
          As cobranças saem das faturas emitidas. Feche o ciclo de {monthName(period)} em Custos &amp; rateio para emitir
          as faturas e depois gere o Pix ou o boleto de cada morador aqui.
        </Empty>
        <button className="btn btn-ghost btn-sm" onClick={goRateio} style={{ marginTop: 12 }}>
          Ir para Custos &amp; rateio
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="kpi2">
        <div className="kpi">
          <div className="k">Recebido</div>
          <div className="v">{fmtBRL(t.received.cents)}</div>
          <div className="d">
            Pix {t.receivedPix.count} · boleto {t.receivedBoleto.count}
          </div>
        </div>
        <div className="kpi">
          <div className="k">Em aberto</div>
          <div className="v">{fmtBRL(t.pending.cents)}</div>
          <div className="d">
            {t.pending.count} {t.pending.count === 1 ? 'cobrança' : 'cobranças'}
          </div>
        </div>
        <div className="kpi">
          <div className="k">Vencido</div>
          <div className="v">{fmtBRL(t.overdue.cents)}</div>
          <div className={t.overdue.count ? 'd warn' : 'd'}>
            {t.overdue.count} {t.overdue.count === 1 ? 'cobrança' : 'cobranças'}
          </div>
        </div>
        <div className="kpi">
          <div className="k">Recebimento</div>
          <div className="v">{emitted ? `${Math.round((t.received.cents / emitted) * 100)}%` : '—'}</div>
          <div className="d">do valor cobrado</div>
        </div>
      </div>

      <div className="c">
        <div className="c-label row-between">
          Faturas de {monthName(period)}
          {canWrite && openLines.length > 0 && (
            <span className="bulk-issue">
              <span className="seg">
                {(['PIX', 'BOLETO'] as const).map((m) => (
                  <button key={m} className={bulkMethod === m ? 'on' : ''} onClick={() => setBulkMethod(m)}>
                    {METHOD_LABEL[m]}
                  </button>
                ))}
              </span>
              <button className="btn btn-primary btn-sm" onClick={issueAll} disabled={act.busy || missing === 0}>
                {missing ? `Emitir ${missing}` : 'Todas emitidas'}
              </button>
            </span>
          )}
        </div>
        {act.error && <div className="login-error">{act.error}</div>}
        {skipped.length > 0 && (
          <div className="login-error">
            Sem cobrança por falta de CPF/CNPJ: {skipped.join(', ')}. Cada morador informa o dele em Perfil → Dados de cobrança.
          </div>
        )}
        {lines.length === 0 && <Empty>Nenhuma fatura emitida neste ciclo.</Empty>}
        {lines.map((line) => {
          const charges = byInvoice.get(line.invoiceId!) ?? []
          const open = line.status === 'PENDING' || line.status === 'OVERDUE'
          const active = activeOf(line.invoiceId!)
          const shown = charges.filter((ch) => ch.status !== 'CANCELLED').slice(0, 3)
          return (
            <div className="act wrap charge-line" key={line.invoiceId}>
              <div className="info">
                <button className="t inv-link" onClick={() => setDetail(line)}>
                  {line.unitLabel ? `${line.unitLabel} · ${line.name}` : line.name}
                </button>
                <div className="charge-chips">
                  {shown.length === 0 && <span className="s">sem cobrança emitida</span>}
                  {shown.map((ch) => (
                    <button key={ch.id} className={`ptag ${CHARGE_TAG[ch.status]}`} onClick={() => view(ch, line)}>
                      {METHOD_LABEL[ch.method]} · {CHARGE_LABEL[ch.status]}
                    </button>
                  ))}
                </div>
              </div>
              <span className={`ptag ${STATE_TAG[line.status]}`}>{STATE_LABEL[line.status]}</span>
              <div className="val">{fmtBRL(line.totalCents)}</div>
              {canWrite && open && (
                <span className="charge-actions">
                  {(['PIX', 'BOLETO'] as const)
                    .filter((m) => !active.some((ch) => ch.method === m && ch.status === 'PENDING'))
                    .map((m) => (
                      <button key={m} className="btn btn-ghost btn-sm" disabled={act.busy} onClick={() => issue(line.invoiceId!, m)}>
                        + {METHOD_LABEL[m]}
                      </button>
                    ))}
                  {active.map((ch) => (
                    <button key={ch.id} className="btn btn-ghost btn-sm" disabled={act.busy} onClick={() => cancel(ch.id)}>
                      Cancelar {METHOD_LABEL[ch.method]}
                    </button>
                  ))}
                </span>
              )}
            </div>
          )
        })}
      </div>

      <div className="c">
        <div className="c-label">Eventos do gateway</div>
        {l.charges.length === 0 && <Empty>Nenhuma cobrança emitida ainda.</Empty>}
        {l.events.map((e) => ({ ...e, c: l.charges.find((c) => c.id === e.chargeId)! })).map((e) => (
          <div className="gw-event" key={`${e.chargeId}-${e.kind}-${e.at}`}>
            <span className={`gw-kind ${e.kind === 'PAYMENT_RECEIVED' ? 'ok' : e.kind === 'PAYMENT_DELETED' ? 'off' : ''}`}>
              {e.kind}
            </span>
            <span className="gw-what">
              {METHOD_LABEL[e.c.method]} · {e.c.unitLabel ?? e.c.name} · {fmtBRL(e.c.amountCents)}
            </span>
            <span className="gw-when">{fmtDateTime(e.at)}</span>
          </div>
        ))}
      </div>

      {detail && <FaturaDetalhe line={detail} period={period} onClose={() => setDetail(null)} />}
      {viewing && (
        <Modal title={`Cobrança · ${viewing.line.unitLabel ?? viewing.line.name}`} onClose={() => setViewing(null)}>
          <ChargeView
            charge={viewing.charge}
            confirmPath={`/api/admin/charges/${viewing.charge.id}/simulate-payment`}
            onPaid={() => {
              setViewing(null)
              reload()
            }}
          />
          <div className="gw-meta">
            <span>id no gateway</span>
            <code>{viewing.charge.externalId}</code>
            <span>emitida em</span>
            <code>{fmtDateTime(viewing.charge.createdAt)}</code>
          </div>
        </Modal>
      )}
    </>
  )
}
