import { serveStatic } from '@hono/node-server/serve-static'
import type { Hono } from 'hono'

const ROOT = './public' // build do Vite, copiado pelo Dockerfile

/** Serve o front (SPA). Deve ser registrado DEPOIS de todas as rotas da API. */
export function mountFrontend(app: Hono) {
  // Rota de API inexistente devolve 404 JSON, nunca o index.html do SPA.
  app.all('/api/*', (c) => c.json({ error: 'NOT_FOUND' }, 404))
  app.all('/internal/*', (c) => c.json({ error: 'NOT_FOUND' }, 404))

  // Arquivos com hash no nome: cache longo. Se não existir (deploy novo,
  // index.html antigo em cache no browser apontando pro hash antigo),
  // devolve 404 de verdade — nunca o index.html do SPA, senão o browser
  // recebe HTML onde esperava JS/CSS ("Failed to load module script …
  // MIME type text/html").
  app.use('/assets/*', async (c, next) => {
    await next()
    if (c.res.ok) c.res.headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  })
  app.use('/assets/*', serveStatic({ root: ROOT }))
  app.all('/assets/*', (c) => c.json({ error: 'NOT_FOUND' }, 404))

  // Tudo fora de /assets (o index.html em `/` e os arquivos soltos de public/) sem cache: o HTML
  // aponta para os hashes do build atual, então um index.html velho em cache quebra o CSS/JS.
  app.use('*', async (c, next) => {
    await next()
    if (c.res.ok && !c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-cache')
  })
  app.use('*', serveStatic({ root: ROOT }))

  // Fallback do react-router: qualquer outra rota volta o index.html, sem cache.
  app.get(
    '*',
    async (c, next) => {
      await next()
      c.res.headers.set('Cache-Control', 'no-cache')
    },
    serveStatic({ path: `${ROOT}/index.html` }),
  )
}
