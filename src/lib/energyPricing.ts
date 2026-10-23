/**
 * Estimativas de carga mostradas na tela de agendar. A escolha da janela de horário em si é
 * sempre feita no servidor (`reservations.service`/`scheduling.ts`) — o front nunca calcula
 * nem fixa preço.
 */
import type { Vehicle } from './types'

/** Metas de bateria oferecidas como pré-seleção */
export const TARGETS = [60, 80, 100]

/** Só faz sentido oferecer metas acima da bateria atual */
export function availableTargets(battery: number) {
  return TARGETS.filter((t) => t > battery + 1)
}

/** Pra que serve cada meta — 80% é a recomendação dos fabricantes pro dia a dia (preserva a bateria). */
export const TARGET_USE: Record<number, string> = { 60: 'curto', 80: 'dia a dia', 100: 'viagem' }

/**
 * Autonomia (km) com a bateria em `pct`%, proporcional à autonomia de carga cheia do cadastro.
 * null quando o carro não tem autonomia cadastrada — aí a tela mostra kWh em vez de inventar km.
 */
export function rangeAt(vehicle: Vehicle, pct: number) {
  return vehicle.rangeKm ? Math.round((vehicle.rangeKm * pct) / 100) : null
}
