import type { ReactNode } from 'react'
import { fmtBRL, fmtDay, fmtKwh, fmtTime } from '../../lib/format'
import type { Reservation } from '../../lib/types'
import { I } from './icons'

const calPart = (iso: string, part: 'month' | 'day') =>
  new Date(iso)
    .toLocaleDateString('pt-BR', part === 'month' ? { month: 'short', timeZone: 'America/Sao_Paulo' } : { day: '2-digit', timeZone: 'America/Sao_Paulo' })
    .replace('.', '')

/** Card de uma reserva, igual no Início ("Sua próxima reserva") e em Agendar ("Minhas reservas"). */
export default function ReservationCard({ r, action }: { r: Reservation; action?: ReactNode }) {
  if (r.status === 'PENDING_PLUGIN') {
    return (
      <div className="resv">
        <div className="cal pending">{I.cal}</div>
        <div className="info">
          <div className="t">Meta {r.targetSoc}% até {fmtDay(r.deadlineAt)} {fmtTime(r.deadlineAt)}</div>
          <div className="s">aguardando o carro plugar pra escolher o horário</div>
        </div>
        {action}
      </div>
    )
  }
  return (
    <div className="resv">
      <div className="cal">
        <div className="m">{calPart(r.startsAt!, 'month')}</div>
        <div className="d">{calPart(r.startsAt!, 'day')}</div>
      </div>
      <div className="info">
        <div className="t">
          {fmtDay(r.startsAt!)} · {fmtTime(r.startsAt!)} – {r.startSoc === null && '~'}
          {fmtTime(r.endsAt!)}
        </div>
        {r.stationName && (
          <div className="s">
            {r.stationName}
            {r.stationAddress && ` · ${r.stationAddress}`}
          </div>
        )}
        <div className="s">
          {r.startSoc !== null
            ? `${r.startSoc}% → ${r.targetSoc}% · ${fmtKwh(r.energyKwh ?? 0)} · estimado ${fmtBRL(r.estimatedCostCents ?? 0)}`
            : r.stationKind === 'PARCEIRO'
              ? `meta ${r.targetSoc}% · estimado até ${fmtBRL(r.estimatedCostCents ?? 0)}`
              : `meta ${r.targetSoc}% · fim ajustado quando o carro plugar`}
        </div>
      </div>
      {action}
    </div>
  )
}
