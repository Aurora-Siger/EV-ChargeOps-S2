import { Hono } from 'hono'
import { billingService } from '../billing/billing.service.js'
import { stationsService } from './stations.service.js'

// Público: o mapa da landing também usa. Preço "agora" só existe para o carregador do
// condomínio (tarifa dinâmica); pontos externos mostram o preço informado pelo local.
export const stationsRoutes = new Hono()
  .get('/', async (c) => {
    const [stations, now] = await Promise.all([stationsService.list(), billingService.priceNow()])
    return c.json(
      stations.map((s) => ({
        ...s,
        priceNowCentsKwh: now && s.chargers.some((ch) => ch.id === now.chargerId) ? now.priceCentsKwh : null,
        priceLevelNow: now && s.chargers.some((ch) => ch.id === now.chargerId) ? now.level : null,
      })),
    )
  })
  .get('/:id', async (c) => c.json(await stationsService.get(c.req.param('id'))))
