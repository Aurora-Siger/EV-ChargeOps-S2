import { useEffect, useRef, useState } from 'react'
import { CHARGE_LABEL, CHARGE_TAG, fmtBRL, fmtDateTime, fmtDueDate, METHOD_LABEL } from '../../lib/format'
import { api, ApiError } from '../../lib/http'
import type { Charge, ChargeMethod, CycleLine } from '../../lib/types'
import { useAction } from '../../lib/useAction'
import { I } from './icons'

/* ── copiar ── */

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // http sem clipboard API (ex.: rede local): seleciona pra copiar na mão
      const ta = document.createElement('textarea')
      ta.value = value
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1800)
  }
  return (
    <div className="copy-field">
      <code>{value}</code>
      <button className={`btn btn-sm btn-ghost copy-btn ${copied ? 'copied' : ''}`} onClick={copy} aria-label={`Copiar ${label}`}>
        <span className="copy-lbl idle" aria-hidden={copied}>
          Copiar
        </span>
        <span className="copy-lbl done" aria-hidden={!copied}>
          {I.check} Copiado
        </span>
        <span className="sr-only" role="status">
          {copied ? 'Copiado' : ''}
        </span>
      </button>
    </div>
  )
}

/* ── uma cobrança: QR do Pix ou linha do boleto ── */

export function ChargeView({
  charge,
  onPaid,
  confirmPath,
}: {
  charge: Charge
  onPaid: () => void
  /** rota que confirma o pagamento (a do morador ou a do gestor) */
  confirmPath: string
}) {
  const act = useAction()
  const open = charge.status === 'PENDING'

  const pay = () =>
    act.run(async () => {
      await api(confirmPath, { method: 'POST' })
      onPaid()
    })

  return (
    <div className="charge-view">
      <div className="charge-head">
        <span>
          {METHOD_LABEL[charge.method]} · vence {fmtDueDate(charge.dueDate)}
        </span>
        <span className={`ptag ${CHARGE_TAG[charge.status]}`}>{CHARGE_LABEL[charge.status]}</span>
      </div>

      {charge.pix && (
        <>
          {charge.pix.qrCodeImage && (
            <div className="pix-qr">
              <img src={charge.pix.qrCodeImage} alt="QR code do Pix" width={200} height={200} />
            </div>
          )}
          {open && (
            <>
              <div className="pay-hint">Abra o app do banco, escolha Pix e aponte a câmera, ou use o copia e cola:</div>
              <CopyField value={charge.pix.payload} label="código" />
              <div className="pay-hint">Compensa na hora · válido até {fmtDateTime(charge.pix.expiresAt)}</div>
            </>
          )}
        </>
      )}

      {charge.boleto && (
        open && (
          <>
            <div className="pay-hint">Pague no app do banco ou no internet banking com a linha digitável:</div>
            <CopyField value={charge.boleto.digitableLine} label="linha" />
            <div className="pay-hint">Compensa em até 2 dias úteis</div>
          </>
        )
      )}

      {charge.status === 'RECEIVED' && charge.paidAt && <div className="pay-hint">Pago em {fmtDateTime(charge.paidAt)}</div>}

      {open && charge.canSimulatePayment && (
        <button className="btn btn-ghost btn-sm pay-confirm" onClick={pay} disabled={act.busy}>
          {act.busy ? 'Confirmando…' : 'Confirmar pagamento'}
        </button>
      )}
      {act.error && <div className="login-error">{act.error}</div>}
    </div>
  )
}

/* ── card de pagamento da fatura do morador ── */

export function PaymentCard({
  line,
  charges,
  reload,
}: {
  line: CycleLine
  charges: Charge[]
  reload: () => void
}) {
  const [method, setMethod] = useState<ChargeMethod>(
    charges.find((c) => c.status === 'PENDING' || c.status === 'OVERDUE')?.method ?? 'PIX',
  )
  const act = useAction()
  const [needDoc, setNeedDoc] = useState(false)
  const [doc, setDoc] = useState('')

  if (!line.active || line.status === 'EXEMPT') return null

  if (line.status === 'OPEN') {
    return (
      <div className="c">
        <div className="c-label">Pagamento</div>
        <div className="pay-wait">
          {I.wallet}
          <span>
            O Pix e o boleto saem quando o condomínio fechar o ciclo. O vencimento é {fmtDueDate(line.dueDate)}.
          </span>
        </div>
      </div>
    )
  }

  if (line.status === 'PAID') {
    const paid = charges.find((c) => c.status === 'RECEIVED')
    return (
      <div className="c pay-done">
        <div className="pay-ok">{I.check}</div>
        <div>
          <b>Fatura paga</b>
          <span>
            {paid
              ? `${METHOD_LABEL[paid.method]} de ${fmtBRL(paid.amountCents)} confirmado em ${fmtDateTime(paid.paidAt!)}`
              : 'Baixa registrada pelo gestor do condomínio'}
          </span>
        </div>
      </div>
    )
  }

  const current = charges.find((c) => c.method === method && (c.status === 'PENDING' || c.status === 'OVERDUE'))
  const issue = () =>
    act.run(async () => {
      try {
        if (needDoc) await api('/api/me/document', { method: 'PUT', json: { cpfCnpj: doc } })
        await api(`/api/me/invoices/${line.invoiceId}/charges`, { method: 'POST', json: { method } })
        setNeedDoc(false)
        reload()
      } catch (e) {
        // O provedor exige CPF/CNPJ do pagador; pede uma vez e guarda no perfil.
        if (e instanceof ApiError && e.code === 'MISSING_DOCUMENT') setNeedDoc(true)
        throw e
      }
    })

  return (
    <div className="c">
      <div className="c-label row-between">
        Pagar {fmtBRL(line.totalCents)}
        <span className="seg">
          {(['PIX', 'BOLETO'] as const).map((m) => (
            <button key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>
              {METHOD_LABEL[m]}
            </button>
          ))}
        </span>
      </div>

      {current && current.status === 'PENDING' ? (
        <ChargeView
          key={current.id}
          charge={current}
          onPaid={reload}
          confirmPath={`/api/me/charges/${current.id}/simulate-payment`}
        />
      ) : (
        <div className="pay-issue">
          <span>
            {current
              ? 'Essa cobrança venceu. Gere uma nova, com vencimento hoje.'
              : method === 'PIX'
                ? 'Gere um QR code Pix. O pagamento compensa na hora.'
                : 'Gere um boleto. Ele compensa em até 2 dias úteis.'}
          </span>
          {needDoc && (
            <input
              className="input"
              inputMode="numeric"
              placeholder="CPF ou CNPJ"
              value={doc}
              onChange={(e) => setDoc(e.target.value)}
            />
          )}
          <button className="btn btn-primary btn-sm" onClick={issue} disabled={act.busy}>
            {act.busy ? 'Gerando…' : method === 'PIX' ? 'Gerar Pix' : 'Gerar boleto'}
          </button>
        </div>
      )}
      {act.error && <div className="login-error">{act.error}</div>}
    </div>
  )
}
