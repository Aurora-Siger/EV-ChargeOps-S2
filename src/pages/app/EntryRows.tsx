import { fmtBRL } from '../../lib/format'
import type { MyInvoice } from '../../lib/types'

/** Ajustes do gestor na fatura da pessoa, um por linha, com a descrição lançada. */
export default function EntryRows({ data }: { data: MyInvoice }) {
  return (
    <>
      {data.entries
        .filter((e) => e.kind === 'AJUSTE')
        .map((e) => (
          <div key={e.id} className={e.amountCents < 0 ? 'good' : undefined}>
            <span>Ajuste · {e.description}</span>
            <b>
              {e.amountCents < 0 ? '−' : '+'} {fmtBRL(Math.abs(e.amountCents))}
            </b>
          </div>
        ))}
    </>
  )
}
