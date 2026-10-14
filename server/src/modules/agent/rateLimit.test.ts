import { describe, expect, it } from 'vitest'
import { clientIp, createRateLimiter } from './rateLimit.js'

describe('createRateLimiter', () => {
  it('deixa passar até o máximo na janela e barra a seguinte', () => {
    const limiter = createRateLimiter(60_000)
    const results = Array.from({ length: 8 }, () => limiter.hit('v1', 7, 1_000))
    expect(results).toEqual([true, true, true, true, true, true, true, false])
  })

  it('janela nova zera o contador', () => {
    const limiter = createRateLimiter(60_000)
    for (let i = 0; i < 8; i++) limiter.hit('v1', 7, 1_000)
    expect(limiter.hit('v1', 7, 61_000)).toBe(true)
  })

  it('cada chave conta separado', () => {
    const limiter = createRateLimiter(60_000)
    for (let i = 0; i < 8; i++) limiter.hit('v1', 7, 1_000)
    expect(limiter.hit('v2', 7, 1_000)).toBe(true)
  })
})

describe('clientIp', () => {
  const headers = (h: Record<string, string>) => (name: string) => h[name]

  it('prefere o IP que o Cloudflare manda', () => {
    expect(clientIp(headers({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9' }))).toBe('1.1.1.1')
  })

  it('sem Cloudflare, usa o primeiro do X-Forwarded-For', () => {
    expect(clientIp(headers({ 'x-forwarded-for': '2.2.2.2, 10.0.0.1' }))).toBe('2.2.2.2')
  })

  it('sem cabeçalho nenhum, null', () => {
    expect(clientIp(headers({}))).toBeNull()
  })
})
