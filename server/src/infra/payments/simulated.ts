import { randomInt, randomUUID } from 'node:crypto'
import { fromLocal } from '../../shared/time.js'
import { buildBoleto } from './boleto.js'
import { buildBrCode } from './brcode.js'
import type { CreateChargeInput, CreatedCharge, PaymentGateway } from './gateway.js'

/** Banco fictício: nenhum banco real usa o código 999, então o boleto nunca é pagável. */
const SIM_BANK = '999'
const SIM_AGENCY = '0001'
const SIM_ACCOUNT = '0012345'

const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join('')

/**
 * Gateway de demonstração: gera Pix copia e cola e linha digitável com formato e dígitos
 * verificadores válidos, mas com chave Pix aleatória e banco inexistente, sem chamar
 * nenhum provedor. A confirmação do pagamento vem do botão "simular pagamento", no lugar do
 * webhook que o provedor real mandaria.
 */
export const simulatedGateway: PaymentGateway = {
  provider: 'simulado',
  canSimulatePayment: true,
  requiresDocument: false,

  async createCharge(i: CreateChargeInput): Promise<CreatedCharge> {
    const externalId = `pay_sim_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    if (i.method === 'PIX') {
      const [y, m, d] = i.dueDate.split('-').map(Number) as [number, number, number]
      return {
        externalId,
        // Pix com vencimento vale até o fim do dia do vencimento (horário do condomínio).
        pix: {
          payload: buildBrCode({
            key: randomUUID(),
            amountCents: i.amountCents,
            merchantName: i.merchant.name,
            merchantCity: i.merchant.city,
            txid: externalId,
            description: i.description,
          }),
          expiresAt: new Date(fromLocal(y, m, d + 1).getTime() - 1000),
        },
        boleto: null,
      }
    }
    // campo livre: carteira (2) + nosso número (11) + agência (4) + conta (7) + zero
    const nossoNumero = digits(11)
    const { barcode, digitableLine } = buildBoleto({
      bank: SIM_BANK,
      amountCents: i.amountCents,
      dueDate: i.dueDate,
      freeField: `09${nossoNumero}${SIM_AGENCY}${SIM_ACCOUNT}0`,
    })
    return { externalId, pix: null, boleto: { barcode, digitableLine, nossoNumero } }
  },

  async cancelCharge() {},
  async refundCharge() {},
}
