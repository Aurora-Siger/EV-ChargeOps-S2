import { useCallback, useEffect, useState } from 'react'
import { api } from './http'

export type ApiState<T> = {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

/** GET com estado de carregamento/erro. `path` nulo = não busca (ex.: falta um id). */
export function useApi<T>(path: string | null, opts: { pollMs?: number } = {}): ApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  // `loading` vale para a primeira carga e para cada troca de `path`; recargas (reload/poll)
  // mantêm o dado anterior na tela.
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!path) return
    let stop = false
    api<T>(path)
      .then((d) => {
        if (stop) return
        setData(d)
        setError(null)
      })
      .catch((e: Error) => {
        if (!stop) setError(e.message)
      })
      .finally(() => {
        if (!stop) setLoadedPath(path)
      })
    return () => {
      stop = true
    }
  }, [path, tick])

  useEffect(() => {
    if (!path || !opts.pollMs) return
    const t = setInterval(reload, opts.pollMs)
    return () => clearInterval(t)
  }, [path, opts.pollMs, reload])

  return { data, error, loading: path !== null && loadedPath !== path, reload }
}
