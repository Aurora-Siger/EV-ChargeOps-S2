import { serve } from '@hono/node-server'
import { app } from './app.js'
import { env } from './config/env.js'
import { activeGateway } from './infra/payments/index.js'
import { onPollSuccess, startCollector } from './modules/sems/sems.collector.js'
import { sessionsService } from './modules/sessions/sessions.service.js'

serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`API em :${port}`)
  console.log(`Cobranças: gateway ${activeGateway.provider}${env.ASAAS_API_KEY ? ` (${env.ASAAS_ENV})` : ` — ASAAS_API_KEY ${process.env.ASAAS_API_KEY === undefined ? 'não definida neste container' : 'definida mas vazia (o \`$\` da chave foi expandido?)'}`}`)
})

// Instância única por enquanto (ver docs/ARCHITECTURE.md §8) — com réplicas,
// isso precisaria de lock distribuído para não pollar o gateway em paralelo.
// Cada coleta da SEMS vira charge_session (com rateio). Roda também na subida, para quem já
// tem log salvo (ou o seed de demo) ver as sessões mesmo com o login da SEMS fora do ar.
onPollSuccess(() => sessionsService.syncFromSems())
sessionsService.syncFromSems().catch((e) => console.error('Sincronização inicial de sessões falhou:', e))
void startCollector()
