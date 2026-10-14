import { env } from '../../config/env.js'
import { asaasGateway } from './asaas.js'
import type { PaymentGateway } from './gateway.js'
import { simulatedGateway } from './simulated.js'

const all: Record<string, PaymentGateway> = {
  [simulatedGateway.provider]: simulatedGateway,
  [asaasGateway.provider]: asaasGateway,
}

/** Gateway que emite as cobranças novas: Asaas quando há chave, senão o simulado (demo). */
export const activeGateway: PaymentGateway = env.ASAAS_API_KEY ? asaasGateway : simulatedGateway

/** Gateway que emitiu uma cobrança já existente (cancelar/estornar vai para quem criou). */
export const gatewayOf = (provider: string): PaymentGateway => {
  const g = all[provider]
  if (!g) throw new Error(`Provedor de cobrança desconhecido: ${provider}`)
  return g
}
