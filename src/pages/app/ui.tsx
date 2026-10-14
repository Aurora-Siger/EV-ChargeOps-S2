import type { ReactNode } from 'react'

/* ── estados de tela ── */

export function Loading({ what = 'Carregando' }: { what?: string }) {
  return <div className="empty-card">{what}…</div>
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="empty-card err" role="alert">
      {error}
      {onRetry && (
        <button className="link-btn" onClick={onRetry} style={{ marginLeft: 8 }}>
          tentar de novo
        </button>
      )}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-inline">{children}</div>
}

/* ── formulários ── */

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className={wide ? 'modal wide' : 'modal'} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="link-btn" onClick={onClose} aria-label="Fechar">
            fechar
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Placa do veículo, no estilo de uma placa Mercosul real — ajuda o gestor a casar
 * visualmente cartão RFID → morador → carro numa atribuição manual. */
export function PlateChip({ plate }: { plate: string }) {
  return (
    <span className="plate-chip">
      <span className="flag">BR</span>
      <span className="num">{plate}</span>
    </span>
  )
}

/** Seletor de mês (ciclo de faturamento) com setas. */
export function PeriodPicker({ period, onChange, max }: { period: string; onChange: (p: string) => void; max: string }) {
  const [y, m] = period.split('-').map(Number)
  const label = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const shift = (d: number) => {
    const idx = y * 12 + (m - 1) + d
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
  }
  return (
    <div className="period-picker">
      <button onClick={() => onChange(shift(-1))} aria-label="Mês anterior">
        ‹
      </button>
      <span>{label}</span>
      <button onClick={() => onChange(shift(1))} disabled={period >= max} aria-label="Próximo mês">
        ›
      </button>
    </div>
  )
}
