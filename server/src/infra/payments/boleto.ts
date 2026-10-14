/**
 * Código de barras e linha digitável de boleto de cobrança (padrão FEBRABAN, 44 dígitos),
 * com os dígitos verificadores de verdade. Só o banco e o campo livre são inventados.
 */

/** Dígito da linha digitável: módulo 10, pesos 2,1,2,1… da direita para a esquerda. */
export function mod10(digits: string): number {
  let sum = 0
  let weight = 2
  for (let i = digits.length - 1; i >= 0; i--) {
    const p = Number(digits[i]) * weight
    sum += p > 9 ? Math.floor(p / 10) + (p % 10) : p
    weight = weight === 2 ? 1 : 2
  }
  return (10 - (sum % 10)) % 10
}

/** Dígito geral do código de barras: módulo 11, pesos 2..9; 0, 10 e 11 viram 1. */
export function mod11(digits: string): number {
  let sum = 0
  let weight = 2
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const dv = 11 - (sum % 11)
  return dv === 0 || dv >= 10 ? 1 : dv
}

const DAY_MS = 86_400_000
const BASE = Date.UTC(1997, 9, 7)

/**
 * Fator de vencimento: dias desde 07/10/1997. Chegou a 9999 em 21/02/2025 e reiniciou em 1000
 * no dia seguinte (regra FEBRABAN), então passa a contar em ciclos de 9000 dias.
 */
export function dueFactor(dueDate: string): string {
  const [y, m, d] = dueDate.split('-').map(Number) as [number, number, number]
  const days = Math.round((Date.UTC(y, m - 1, d) - BASE) / DAY_MS)
  const factor = days < 10_000 ? days : ((days - 10_000) % 9000) + 1000
  return String(factor).padStart(4, '0')
}

export type BoletoInput = {
  bank: string // 3 dígitos
  amountCents: number
  dueDate: string // AAAA-MM-DD
  freeField: string // 25 dígitos, formato de cada banco (carteira, nosso número, agência, conta)
}

export function buildBoleto(i: BoletoInput): { barcode: string; digitableLine: string } {
  if (!/^\d{3}$/.test(i.bank) || !/^\d{25}$/.test(i.freeField)) throw new Error('boleto: banco ou campo livre inválido')
  const value = String(i.amountCents).padStart(10, '0')
  if (value.length > 10) throw new Error('boleto: valor acima do limite')
  const head = `${i.bank}9` // 9 = real
  const tail = dueFactor(i.dueDate) + value
  const dv = mod11(head + tail + i.freeField)
  const barcode = `${head}${dv}${tail}${i.freeField}`

  const f1 = head + i.freeField.slice(0, 5)
  const f2 = i.freeField.slice(5, 15)
  const f3 = i.freeField.slice(15, 25)
  const withDv = (f: string) => f + mod10(f)
  const [a, b, c] = [withDv(f1), withDv(f2), withDv(f3)]
  const digitableLine = `${a.slice(0, 5)}.${a.slice(5)} ${b.slice(0, 5)}.${b.slice(5)} ${c.slice(0, 5)}.${c.slice(5)} ${dv} ${tail}`
  return { barcode, digitableLine }
}
