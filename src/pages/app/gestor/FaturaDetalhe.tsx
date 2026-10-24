import {
  CHARGE_LABEL,
  CHARGE_TAG,
  fmtBRL,
  fmtDateTime,
  fmtDay,
  fmtDueDate,
  fmtKwh,
  fmtMinutes,
  fmtMult,
  fmtTime,
  LEVEL_LABEL,
  METHOD_LABEL,
  monthName,
  shiftPeriod,
  STATE_LABEL,
  STATE_TAG,
} from '../../../lib/format'
import type { CycleLine, MyInvoice } from '../../../lib/types'
import { useApi } from '../../../lib/useApi'
import EntryRows from '../EntryRows'
import { Empty, ErrorBox, Loading, Modal } from '../ui'

/** Barra de uma linha do rateio: energia cobrada, parcela fixa líquida e crédito devolvido. */
export function LineSplit({ line }: { line: CycleLine }) {
  const fixedNet = Math.max(line.fixedShareCents - line.creditCents, 0)
  const total = line.chargedCents + fixedNet + line.creditCents || 1
  const pct = (v: number) => `${(v / total) * 100}%`
  return (
    <div className="line-split" aria-hidden="true">
      <div style={{ width: pct(line.chargedCents), background: 'var(--pink)' }} />
      <div style={{ width: pct(line.creditCents), background: 'var(--amber)' }} />
      <div style={{ width: pct(fixedNet), background: 'var(--text3)' }} />
    </div>
  )
}

/**
 * Composição completa da fatura de um morador para o gestor: de onde vem cada centavo
 * (energia a custo, sobretaxa do horário, parcela fixa, crédito), recarga por recarga,
 * comparação com o mês anterior e as cobranças emitidas.
 */
export default function FaturaDetalhe({ line, period, onClose }: { line: CycleLine; period: string; onClose: () => void }) {
  const { data, error, loading, reload } = useApi<MyInvoice>(`/api/admin/users/${line.userId}/invoice?period=${period}`)
  const title = line.unitLabel ? `${line.unitLabel} · ${line.name}` : line.name

  return (
    <Modal title={title} onClose={onClose} wide>
      {loading && !data && <Loading />}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {data && <Detail data={data} period={period} />}
    </Modal>
  )
}

