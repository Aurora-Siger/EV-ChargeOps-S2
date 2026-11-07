/**
 * Planilha pra administradora: CSV no formato que o Excel em português abre direto (separador
 * ";", vírgula decimal, BOM pra manter os acentos). Gerado no navegador com o que a tela já tem.
 */
import { local } from './format'

type Cell = string | number | null | undefined

const cell = (v: Cell) => {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'number' ? String(v).replace('.', ',') : v
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Centavos em reais com vírgula ("1234" → "12,34"), sem "R$" pra planilha somar. */
export const csvMoney = (cents: number | null | undefined) => (cents === null || cents === undefined ? null : (cents / 100).toFixed(2).replace('.', ','))

export function downloadCsv(filename: string, header: string[], rows: Cell[][]) {
  const text = [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Data e hora no fuso do condomínio, com ano ("07/11/2026 21:30"). */
export function csvDateTime(d: string | Date) {
  const l = local(d)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(l.day)}/${p(l.month)}/${l.year} ${p(l.hour)}:${p(l.minute)}`
}
