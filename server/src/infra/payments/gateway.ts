/**
 * Porta de saída para o provedor de cobrança. O domínio (modules/charges) só conhece esta
 * interface; hoje quem a implementa é o gateway simulado. Os campos seguem a API de
 * cobranças do Asaas (POST /payments, GET /payments/{id}/pixQrCode e /identificationField),
 * então um adaptador real troca só este arquivo de implementação.
 */
export type ChargeMethod = 'PIX' | 'BOLETO'

export type CreateChargeInput = {
  method: ChargeMethod
  amountCents: number
  dueDate: string // AAAA-MM-DD
  description: string
  externalReference: string // id da fatura no nosso banco
  customer: { id: string; name: string; email: string; cpfCnpj: string | null }
  merchant: { name: string; city: string }
}

export type CreatedCharge = {
  externalId: string
  pix: { payload: string; expiresAt: Date } | null
  boleto: { digitableLine: string; barcode: string; nossoNumero: string } | null
}

export interface PaymentGateway {
  readonly provider: string
  /** true quando o pagamento pode ser confirmado de dentro do app (só no simulado). */
  readonly canSimulatePayment: boolean
  /** true quando o provedor exige CPF/CNPJ do pagador para emitir (Asaas). */
  readonly requiresDocument: boolean
  createCharge(input: CreateChargeInput): Promise<CreatedCharge>
  cancelCharge(externalId: string): Promise<void>
  refundCharge(externalId: string): Promise<void>
}
