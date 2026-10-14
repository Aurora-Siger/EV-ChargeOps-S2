import { useEffect, useMemo, useState } from 'react'
import { toChargePoint, type ChargePoint } from './chargePoints'
import { api } from './http'
import type { Station } from './types'

/**
 * Estações do mapa (rota pública: a landing também usa). `myWorkspaces`: condomínios da pessoa
 * logada, para separar "seu condomínio" dos outros da rede.
 */
export function useChargePoints(myWorkspaces?: string[]) {
  const [stations, setStations] = useState<Station[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<Station[]>('/api/stations')
      .then(setStations)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const key = myWorkspaces?.join(',')
  const points = useMemo(() => {
    const mine = key === undefined ? undefined : new Set(key ? key.split(',') : [])
    return stations.map((s) => toChargePoint(s, mine)).filter((p): p is ChargePoint => p !== null)
  }, [stations, key])

  return { points, loading, error }
}
