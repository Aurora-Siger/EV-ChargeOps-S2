/**
 * Estimativas de carga mostradas na tela de agendar. A escolha da janela de horário em si é
 * sempre feita no servidor (`reservations.service`/`scheduling.ts`) — o front nunca calcula
 * nem fixa preço.
 */
import type { GoalKind, Vehicle } from './types'

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

/** O pedido de carga numa das três formas: `value` é a % (SOC), os kWh (KWH) ou os centavos (BRL). */
export type ChargeGoal = { kind: GoalKind; value: number }

export const GOAL_KINDS: GoalKind[] = ['SOC', 'KWH', 'BRL']
export const GOAL_KIND_LABEL: Record<GoalKind, string> = { SOC: 'Autonomia', KWH: 'Energia', BRL: 'Valor' }
/** Opções de cada forma; a primeira de cada lista é a que abre ao trocar de forma, exceto em SOC (80%). */
export const GOAL_OPTIONS: Record<'KWH' | 'BRL', number[]> = { KWH: [10, 20, 30], BRL: [1000, 2000, 4000] }
export const GOAL_DEFAULT: Record<GoalKind, number> = { SOC: 80, KWH: 20, BRL: 2000 }

/** Parâmetros da API pra um pedido (só um dos três vai). */
export function goalParams(g: ChargeGoal): { targetSoc: number } | { energyKwh: number } | { budgetCents: number } {
  return g.kind === 'SOC' ? { targetSoc: g.value } : g.kind === 'KWH' ? { energyKwh: g.value } : { budgetCents: g.value }
}

/** Quanto ainda cabe na bateria (kWh) a partir de `fromSoc`. */
export const roomKwh = (vehicle: Vehicle, fromSoc: number) => Math.max(0, ((100 - fromSoc) / 100) * vehicle.capacityKwh)

/** Autonomia (km) que `kwh` acrescenta, pela autonomia de carga cheia do cadastro (null sem ela). */
export const kmFor = (vehicle: Vehicle, kwh: number) =>
  vehicle.rangeKm ? Math.round((kwh / vehicle.capacityKwh) * vehicle.rangeKm) : null

/** Onde `kwh` leva a bateria saindo de `fromSoc`. */
export const socAfter = (vehicle: Vehicle, fromSoc: number, kwh: number) =>
  Math.min(100, Math.round(fromSoc + (kwh / vehicle.capacityKwh) * 100))
