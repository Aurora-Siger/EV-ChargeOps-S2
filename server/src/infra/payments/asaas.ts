import { env } from '../../config/env.js'
import { AppError } from '../../shared/errors.js'
import type { CreateChargeInput, CreatedCharge, PaymentGateway } from './gateway.js'

const BASE = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  production: 'https://api.asaas.com/v3',
}

type AsaasErrorBody = { errors?: { code?: string; description?: string }[] }

async function call<T>(method: string, path: string, body?: unknown, opts: { okOn404?: boolean } = {}): Promise<T> {
  const res = await fetch(`${BASE[env.ASAAS_ENV]}${path}`, {
    method,
    headers: {
      access_token: env.ASAAS_API_KEY!,
      'Content-Type': 'application/json',
      'User-Agent': 'evchargeops',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 404 && opts.okOn404) return undefined as T
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as AsaasErrorBody
    const msg = err.errors?.map((e) => e.description).filter(Boolean).join('; ') || `HTTP ${res.status}`
    console.error(`[asaas] ${method} ${path} -> ${res.status}: ${msg}`)
    // 4xx é dado nosso (CPF inválido, vencimento...): devolve a mensagem do Asaas ao usuário.
    throw new AppError(`Asaas: ${msg}`, res.status >= 400 && res.status < 500 ? 422 : 502, 'GATEWAY')
  }
  return (await res.json()) as T
}

/** Cliente no Asaas, achado pelo id do usuário (externalReference) ou criado na primeira cobrança. */
async function customerId(c: CreateChargeInput['customer']): Promise<string> {
  const found = await call<{ data: { id: string }[] }>(
    'GET',
    `/customers?externalReference=${encodeURIComponent(c.id)}&limit=1`,
  )
  if (found.data[0]) return found.data[0].id
  const created = await call<{ id: string }>('POST', '/customers', {
    name: c.name,
    email: c.email,
    cpfCnpj: c.cpfCnpj,
    externalReference: c.id,
    notificationDisabled: true, // quem avisa o morador é o app, não o Asaas
  })
  return created.id
}

/** "2026-10-10 23:59:59" (horário de Brasília) -> Date. */
const brt = (s: string) => new Date(`${s.replace(' ', 'T')}-03:00`)

export const asaasGateway: PaymentGateway = {
  provider: 'asaas',
  canSimulatePayment: false,
  requiresDocument: true,

  async createCharge(i: CreateChargeInput): Promise<CreatedCharge> {
    if (!i.customer.cpfCnpj) {
      throw new AppError('Informe seu CPF/CNPJ no perfil para gerar a cobrança', 422, 'MISSING_DOCUMENT')
    }
    const payment = await call<{ id: string }>('POST', '/payments', {
      customer: await customerId(i.customer),
      billingType: i.method,
      value: i.amountCents / 100,
      dueDate: i.dueDate,
      description: i.description,
      externalReference: i.externalReference,
    })

    if (i.method === 'PIX') {
      const qr = await call<{ payload: string; expirationDate: string }>('GET', `/payments/${payment.id}/pixQrCode`)
      return { externalId: payment.id, pix: { payload: qr.payload, expiresAt: brt(qr.expirationDate) }, boleto: null }
    }
    const b = await call<{ identificationField: string; nossoNumero: string; barCode: string }>(
      'GET',
      `/payments/${payment.id}/identificationField`,
    )
    return {
      externalId: payment.id,
      pix: null,
      boleto: { digitableLine: b.identificationField, barcode: b.barCode, nossoNumero: b.nossoNumero },
    }
  },

  async cancelCharge(externalId) {
    await call('DELETE', `/payments/${externalId}`, undefined, { okOn404: true })
  },

  async refundCharge(externalId) {
    await call('POST', `/payments/${externalId}/refund`)
  },
}
