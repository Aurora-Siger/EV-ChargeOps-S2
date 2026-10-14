/**
 * Rate limit do chat do Volt: contador por chave numa janela fixa. Em memória, melhor-esforço
 * (vale por réplica — revisar se o serviço rodar com mais de uma).
 */
export function createRateLimiter(windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return {
    /** Conta uma mensagem da chave; `false` se ela passou de `max` na janela atual. */
    hit(key: string, max: number, now = Date.now()): boolean {
      // chave de visitante/IP é barata de gerar: limpa as janelas vencidas antes do mapa crescer
      if (hits.size > 10_000) for (const [k, e] of hits) if (e.resetAt <= now) hits.delete(k)
      const entry = hits.get(key)
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs })
        return true
      }
      entry.count += 1
      return entry.count <= max
    },
  }
}

/**
 * IP de quem chamou. Em produção o Cloudflare fica na frente e manda o IP real em
 * CF-Connecting-IP; sem ele, o proxy do Coolify (X-Real-IP / X-Forwarded-For).
 */
export function clientIp(header: (name: string) => string | undefined): string | null {
  for (const name of ['cf-connecting-ip', 'x-real-ip', 'x-forwarded-for']) {
    const ip = header(name)?.split(',')[0]?.trim()
    if (ip) return ip
  }
  return null
}
