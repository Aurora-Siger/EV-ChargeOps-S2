/**
 * Ociosidade da vaga: quanto tempo o carro ficou plugado DEPOIS que a carga terminou.
 * Funções puras: sem banco, sem rede.
 *
 * O log de sessões da SEMS só traz início e fim da entrega de energia; quando o cabo saiu não
 * aparece lá. Quem sabe é o status do carregador, que o coletor grava a cada poll (5 min):
 * `workState` = "available_gun_insered" (plugado sem carregar) ou "available_gun_no_insered"
 * (cabo fora). A ociosidade vai do fim da sessão até o ÚLTIMO status ainda plugado antes do
 * cabo sair — limite inferior, então o erro do poll nunca pesa contra o morador.
 */

export type PlugSample = { at: Date; plugged: boolean | null }

/** Cabo no carro? `null` para estados que a gente não sabe ler (não contam para nada). */
export function pluggedFromTelemetry(workState: string | null, status: string | null, vehConnStu: number | null = null): boolean | null {
  // `vehConnStu` (0 cabo fora, 1 plugado, 2 carregando) segue certo quando o `workState` congela.
  if (vehConnStu === 0 || vehConnStu === 1 || vehConnStu === 2) return vehConnStu > 0
  if (workState === 'charging' || status === 'charging') return true
  if (!workState) return null
  if (workState.endsWith('gun_no_insered')) return false
  if (workState.endsWith('gun_insered')) return true
  return null
}

/** Teto de sanidade: se nenhum status mostrar o cabo saindo, não cobra mais que isso. */
export const MAX_IDLE_MIN = 12 * 60

/**
 * Minutos ociosos de uma sessão que terminou em `endedAt`. `nextStartedAt` é o início da
 * sessão seguinte no mesmo carregador (o carro seguinte chegou: a ociosidade acabou antes).
 * `samples` em ordem cronológica.
 */
export function idleMinutes(endedAt: Date, nextStartedAt: Date | null, samples: PlugSample[]): number {
  const from = endedAt.getTime()
  const until = Math.min(nextStartedAt?.getTime() ?? Infinity, from + MAX_IDLE_MIN * 60_000)
  let lastPlugged: number | null = null
  for (const s of samples) {
    const t = s.at.getTime()
    if (t <= from) continue
    if (t > until) break
    if (s.plugged === false) break
    if (s.plugged === true) lastPlugged = t
  }
  return lastPlugged === null ? 0 : Math.floor((lastPlugged - from) / 60_000)
}
