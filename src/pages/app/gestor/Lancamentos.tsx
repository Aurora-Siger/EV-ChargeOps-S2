import { useState } from 'react'
import { fmtBRL, monthName } from '../../../lib/format'
import { api } from '../../../lib/http'
import type { Cycle, CycleEntry } from '../../../lib/types'
import { useAction } from '../../../lib/useAction'
import { Field } from '../ui'

type Kind = CycleEntry['kind']
type Sign = 'credito' | 'debito'

const cents = (v: string) => Math.round(Number(v.replace(/\./g, '').replace(',', '.')) * 100)

/**
 * Lançamentos do gestor no ciclo: despesa extra do mês (rateada como o custo fixo) ou ajuste
 * de uma pessoa (crédito ou débito só na fatura dela). Num ciclo já fechado, o server refaz as
 * faturas na hora; com fatura paga, os lançamentos ficam travados.
 */
export default function Lancamentos({
  cycle,
  period,
  canWrite,
  locked,
  onChanged,
}: {
  cycle: Cycle
  period: string
  canWrite: boolean
  locked: boolean
  onChanged: () => void
}) {
  const act = useAction()
  const [kind, setKind] = useState<Kind>('DESPESA')
  const [sign, setSign] = useState<Sign>('credito')
  const [userId, setUserId] = useState('')
  const [description, setDescription] = useState('')
  const [value, setValue] = useState('')
  const editable = canWrite && !locked
  const people = [...cycle.lines].sort((a, b) => (a.unitLabel ?? a.name).localeCompare(b.unitLabel ?? b.name))

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    const amount = cents(value)
    if (!Number.isFinite(amount) || amount <= 0) {
      act.setError('Informe um valor maior que zero')
      return
    }
    void act.run(async () => {
      await api(`/api/admin/billing/${period}/entries`, {
        method: 'POST',
        json: {
          kind,
          description,
          amountCents: kind === 'AJUSTE' && sign === 'credito' ? -amount : amount,
          userId: kind === 'AJUSTE' ? userId : null,
        },
      })
      setDescription('')
      setValue('')
      onChanged()
    })
  }

  const remove = (id: string) => {
    if (!confirm('Remover este lançamento?')) return
    void act.run(async () => {
      await api(`/api/admin/billing/${period}/entries/${id}`, { method: 'DELETE' })
      onChanged()
    })
  }

  return (
    <div className="c">
      <div className="c-label">Lançamentos de {monthName(period)}</div>
      {cycle.entries.length === 0 && (
        <div className="hint-line">
          Nenhum lançamento. Despesas extras do mês (manutenção, reparo) entram no rateio junto com o custo fixo;
          ajustes dão crédito ou cobram um valor de uma pessoa só.
        </div>
      )}
      {cycle.entries.map((e) => (
        <div className="act" key={e.id}>
          <div className="info">
            <div className="t">{e.description}</div>
            <div className="s">
              {e.kind === 'DESPESA'
                ? 'Despesa do mês · rateada entre os moradores ativos'
                : `${e.amountCents < 0 ? 'Crédito' : 'Débito'} para ${e.userName ?? 'morador'}`}
            </div>
          </div>
          <div className="val">
            {e.kind === 'AJUSTE' && e.amountCents < 0 ? '− ' : ''}
            {fmtBRL(Math.abs(e.amountCents))}
          </div>
          {editable && (
            <button className="btn btn-ghost btn-sm" disabled={act.busy} onClick={() => remove(e.id)}>
              Remover
            </button>
          )}
        </div>
      ))}

      {editable && (
        <form onSubmit={add} className="entry-form">
          <div className="seg seg-wide">
            <button type="button" className={kind === 'DESPESA' ? 'on' : ''} onClick={() => setKind('DESPESA')}>
              Despesa do mês
            </button>
            <button type="button" className={kind === 'AJUSTE' ? 'on' : ''} onClick={() => setKind('AJUSTE')}>
              Ajuste para morador
            </button>
          </div>
          {kind === 'AJUSTE' && (
            <div className="form-2">
              <Field label="Morador">
                <select value={userId} onChange={(e) => setUserId(e.target.value)} required>
                  <option value="">Escolha</option>
                  {people.map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.unitLabel ? `${p.unitLabel} · ${p.name}` : p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tipo">
                <select value={sign} onChange={(e) => setSign(e.target.value as Sign)}>
                  <option value="credito">Crédito (abate da fatura)</option>
                  <option value="debito">Débito (soma na fatura)</option>
                </select>
              </Field>
            </div>
          )}
          <div className="form-2">
            <Field label="Descrição" hint="Aparece na fatura de quem paga.">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={120}
                placeholder={kind === 'DESPESA' ? 'Manutenção do carregador' : 'Recarga cobrada em dobro'}
                required
              />
            </Field>
            <Field label="Valor (R$)">
              <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="0,00" required />
            </Field>
          </div>
          {act.error && <div className="login-error">{act.error}</div>}
          <button className="btn btn-primary btn-sm" disabled={act.busy}>
            Lançar
          </button>
          {cycle.closed && <div className="hint-line">As faturas já emitidas deste mês são refeitas com o lançamento.</div>}
        </form>
      )}
      {canWrite && locked && <div className="hint-line">Este ciclo já tem fatura paga: os lançamentos ficam travados.</div>}
    </div>
  )
}
