import { describe, expect, it } from 'vitest'
import { buildBoleto, dueFactor, mod10, mod11 } from './boleto.js'
import { buildBrCode, crc16 } from './brcode.js'
import { simulatedGateway } from './simulated.js'

describe('Pix copia e cola (BR Code)', () => {
  it('CRC16 bate com o exemplo do manual do BCB', () => {
    const body =
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304'
    expect(crc16(body)).toBe('1D3D')
  })

  it('monta os campos EMV com valor, nome sem acento e CRC no fim', () => {
    const code = buildBrCode({
      key: '123e4567-e12b-12d1-a456-426655440000',
      amountCents: 4287,
      merchantName: 'Edifício Aurora',
      merchantCity: 'São Paulo',
      txid: 'pay_sim_abc123',
    })
    expect(code.startsWith('000201010212')).toBe(true)
    expect(code).toContain('5405' + '42.87')
    expect(code).toContain('5915EDIFICIO AURORA')
    expect(code).toContain('6009SAO PAULO')
    expect(code).toContain('62160512paysimabc123')
    expect(code.slice(-4)).toBe(crc16(code.slice(0, -4)))
  })
})

describe('boleto', () => {
  it('fator de vencimento reinicia em 1000 depois de 21/02/2025', () => {
    expect(dueFactor('2000-07-03')).toBe('1000')
    expect(dueFactor('2025-02-21')).toBe('9999')
    expect(dueFactor('2025-02-22')).toBe('1000')
    expect(dueFactor('2026-10-10')).toBe(String(1000 + 595))
  })

  it('linha digitável carrega os dígitos verificadores de cada campo e o geral', () => {
    const freeField = '0912345678901000100123450'
    const { barcode, digitableLine } = buildBoleto({ bank: '999', amountCents: 4287, dueDate: '2026-10-10', freeField })
    expect(barcode).toHaveLength(44)
    expect(barcode.slice(0, 4)).toBe('9999')
    expect(barcode.slice(5, 9)).toBe('1595')
    expect(barcode.slice(9, 19)).toBe('0000004287')
    expect(barcode.slice(19)).toBe(freeField)
    expect(Number(barcode[4])).toBe(mod11(barcode.slice(0, 4) + barcode.slice(5)))

    const [f1, f2, f3, dv, f5] = digitableLine.split(' ').map((f) => f.replace('.', ''))
    for (const f of [f1!, f2!, f3!]) expect(Number(f.at(-1))).toBe(mod10(f.slice(0, -1)))
    expect(dv).toBe(barcode[4])
    expect(f5).toBe(barcode.slice(5, 19))
    expect(f1!.slice(0, 9) + f2!.slice(0, 10) + f3!.slice(0, 10)).toBe(barcode.slice(0, 4) + freeField)
  })
})

describe('gateway simulado', () => {
  const base = {
    amountCents: 4287,
    dueDate: '2026-10-10',
    description: 'Recarga EV setembro/2026',
    externalReference: 'inv_1',
    customer: { name: 'Ana', email: 'ana@demo' },
    merchant: { name: 'Edifício Aurora', city: 'Sao Paulo' },
  }

  it('Pix vence no fim do dia do vencimento, no horário do condomínio', async () => {
    const c = await simulatedGateway.createCharge({ ...base, method: 'PIX' })
    expect(c.boleto).toBeNull()
    expect(c.pix!.expiresAt.toISOString()).toBe('2026-10-11T02:59:59.000Z')
    expect(c.externalId).toMatch(/^pay_sim_/)
  })

  it('boleto sai com banco fictício 999', async () => {
    const c = await simulatedGateway.createCharge({ ...base, method: 'BOLETO' })
    expect(c.pix).toBeNull()
    expect(c.boleto!.barcode.startsWith('9999')).toBe(true)
    expect(c.boleto!.nossoNumero).toMatch(/^\d{11}$/)
  })
})

describe('BR Code com descrição longa', () => {
  it('corta a descrição para o campo 26 não passar de 99 caracteres', () => {
    const code = buildBrCode({
      key: '123e4567-e12b-12d1-a456-426655440000',
      amountCents: 100,
      merchantName: 'X',
      merchantCity: 'Y',
      txid: 't1',
      description: 'Recarga EV setembro/2026 Apto 1204 bloco B torre norte',
    })
    const len = Number(code.slice(code.indexOf('26', 12) + 2, code.indexOf('26', 12) + 4))
    expect(len).toBeLessThanOrEqual(99)
    expect(code.slice(-4)).toBe(crc16(code.slice(0, -4)))
  })
})