function Detail({ data, period }: { data: MyInvoice; period: string }) {
  const l = data.line
  if (!l || (!l.active && l.adjustmentCents === 0)) {
    return <Empty>Sem recargas em {monthName(period)}: isento da parcela fixa neste ciclo.</Empty>
  }

  const s = data.sessions
  const surcharge = l.chargedCents - l.energyCostCents // pago acima (ou abaixo) do custo real
  const avgPrice = l.energyKwh > 0 ? l.chargedCents / l.energyKwh : 0
  const avgCost = l.energyKwh > 0 ? l.energyCostCents / l.energyKwh : 0
  const kwhBy = (lv: 'cheap' | 'mid' | 'peak') => s.filter((x) => x.level === lv).reduce((a, x) => a + x.energyKwh, 0)
  const byLevel = (['cheap', 'mid', 'peak'] as const).map((lv) => ({ lv, kwh: kwhBy(lv) })).filter((x) => x.kwh > 0)
  const kwhTotal = byLevel.reduce((a, x) => a + x.kwh, 0) || 1
  const idleMin = s.reduce((a, x) => a + x.idleMin, 0)
  const diff = data.previousTotalCents != null ? l.totalCents - data.previousTotalCents : null
  const charges = data.charges.filter((c) => c.status !== 'CANCELLED')

  return (
    <div className="inv-detail">
      <div className="inv-head">
        <div>
          <div className="inv-total">{fmtBRL(l.totalCents)}</div>
          <div className="inv-sub">
            {monthName(period)} · {l.status === 'OPEN' ? `ciclo aberto, vence ${fmtDueDate(l.dueDate)}` : `vence ${fmtDueDate(l.dueDate)}`}
            {diff !== null && diff !== 0 && (
              <span className={diff > 0 ? 'up' : 'down'}>
                {' '}
                · {diff > 0 ? '▲' : '▼'} {fmtBRL(Math.abs(diff))} vs {monthName(shiftPeriod(period, -1))}
              </span>
            )}
          </div>
        </div>
        <span className={`ptag ${STATE_TAG[l.status]}`}>{STATE_LABEL[l.status]}</span>
      </div>

      <div className="inv-stats">
        <div>
          <small>Energia</small>
          <b>{fmtKwh(l.energyKwh)}</b>
          <span>
            {l.sessionsCount} {l.sessionsCount === 1 ? 'recarga' : 'recargas'}
          </span>
        </div>
        <div>
          <small>Preço médio</small>
          <b>{fmtBRL(Math.round(avgPrice))}/kWh</b>
          <span>custo {fmtBRL(Math.round(avgCost))}/kWh</span>
        </div>
        <div>
          <small>Ociosidade</small>
          <b>{idleMin ? fmtMinutes(idleMin) : '—'}</b>
          <span>plugado sem carregar</span>
        </div>
      </div>

      {byLevel.length > 0 && (
        <div className="inv-block">
          <div className="c-label">Quando carregou</div>
          <div className="bill-split">
            {byLevel.map((x) => (
              <div key={x.lv} className={`lv-${x.lv}`} style={{ width: `${(x.kwh / kwhTotal) * 100}%` }} />
            ))}
          </div>
          <div className="bill-legend">
            {byLevel.map((x) => (
              <span key={x.lv}>
                <span className={`sw lv-${x.lv}`} />
                {LEVEL_LABEL[x.lv]} · {fmtKwh(x.kwh)} ({Math.round((x.kwh / kwhTotal) * 100)}%)
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="inv-block">
        <div className="c-label">Composição do valor</div>
        <div className="calc-rows">
          <div>
            <span>Energia a preço de custo · {fmtKwh(l.energyKwh)} × tarifa base</span>
            <b>{fmtBRL(l.energyCostCents)}</b>
          </div>
          <div>
            <span>
              Ajuste da tarifa dinâmica · mult por horário{idleMin > 0 ? ' e ociosidade' : ''} (
              {surcharge >= 0 ? 'acima' : 'abaixo'} do custo)
            </span>
            <b>
              {surcharge >= 0 ? '+' : '−'} {fmtBRL(Math.abs(surcharge))}
            </b>
          </div>
          <div className="sub">
            <span>= Energia cobrada</span>
            <b>{fmtBRL(l.chargedCents)}</b>
          </div>
          <div>
            <span>
              {l.kind === 'CONVIDADO' ? (
                'Parcela fixa · convidado não entra no rateio'
              ) : (
                <>
                  Parcela fixa · {fmtBRL(data.fixedSplitCents)} ÷ {data.activeUsers}{' '}
                  {data.activeUsers === 1 ? 'morador ativo' : 'moradores ativos'}
                  {data.expensesCents > 0 && ` (inclui ${fmtBRL(data.expensesCents)} de despesas do mês)`}
                </>
              )}
            </span>
            <b>+ {fmtBRL(l.fixedShareCents)}</b>
          </div>
          <div className="good">
            <span>Crédito do excedente (volta na parcela fixa, até zerá-la)</span>
            <b>− {fmtBRL(l.creditCents)}</b>
          </div>
          <EntryRows data={data} />
          <div className="total">
            <span>Total</span>
            <b>{fmtBRL(l.totalCents)}</b>
          </div>
        </div>
      </div>

      <div className="inv-block">
        <div className="c-label">Recarga por recarga</div>
        <div className="inv-table" role="table">
          <div className="inv-tr th" role="row">
            <span>Quando</span>
            <span>kWh</span>
            <span>Mult</span>
            <span>Custo</span>
            <span>Cobrado</span>
          </div>
          {s.map((x) => (
            <div className="inv-tr" role="row" key={x.id}>
              <span>
                {fmtDay(x.startedAt)} {fmtTime(x.startedAt)}
                {x.level && <i className={`dot lv-${x.level}`} title={LEVEL_LABEL[x.level]} />}
              </span>
              <span>{x.energyKwh.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</span>
              <span>{x.mult !== null ? fmtMult(x.mult) : '—'}</span>
              <span>{x.energyCostCents !== null ? fmtBRL(x.energyCostCents) : '—'}</span>
              <b>{x.chargedCents !== null ? fmtBRL(x.chargedCents) : '—'}</b>
            </div>
          ))}
        </div>
      </div>

      {charges.length > 0 && (
        <div className="inv-block">
          <div className="c-label">Cobranças</div>
          {charges.map((c) => (
            <div className="inv-charge" key={c.id}>
              <span>
                {METHOD_LABEL[c.method]} · {fmtBRL(c.amountCents)}
                {c.paidAt ? ` · pago em ${fmtDateTime(c.paidAt)}` : ` · vence ${fmtDueDate(c.dueDate)}`}
              </span>
              <span className={`ptag ${CHARGE_TAG[c.status]}`}>{CHARGE_LABEL[c.status]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
