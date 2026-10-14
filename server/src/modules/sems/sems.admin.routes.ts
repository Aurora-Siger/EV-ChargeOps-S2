import fs from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { setCredentials } from '../../infra/sems/client.js'
import { AppError } from '../../shared/errors.js'
import { pollOnce, relogin, semsState } from './sems.collector.js'

/**
 * Operação manual do coletor SEMS+ (relogin, troca de token, debug do login).
 * Não fica sob /api/* (sem CORS, não é para o browser)
 * nem sob /internal/* (esse é só para as tools do agente Python).
 */
const adminOnly = createMiddleware(async (c, next) => {
  if (c.req.header('X-Admin-Key') !== env.ADMIN_KEY) throw new AppError('admin key inválida', 401, 'UNAUTHORIZED')
  await next()
})

async function latestDebugFile(suffix: string): Promise<string | null> {
  try {
    const files = (await fs.readdir(env.SEMS_DEBUG_DIR)).filter((f) => f.endsWith(suffix)).sort()
    const last = files.at(-1)
    return last ? path.join(env.SEMS_DEBUG_DIR, last) : null
  } catch {
    return null
  }
}

export const semsAdminRoutes = new Hono()
  .use(adminOnly)
  // Força um login headless novo (usa SEMS_ACCOUNT/SEMS_PASSWORD).
  .post('/relogin', async (c) => {
    if (!(await relogin())) throw new AppError(`login falhou: ${semsState.lastError}`, 400, 'LOGIN_FAILED')
    try {
      const { warnings } = await pollOnce()
      semsState.tokenOk = true
      semsState.lastError = warnings.length ? warnings.join('; ') : null
      semsState.lastPoll = new Date().toISOString()
    } catch (e) {
      throw new AppError(`login ok mas poll falhou: ${e instanceof Error ? e.message : e}`, 400, 'POLL_FAILED')
    }
    return c.json({ ok: true, last_login: semsState.lastLogin })
  })
  // Atualiza token/X-Signature em runtime, fallback p/ quando o captcha bloqueia o login automático.
  .post('/token', async (c) => {
    const body = z.object({ token: z.string(), signature: z.string() }).parse(await c.req.json())
    setCredentials(body.token, body.signature)
    try {
      const { warnings } = await pollOnce()
      semsState.tokenOk = true
      semsState.lastError = warnings.length ? warnings.join('; ') : null
      semsState.lastPoll = new Date().toISOString()
      return c.json({ ok: true })
    } catch (e) {
      semsState.tokenOk = false
      semsState.lastError = e instanceof Error ? e.message : String(e)
      throw new AppError(`token novo falhou: ${semsState.lastError}`, 400, 'TOKEN_REJECTED')
    }
  })
  // Screenshot/HTML da página no momento da última falha de login headless.
  .get('/debug/login-screenshot', async () => {
    const file = await latestDebugFile('.png')
    if (!file) throw new AppError('nenhum debug de login salvo ainda', 404, 'NOT_FOUND')
    return new Response(await fs.readFile(file), { headers: { 'Content-Type': 'image/png' } })
  })
  .get('/debug/login-html', async () => {
    const file = await latestDebugFile('.html')
    if (!file) throw new AppError('nenhum debug de login salvo ainda', 404, 'NOT_FOUND')
    return new Response(await fs.readFile(file, 'utf-8'), { headers: { 'Content-Type': 'text/html' } })
  })
