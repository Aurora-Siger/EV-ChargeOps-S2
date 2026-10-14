/**
 * Comparação da fatura com a do mês anterior, já calculada e escrita, para o Volt só repetir.
 * Com os dois totais crus o modelo errava a conta e até a direção ("subiu R$ 7,50" num mês que
 * estava R$ 25,02 abaixo). Função pura.
 */
import { shiftPeriod } from '../../../shared/time.js'

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const brl = (cents: number) => `R$ ${(Math.abs(cents) / 100).toFixed(2).replace('.', ',')}`

export type InvoiceComparison = {
  previousPeriod: string
  previousTotalCents: number
  differenceCents: number
  direction: 'up' | 'down' | 'same'
  /** Mês ainda aberto: o total é só até agora e ainda pode subir. */
  partial: boolean
  /** Frase pronta, em português, para o agente repetir. */
  summary: string
}

/** `null` quando não há o que comparar (sem fatura neste mês ou no anterior). */
export function compareWithPrevious(args: {
  period: string
  totalCents: number | null
  previousTotalCents: number | null
  closed: boolean
}): InvoiceComparison | null {
  const { period, totalCents, previousTotalCents, closed } = args
  if (totalCents === null || previousTotalCents === null) return null

  const previousPeriod = shiftPeriod(period, -1)
  const month = MONTHS[Number(previousPeriod.slice(5)) - 1]
  const differenceCents = totalCents - previousTotalCents
  const direction = differenceCents > 0 ? 'up' : differenceCents < 0 ? 'down' : 'same'
  const base =
    direction === 'same'
      ? `o mesmo valor de ${month}`
      : `${brl(differenceCents)} a ${direction === 'up' ? 'mais' : 'menos'} que em ${month}`
  const summary = closed ? `${base}.` : `${base} até agora (o mês ainda está aberto e pode subir).`
  return { previousPeriod, previousTotalCents, differenceCents, direction, partial: !closed, summary }
}
