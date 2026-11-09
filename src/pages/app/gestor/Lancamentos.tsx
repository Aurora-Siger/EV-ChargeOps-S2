import { useState } from 'react'
import { fmtBRL, monthName } from '../../../lib/format'
import { t } from '../../../lib/i18n'
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
      act.setError(t('Informe um valor maior que zero', 'Enter an amount greater than zero'))
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
    if (!confirm(t('Remover este lançamento?', 'Remove this entry?'))) return
    void act.run(async () => {
      await api(`/api/admin/billing/${period}/entries/${id}`, { method: 'DELETE' })
      onChanged()
    })
  }

  return (
    <div className="c">
      <div className="c-label">{t(`Lançamentos de ${monthName(period)}`, `Entries for ${monthName(period)}`)}</div>
      {cycle.entries.length === 0 && (
        <div className="hint-line">
          {t(
            'Nenhum lançamento. Despesas extras do mês (manutenção, reparo) entram no rateio junto com o custo fixo; ajustes dão crédito ou cobram um valor de uma pessoa só.',
            'No entries. Extra expenses for the month (maintenance, repairs) are split along with the fixed cost; adjustments credit or charge a single person.',
          )}
        </div>
      )}
      {cycle.entries.map((e) => (
        <div className="act" key={e.id}>
          <div className="info">
            <div className="t">{e.description}</div>
            <div className="s">
              {e.kind === 'DESPESA'
                ? t('Despesa do mês · rateada entre os moradores ativos', 'Monthly expense · split among active residents')
                : `${e.amountCents < 0 ? t('Crédito', 'Credit') : t('Débito', 'Debit')} ${t('para', 'for')} ${e.userName ?? t('morador', 'resident')}`}
            </div>
          </div>
          <div className="val">
            {e.kind === 'AJUSTE' && e.amountCents < 0 ? '− ' : ''}
            {fmtBRL(Math.abs(e.amountCents))}
          </div>
          {editable && (
            <button className="btn btn-ghost btn-sm" disabled={act.busy} onClick={() => remove(e.id)}>
              {t('Remover', 'Remove')}
            </button>
          )}
        </div>
      ))}

      {editable && (
        <form onSubmit={add} className="entry-form">
          <div className="seg seg-wide">
            <button type="button" className={kind === 'DESPESA' ? 'on' : ''} onClick={() => setKind('DESPESA')}>
              {t('Despesa do mês', 'Monthly expense')}
            </button>
            <button type="button" className={kind === 'AJUSTE' ? 'on' : ''} onClick={() => setKind('AJUSTE')}>
              {t('Ajuste para morador', 'Adjustment for a resident')}
            </button>
          </div>
          {kind === 'AJUSTE' && (
            <div className="form-2">
              <Field label={t('Morador', 'Resident')}>
                <select value={userId} onChange={(e) => setUserId(e.target.value)} required>
                  <option value="">{t('Escolha', 'Choose')}</option>
                  {people.map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.unitLabel ? `${p.unitLabel} · ${p.name}` : p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('Tipo', 'Type')}>
                <select value={sign} onChange={(e) => setSign(e.target.value as Sign)}>
                  <option value="credito">{t('Crédito (abate da fatura)', 'Credit (deducted from the bill)')}</option>
                  <option value="debito">{t('Débito (soma na fatura)', 'Debit (added to the bill)')}</option>
                </select>
              </Field>
            </div>
          )}
          <div className="form-2">
            <Field label={t('Descrição', 'Description')} hint={t('Aparece na fatura de quem paga.', 'Shows on the bill of whoever pays.')}>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={120}
                placeholder={kind === 'DESPESA' ? t('Manutenção do carregador', 'Charger maintenance') : t('Recarga cobrada em dobro', 'Charge billed twice')}
                required
              />
            </Field>
            <Field label={t('Valor (R$)', 'Amount (R$)')}>
              <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="0,00" required />
            </Field>
          </div>
          {act.error && <div className="login-error">{act.error}</div>}
          <button className="btn btn-primary btn-sm" disabled={act.busy}>
            {t('Lançar', 'Add')}
          </button>
          {cycle.closed && <div className="hint-line">{t('As faturas já emitidas deste mês são refeitas com o lançamento.', 'Bills already issued this month are redone with the entry.')}</div>}
        </form>
      )}
      {canWrite && locked && <div className="hint-line">{t('Este ciclo já tem fatura paga: os lançamentos ficam travados.', 'This cycle already has a paid bill: entries are locked.')}</div>}
    </div>
  )
}
